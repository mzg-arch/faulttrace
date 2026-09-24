"""Role-aware operational dashboard authorization and scoping tests."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr

from app.routers.dashboard import get_dashboard_summary
from app.settings import Settings


WORKSPACE_ID = UUID("11111111-1111-1111-1111-111111111111")
OTHER_WORKSPACE_ID = UUID("99999999-9999-9999-9999-999999999999")
TECHNICIAN_ID = "44444444-4444-4444-4444-444444444444"
OTHER_TECHNICIAN_ID = "77777777-7777-7777-7777-777777777777"
EQUIPMENT_ONE = "33333333-3333-3333-3333-333333333331"
EQUIPMENT_TWO = "33333333-3333-3333-3333-333333333332"


def dashboard_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example_key_1234567890",
        supabase_secret_key=SecretStr("sb_secret_example_key_1234567890"),
        cors_origins="http://localhost:3000",
    )


def report_record(
    report_id: str,
    *,
    owner_id: str,
    equipment_id: str,
    status: str,
    hour: int,
) -> dict[str, object]:
    resolved = status == "resolved"
    return {
        "id": report_id,
        "equipment_id": equipment_id,
        "fault_code": f"F-{hour:02d}",
        "symptom": f"Recorded symptom {hour}.",
        "status": status,
        "resolved_at": f"2026-09-23T{hour:02d}:30:00Z" if resolved else None,
        "resolution_summary": f"Recorded resolution {hour}." if resolved else None,
        "created_by": owner_id,
        "created_at": f"2026-09-23T{hour:02d}:00:00Z",
        "updated_at": f"2026-09-23T{hour:02d}:30:00Z",
    }


OWN_ACTIVE = "22222222-2222-2222-2222-222222222201"
OTHER_ACTIVE = "22222222-2222-2222-2222-222222222202"
OWN_DRAFT = "22222222-2222-2222-2222-222222222203"
OTHER_DRAFT = "22222222-2222-2222-2222-222222222204"
OWN_RESOLVED = "22222222-2222-2222-2222-222222222205"
OTHER_RESOLVED = "22222222-2222-2222-2222-222222222206"


class FakeDashboardGateway:
    def __init__(self) -> None:
        self.report_workspace: str | None = None
        self.report_created_by: str | None | object = object()
        self.activity_scope: tuple[str, list[str] | None, int] | None = None
        self.equipment_workspace: str | None = None
        self.records = [
            report_record(
                OWN_ACTIVE,
                owner_id=TECHNICIAN_ID,
                equipment_id=EQUIPMENT_ONE,
                status="active",
                hour=16,
            ),
            report_record(
                OTHER_ACTIVE,
                owner_id=OTHER_TECHNICIAN_ID,
                equipment_id=EQUIPMENT_TWO,
                status="active",
                hour=15,
            ),
            report_record(
                OWN_DRAFT,
                owner_id=TECHNICIAN_ID,
                equipment_id=EQUIPMENT_ONE,
                status="draft",
                hour=14,
            ),
            report_record(
                OTHER_DRAFT,
                owner_id=OTHER_TECHNICIAN_ID,
                equipment_id=EQUIPMENT_TWO,
                status="draft",
                hour=13,
            ),
            report_record(
                OWN_RESOLVED,
                owner_id=TECHNICIAN_ID,
                equipment_id=EQUIPMENT_ONE,
                status="resolved",
                hour=12,
            ),
            report_record(
                OTHER_RESOLVED,
                owner_id=OTHER_TECHNICIAN_ID,
                equipment_id=EQUIPMENT_TWO,
                status="resolved",
                hour=11,
            ),
        ]
        self.activity = [
            {
                "id": "55555555-5555-5555-5555-555555555551",
                "fault_report_id": OWN_ACTIVE,
                "author_user_id": TECHNICIAN_ID,
                "entry_type": "measurement",
                "note": "Recorded an approved measurement.",
                "created_at": "2026-09-23T17:00:00Z",
            },
            {
                "id": "55555555-5555-5555-5555-555555555552",
                "fault_report_id": OTHER_ACTIVE,
                "author_user_id": OTHER_TECHNICIAN_ID,
                "entry_type": "observation",
                "note": "Another technician's active observation.",
                "created_at": "2026-09-23T16:30:00Z",
            },
            {
                "id": "55555555-5555-5555-5555-555555555553",
                "fault_report_id": OTHER_RESOLVED,
                "author_user_id": OTHER_TECHNICIAN_ID,
                "entry_type": "resolution",
                "note": "Shared workspace resolution.",
                "created_at": "2026-09-23T16:00:00Z",
            },
        ]

    async def list_fault_reports(
        self,
        workspace_id: str,
        *,
        created_by: str | None,
    ) -> list[dict[str, object]]:
        self.report_workspace = workspace_id
        self.report_created_by = created_by
        return self.records

    async def list_recent_fault_report_activity(
        self,
        workspace_id: str,
        *,
        report_ids: list[str] | None,
        limit: int,
    ) -> list[dict[str, object]]:
        self.activity_scope = (workspace_id, report_ids, limit)
        allowed = set(report_ids) if report_ids is not None else None
        records = [
            record
            for record in self.activity
            if allowed is None or record["fault_report_id"] in allowed
        ]
        return records[:limit]

    async def list_equipment(
        self,
        workspace_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, object]]:
        self.equipment_workspace = workspace_id
        assert include_archived
        return [
            {
                "id": EQUIPMENT_ONE,
                "name": "ACS580 Drive",
                "asset_tag": "DRV-001",
                "location": "Line 1",
            },
            {
                "id": EQUIPMENT_TWO,
                "name": "Cooling Pump",
                "asset_tag": "PMP-002",
                "location": "Utility Bay",
            },
        ]

    async def list_profiles(self, user_ids: list[str]) -> list[dict[str, str]]:
        profiles = {
            TECHNICIAN_ID: "Demo Technician",
            OTHER_TECHNICIAN_ID: "Second Technician",
        }
        return [
            {"id": user_id, "display_name": profiles[user_id]}
            for user_id in user_ids
            if user_id in profiles
        ]


class DashboardSummaryTests(unittest.TestCase):
    def test_technician_sees_own_open_work_and_shared_resolved_history(self) -> None:
        gateway = FakeDashboardGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )

        with patch("app.routers.dashboard.authorized_workspace_member", authorization):
            result = asyncio.run(
                get_dashboard_summary(
                    WORKSPACE_ID,
                    "token",
                    dashboard_settings(),
                )
            )

        self.assertEqual(result.role, "technician")
        self.assertEqual(result.active_report_count, 1)
        self.assertEqual(result.draft_report_count, 1)
        self.assertEqual(result.resolved_report_count, 2)
        self.assertEqual([str(item.id) for item in result.recent_active_reports], [OWN_ACTIVE])
        self.assertEqual([str(item.id) for item in result.recent_draft_reports], [OWN_DRAFT])
        self.assertEqual(
            {str(item.id) for item in result.recent_resolved_reports},
            {OWN_RESOLVED, OTHER_RESOLVED},
        )
        self.assertNotIn(OTHER_ACTIVE, {str(item.fault_report_id) for item in result.recent_activity})
        self.assertIn(OTHER_RESOLVED, {str(item.fault_report_id) for item in result.recent_activity})
        self.assertEqual(result.equipment_with_active_reports[0].name, "ACS580 Drive")
        self.assertEqual(gateway.report_workspace, str(WORKSPACE_ID))
        self.assertIsNone(gateway.report_created_by)
        assert gateway.activity_scope is not None
        self.assertEqual(
            set(gateway.activity_scope[1] or []),
            {OWN_ACTIVE, OWN_DRAFT, OWN_RESOLVED, OTHER_RESOLVED},
        )

    def test_admin_sees_workspace_wide_operational_summary(self) -> None:
        gateway = FakeDashboardGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": "admin-user"}, "admin")
        )

        with patch("app.routers.dashboard.authorized_workspace_member", authorization):
            result = asyncio.run(
                get_dashboard_summary(
                    WORKSPACE_ID,
                    "token",
                    dashboard_settings(),
                )
            )

        self.assertEqual(result.role, "admin")
        self.assertEqual(result.active_report_count, 2)
        self.assertEqual(result.draft_report_count, 2)
        self.assertEqual(result.resolved_report_count, 2)
        self.assertEqual(
            {str(item.id) for item in result.recent_active_reports},
            {OWN_ACTIVE, OTHER_ACTIVE},
        )
        self.assertEqual(len(result.equipment_with_active_reports), 2)
        self.assertEqual(len(result.recent_activity), 3)
        self.assertEqual(result.recent_active_reports[0].owner_name, "Demo Technician")
        self.assertEqual(
            gateway.activity_scope,
            (str(WORKSPACE_ID), None, 8),
        )

    def test_workspace_authorization_failure_returns_no_summary(self) -> None:
        authorization = AsyncMock(
            side_effect=HTTPException(
                status_code=403,
                detail="You do not have access to this workspace.",
            )
        )

        with patch("app.routers.dashboard.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    get_dashboard_summary(
                        OTHER_WORKSPACE_ID,
                        "token",
                        dashboard_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)
        authorization.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
