"""Workspace-scoped fault intake and mandatory safety-gate endpoints."""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_member,
    authorized_workspace_technician,
)
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["fault reports"])
FaultReportStatus = Literal["draft", "active", "resolved"]
WorkLogEntryType = Literal[
    "observation",
    "action_taken",
    "measurement",
    "escalation",
    "resolution",
]
ManualWorkLogEntryType = Literal[
    "observation",
    "action_taken",
    "measurement",
    "escalation",
]


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


class WorkLogInput(BaseModel):
    entry_type: ManualWorkLogEntryType
    note: str = Field(min_length=1, max_length=4000)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("A work-log note is required.")
        return normalized


class ResolutionInput(BaseModel):
    resolution_summary: str = Field(min_length=1, max_length=4000)

    @field_validator("resolution_summary")
    @classmethod
    def normalize_resolution_summary(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("A resolution summary is required.")
        return normalized


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
    resolved_at: datetime | None = None
    resolved_by_user_id: UUID | None = None
    resolution_summary: str | None = None
    created_by: UUID
    technician_name: str | None = None
    created_at: datetime
    updated_at: datetime


class WorkLogResponse(BaseModel):
    id: UUID
    fault_report_id: UUID
    author_user_id: UUID
    author_name: str | None = None
    entry_type: WorkLogEntryType
    note: str
    created_at: datetime


class ResolvedReportSummary(BaseModel):
    id: UUID
    equipment_id: UUID
    equipment_name: str
    equipment_asset_tag: str | None = None
    fault_code: str | None
    symptom: str
    resolved_at: datetime
    resolution_summary: str
    created_by: UUID
    report_owner: str | None = None


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


def work_log_http_error(error: SupabaseRequestError, action: str) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "42883", "pgrst202", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Work Log setup is incomplete. Apply the pending work-log migration.",
        )
    if code in {"p0001", "22023", "23514"}:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This report changed before the request completed. Reload it and try again."
            ),
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend work-log credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not {action}. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The work-log service rejected the request to {action}.",
    )


def resolved_history_http_error(error: SupabaseRequestError, action: str) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "42883", "pgrst202", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resolved History setup is incomplete. Apply the pending history migration.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend resolved-history credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not {action} resolved history. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The resolved-history service rejected the request to {action} history.",
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


def resolved_summary(report: FaultReportResponse) -> ResolvedReportSummary:
    if report.resolved_at is None or report.resolution_summary is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="A resolved report is missing its required resolution record.",
        )
    return ResolvedReportSummary(
        id=report.id,
        equipment_id=report.equipment_id,
        equipment_name=report.equipment_name,
        equipment_asset_tag=report.equipment_asset_tag,
        fault_code=report.fault_code,
        symptom=report.symptom,
        resolved_at=report.resolved_at,
        resolution_summary=report.resolution_summary,
        created_by=report.created_by,
        report_owner=report.technician_name,
    )


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


@router.get(
    "/{workspace_id}/resolved-reports",
    response_model=list[ResolvedReportSummary],
)
async def list_resolved_fault_reports(
    workspace_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
    equipment_id: UUID | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[ResolvedReportSummary]:
    gateway, _user, _role = await authorized_workspace_member(
        workspace_id,
        token,
        settings,
    )
    normalized_search = " ".join(search.split()) if search else None
    try:
        records = await gateway.search_resolved_fault_reports(
            str(workspace_id),
            equipment_id=str(equipment_id) if equipment_id else None,
            search_text=normalized_search or None,
            limit=limit,
        )
        reports = await enrich_reports(gateway, workspace_id, records)
        return [resolved_summary(report) for report in reports]
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise resolved_history_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The resolved-history service is unavailable.",
        ) from None


@router.get(
    "/{workspace_id}/resolved-reports/{report_id}",
    response_model=FaultReportResponse,
)
async def get_resolved_fault_report(
    workspace_id: UUID,
    report_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> FaultReportResponse:
    gateway, _user, _role = await authorized_workspace_member(
        workspace_id,
        token,
        settings,
    )
    try:
        record = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=None,
        )
        if record is None or record.get("status") != "resolved":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Resolved fault report was not found in this workspace.",
            )
        reports = await enrich_reports(gateway, workspace_id, [record])
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise resolved_history_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The resolved-history service is unavailable.",
        ) from None
    if not reports:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resolved report equipment was not found in this workspace.",
        )
    return reports[0]


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


@router.get(
    "/{workspace_id}/fault-reports/{report_id}/work-logs",
    response_model=list[WorkLogResponse],
)
async def list_fault_report_work_logs(
    workspace_id: UUID,
    report_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> list[WorkLogResponse]:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        report = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=None,
        )
        if (
            report is None
            or (
                role == "technician"
                and report.get("created_by") != user["id"]
                and report.get("status") != "resolved"
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fault report was not found in this workspace.",
            )

        records = await gateway.list_fault_report_work_logs(
            str(workspace_id),
            str(report_id),
        )
        author_ids = list({record["author_user_id"] for record in records})
        profiles = await gateway.list_profiles(author_ids)
        profile_by_id = {profile["id"]: profile for profile in profiles}
        return [
            WorkLogResponse.model_validate(
                {
                    **record,
                    "author_name": (
                        profile_by_id.get(record["author_user_id"], {}).get(
                            "display_name"
                        )
                    ),
                }
            )
            for record in records
        ]
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise work_log_http_error(error, "load the work log") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The work-log service is unavailable.",
        ) from None


@router.post(
    "/{workspace_id}/fault-reports/{report_id}/work-logs",
    response_model=WorkLogResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_fault_report_work_log(
    workspace_id: UUID,
    report_id: UUID,
    payload: WorkLogInput,
    token: TokenDependency,
    settings: SettingsDependency,
) -> WorkLogResponse:
    gateway, user = await authorized_workspace_technician(workspace_id, token, settings)
    try:
        report = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=user["id"],
        )
        if report is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fault report was not found in this workspace.",
            )
        if report.get("status") == "resolved":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Resolved fault reports are read-only.",
            )
        if report.get("status") != "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Complete the Safety Gate before adding work-log entries.",
            )

        record = await gateway.create_fault_report_work_log(
            str(workspace_id),
            str(report_id),
            user["id"],
            payload.entry_type,
            payload.note,
        )
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The work-log entry could not be recorded. Reload the report and try again.",
            )
        profiles = await gateway.list_profiles([user["id"]])
        author_name = profiles[0].get("display_name") if profiles else None
        return WorkLogResponse.model_validate({**record, "author_name": author_name})
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise work_log_http_error(error, "record the work-log entry") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The work-log service is unavailable.",
        ) from None


@router.post(
    "/{workspace_id}/fault-reports/{report_id}/resolve",
    response_model=FaultReportResponse,
)
async def resolve_fault_report(
    workspace_id: UUID,
    report_id: UUID,
    payload: ResolutionInput,
    token: TokenDependency,
    settings: SettingsDependency,
) -> FaultReportResponse:
    gateway, user = await authorized_workspace_technician(workspace_id, token, settings)
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
        if current.get("status") == "resolved":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This fault report is already resolved.",
            )
        if current.get("status") != "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Complete the Safety Gate before resolving this report.",
            )

        record = await gateway.resolve_fault_report(
            str(workspace_id),
            str(report_id),
            user["id"],
            payload.resolution_summary,
        )
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The report could not be resolved. Reload it and try again.",
            )
        equipment = await gateway.get_equipment(
            str(workspace_id),
            record["equipment_id"],
        )
        if equipment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fault report equipment was not found in this workspace.",
            )
        profiles = await gateway.list_profiles([user["id"]])
        technician_name = profiles[0].get("display_name") if profiles else None
        return report_response(record, equipment, technician_name)
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise work_log_http_error(error, "resolve the fault report") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The work-log service is unavailable.",
        ) from None
