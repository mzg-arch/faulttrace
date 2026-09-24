"""Role-aware, workspace-scoped operational dashboard summaries."""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    WorkspaceRole,
    authorized_workspace_member,
)
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["operational dashboard"])
FaultReportStatus = Literal["draft", "active", "resolved"]
ActivityType = Literal[
    "observation",
    "action_taken",
    "measurement",
    "escalation",
    "resolution",
]


class DashboardReportSummary(BaseModel):
    id: UUID
    equipment_id: UUID
    equipment_name: str
    equipment_asset_tag: str | None = None
    fault_code: str | None = None
    symptom: str
    status: FaultReportStatus
    owner_user_id: UUID
    owner_name: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    resolution_summary: str | None = None


class AffectedEquipmentSummary(BaseModel):
    id: UUID
    name: str
    asset_tag: str | None = None
    location: str | None = None
    active_report_count: int


class DashboardActivity(BaseModel):
    id: UUID
    fault_report_id: UUID
    equipment_name: str
    equipment_asset_tag: str | None = None
    report_status: FaultReportStatus
    entry_type: ActivityType
    note: str
    author_user_id: UUID
    author_name: str | None = None
    created_at: datetime


class DashboardSummaryResponse(BaseModel):
    role: WorkspaceRole
    active_report_count: int
    draft_report_count: int
    resolved_report_count: int
    recent_active_reports: list[DashboardReportSummary]
    recent_draft_reports: list[DashboardReportSummary]
    recent_resolved_reports: list[DashboardReportSummary]
    equipment_with_active_reports: list[AffectedEquipmentSummary]
    recent_activity: list[DashboardActivity]


def dashboard_http_error(error: SupabaseRequestError) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Operational dashboard data is not available until the pending report migrations are applied.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend dashboard credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase could not load the operational dashboard. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The operational dashboard request was rejected.",
    )


def timestamp(record: dict[str, Any], field: str) -> datetime:
    value = record.get(field)
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.min.replace(tzinfo=UTC)


def report_summary(
    record: dict[str, Any],
    equipment_by_id: dict[str, dict[str, Any]],
    profile_by_id: dict[str, dict[str, Any]],
) -> DashboardReportSummary | None:
    equipment = equipment_by_id.get(record["equipment_id"])
    if equipment is None:
        return None
    owner = profile_by_id.get(record["created_by"])
    return DashboardReportSummary.model_validate(
        {
            "id": record["id"],
            "equipment_id": record["equipment_id"],
            "equipment_name": equipment["name"],
            "equipment_asset_tag": equipment.get("asset_tag"),
            "fault_code": record.get("fault_code"),
            "symptom": record["symptom"],
            "status": record["status"],
            "owner_user_id": record["created_by"],
            "owner_name": owner.get("display_name") if owner else None,
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
            "resolved_at": record.get("resolved_at"),
            "resolution_summary": record.get("resolution_summary"),
        }
    )


def recent_report_summaries(
    records: list[dict[str, Any]],
    *,
    sort_field: str,
    limit: int,
    equipment_by_id: dict[str, dict[str, Any]],
    profile_by_id: dict[str, dict[str, Any]],
) -> list[DashboardReportSummary]:
    summaries: list[DashboardReportSummary] = []
    for record in sorted(
        records,
        key=lambda item: timestamp(item, sort_field),
        reverse=True,
    ):
        summary = report_summary(record, equipment_by_id, profile_by_id)
        if summary is not None:
            summaries.append(summary)
        if len(summaries) == limit:
            break
    return summaries


def affected_equipment(
    active_records: list[dict[str, Any]],
    equipment_by_id: dict[str, dict[str, Any]],
) -> list[AffectedEquipmentSummary]:
    counts: dict[str, int] = {}
    for record in active_records:
        equipment_id = record["equipment_id"]
        counts[equipment_id] = counts.get(equipment_id, 0) + 1

    results: list[AffectedEquipmentSummary] = []
    for equipment_id, active_count in counts.items():
        equipment = equipment_by_id.get(equipment_id)
        if equipment is None:
            continue
        results.append(
            AffectedEquipmentSummary.model_validate(
                {
                    **equipment,
                    "active_report_count": active_count,
                }
            )
        )
    return sorted(results, key=lambda item: (-item.active_report_count, item.name.lower()))


def activity_summaries(
    activity_records: list[dict[str, Any]],
    report_by_id: dict[str, dict[str, Any]],
    equipment_by_id: dict[str, dict[str, Any]],
    profile_by_id: dict[str, dict[str, Any]],
) -> list[DashboardActivity]:
    results: list[DashboardActivity] = []
    for activity in activity_records:
        report = report_by_id.get(activity["fault_report_id"])
        if report is None:
            continue
        equipment = equipment_by_id.get(report["equipment_id"])
        if equipment is None:
            continue
        author = profile_by_id.get(activity["author_user_id"])
        results.append(
            DashboardActivity.model_validate(
                {
                    **activity,
                    "equipment_name": equipment["name"],
                    "equipment_asset_tag": equipment.get("asset_tag"),
                    "report_status": report["status"],
                    "author_name": author.get("display_name") if author else None,
                }
            )
        )
    return results


@router.get(
    "/{workspace_id}/dashboard-summary",
    response_model=DashboardSummaryResponse,
)
async def get_dashboard_summary(
    workspace_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> DashboardSummaryResponse:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        records = await gateway.list_fault_reports(
            str(workspace_id),
            created_by=None,
        )
        open_records = [
            record
            for record in records
            if record.get("status") in {"draft", "active"}
            and (role == "admin" or record.get("created_by") == user["id"])
        ]
        resolved_records = [
            record for record in records if record.get("status") == "resolved"
        ]
        visible_records = open_records + resolved_records
        visible_report_ids = [record["id"] for record in visible_records]

        activity_records = await gateway.list_recent_fault_report_activity(
            str(workspace_id),
            report_ids=None if role == "admin" else visible_report_ids,
            limit=8,
        )
        equipment_records = await gateway.list_equipment(
            str(workspace_id),
            include_archived=True,
        )
        profile_ids = list(
            {
                *[record["created_by"] for record in visible_records],
                *[record["author_user_id"] for record in activity_records],
            }
        )
        profiles = await gateway.list_profiles(profile_ids)
    except SupabaseRequestError as error:
        raise dashboard_http_error(error) from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The operational dashboard service is unavailable.",
        ) from None

    equipment_by_id = {record["id"]: record for record in equipment_records}
    profile_by_id = {record["id"]: record for record in profiles}
    report_by_id = {record["id"]: record for record in visible_records}
    active_records = [record for record in open_records if record["status"] == "active"]
    draft_records = [record for record in open_records if record["status"] == "draft"]

    return DashboardSummaryResponse(
        role=role,
        active_report_count=len(active_records),
        draft_report_count=len(draft_records),
        resolved_report_count=len(resolved_records),
        recent_active_reports=recent_report_summaries(
            active_records,
            sort_field="updated_at",
            limit=6,
            equipment_by_id=equipment_by_id,
            profile_by_id=profile_by_id,
        ),
        recent_draft_reports=recent_report_summaries(
            draft_records,
            sort_field="updated_at",
            limit=4,
            equipment_by_id=equipment_by_id,
            profile_by_id=profile_by_id,
        ),
        recent_resolved_reports=recent_report_summaries(
            resolved_records,
            sort_field="resolved_at",
            limit=6,
            equipment_by_id=equipment_by_id,
            profile_by_id=profile_by_id,
        ),
        equipment_with_active_reports=affected_equipment(
            active_records,
            equipment_by_id,
        ),
        recent_activity=activity_summaries(
            activity_records,
            report_by_id,
            equipment_by_id,
            profile_by_id,
        ),
    )
