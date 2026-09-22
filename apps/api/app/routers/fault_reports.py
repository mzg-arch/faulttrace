"""Workspace-scoped fault intake and mandatory safety-gate endpoints."""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_member,
    authorized_workspace_technician,
)
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["fault reports"])
FaultReportStatus = Literal["draft", "active"]


class FaultReportInput(BaseModel):
    equipment_id: UUID
    fault_code: str | None = Field(default=None, max_length=120)
    symptom: str = Field(min_length=1, max_length=4000)
    planned_task: str | None = Field(default=None, max_length=2000)
    operating_context: str | None = Field(default=None, max_length=4000)

    @field_validator("symptom")
    @classmethod
    def normalize_symptom(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Symptom or issue description is required.")
        return normalized

    @field_validator("fault_code", "planned_task", "operating_context")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class SafetyAcknowledgements(BaseModel):
    ack_authorized_qualified: bool
    ack_loto_isolation: bool
    ack_ppe_stored_energy: bool
    ack_stop_escalate: bool

    @property
    def all_completed(self) -> bool:
        return all(self.model_dump().values())


class FaultReportResponse(BaseModel):
    id: UUID
    equipment_id: UUID
    equipment_name: str
    equipment_asset_tag: str | None = None
    fault_code: str | None
    symptom: str
    planned_task: str | None
    operating_context: str | None
    status: FaultReportStatus
    ack_authorized_qualified: bool
    ack_loto_isolation: bool
    ack_ppe_stored_energy: bool
    ack_stop_escalate: bool
    activated_at: datetime | None
    created_by: UUID
    technician_name: str | None = None
    created_at: datetime
    updated_at: datetime


def fault_report_http_error(error: SupabaseRequestError, action: str) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Fault Intake setup is incomplete. Apply the pending fault-intake migration.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend fault-report credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not {action} the fault report. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The fault-report service rejected the request to {action} the report.",
    )


def report_response(
    record: dict[str, Any],
    equipment: dict[str, Any],
    technician_name: str | None = None,
) -> FaultReportResponse:
    return FaultReportResponse.model_validate(
        {
            **record,
            "equipment_name": equipment["name"],
            "equipment_asset_tag": equipment.get("asset_tag"),
            "technician_name": technician_name,
        }
    )


async def enrich_reports(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    records: list[dict[str, Any]],
) -> list[FaultReportResponse]:
    equipment_records = await gateway.list_equipment(
        str(workspace_id),
        include_archived=True,
    )
    creator_ids = list({record["created_by"] for record in records})
    profiles = await gateway.list_profiles(creator_ids)
    equipment_by_id = {record["id"]: record for record in equipment_records}
    profile_by_id = {record["id"]: record for record in profiles}

    responses: list[FaultReportResponse] = []
    for record in records:
        equipment = equipment_by_id.get(record["equipment_id"])
        if equipment is None:
            continue
        profile = profile_by_id.get(record["created_by"])
        responses.append(
            report_response(
                record,
                equipment,
                profile.get("display_name") if profile else None,
            )
        )
    return responses


@router.get("/{workspace_id}/fault-reports", response_model=list[FaultReportResponse])
async def list_fault_reports(
    workspace_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> list[FaultReportResponse]:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        records = await gateway.list_fault_reports(
            str(workspace_id),
            created_by=user["id"] if role == "technician" else None,
        )
        return await enrich_reports(gateway, workspace_id, records)
    except SupabaseRequestError as error:
        raise fault_report_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The fault-report service is unavailable.",
        ) from None


@router.post(
    "/{workspace_id}/fault-reports",
    response_model=FaultReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_fault_report(
    workspace_id: UUID,
    payload: FaultReportInput,
    token: TokenDependency,
    settings: SettingsDependency,
) -> FaultReportResponse:
    gateway, user = await authorized_workspace_technician(workspace_id, token, settings)
    try:
        equipment = await gateway.get_equipment(
            str(workspace_id),
            str(payload.equipment_id),
        )
        if equipment is None or equipment.get("status") != "active":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Select active equipment from this workspace.",
            )
        record = await gateway.create_fault_report(
            {
                "workspace_id": str(workspace_id),
                "equipment_id": str(payload.equipment_id),
                "fault_code": payload.fault_code,
                "symptom": payload.symptom,
                "planned_task": payload.planned_task,
                "operating_context": payload.operating_context,
                "status": "draft",
                "created_by": user["id"],
            }
        )
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise fault_report_http_error(error, "create") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The fault-report service is unavailable.",
        ) from None
    if not record:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase did not return the created fault report.",
        )
    return report_response(record, equipment)


@router.get(
    "/{workspace_id}/fault-reports/{report_id}",
    response_model=FaultReportResponse,
)
async def get_fault_report(
    workspace_id: UUID,
    report_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> FaultReportResponse:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        record = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=user["id"] if role == "technician" else None,
        )
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fault report was not found in this workspace.",
            )
        responses = await enrich_reports(gateway, workspace_id, [record])
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise fault_report_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The fault-report service is unavailable.",
        ) from None
    if not responses:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fault report equipment was not found in this workspace.",
        )
    return responses[0]


@router.post(
    "/{workspace_id}/fault-reports/{report_id}/activate",
    response_model=FaultReportResponse,
)
async def activate_fault_report(
    workspace_id: UUID,
    report_id: UUID,
    payload: SafetyAcknowledgements,
    token: TokenDependency,
    settings: SettingsDependency,
) -> FaultReportResponse:
    gateway, user = await authorized_workspace_technician(workspace_id, token, settings)
    if not payload.all_completed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Complete every required safety acknowledgement before beginning work.",
        )

    try:
        current = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=user["id"],
        )
        if current is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fault report was not found in this workspace.",
            )
        if current.get("status") != "draft":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This fault report has already passed the safety gate.",
            )
        activation = {
            **payload.model_dump(),
            "status": "active",
            "activated_at": datetime.now(UTC).isoformat(),
        }
        record = await gateway.activate_fault_report(
            str(workspace_id),
            str(report_id),
            user["id"],
            activation,
        )
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The safety gate could not be completed. Reload the report and try again.",
            )
        equipment = await gateway.get_equipment(
            str(workspace_id),
            record["equipment_id"],
        )
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise fault_report_http_error(error, "activate") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The fault-report service is unavailable.",
        ) from None
    if equipment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fault report equipment was not found in this workspace.",
        )
    return report_response(record, equipment)
