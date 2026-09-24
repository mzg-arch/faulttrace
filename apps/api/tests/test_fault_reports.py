"""Fault intake authorization, scoping, and safety-gate tests."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr, ValidationError

from app.authorization import authorized_workspace_technician
from app.routers.fault_reports import (
    FaultReportInput,
    ResolutionInput,
    SafetyAcknowledgements,
    WorkLogInput,
    activate_fault_report,
    create_fault_report,
    create_fault_report_work_log,
    get_fault_report,
    get_resolved_fault_report,
    list_fault_reports,
    list_fault_report_work_logs,
    list_resolved_fault_reports,
    resolve_fault_report,
)
from app.settings import Settings


WORKSPACE_ID = UUID("11111111-1111-1111-1111-111111111111")
OTHER_WORKSPACE_ID = UUID("99999999-9999-9999-9999-999999999999")
REPORT_ID = UUID("22222222-2222-2222-2222-222222222222")
EQUIPMENT_ID = UUID("33333333-3333-3333-3333-333333333333")
TECHNICIAN_ID = "44444444-4444-4444-4444-444444444444"


def test_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example_key_1234567890",
        supabase_secret_key=SecretStr("sb_secret_example_key_1234567890"),
        cors_origins="http://localhost:3000",
    )


def report_record(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "id": str(REPORT_ID),
        "equipment_id": str(EQUIPMENT_ID),
        "fault_code": "F0001",
        "symptom": "Drive will not start.",
        "planned_task": "Inspect approved start permissives.",
        "operating_context": "Stopped during normal production.",
        "status": "draft",
        "ack_authorized_qualified": False,
        "ack_loto_isolation": False,
        "ack_ppe_stored_energy": False,
        "ack_stop_escalate": False,
        "activated_at": None,
        "resolved_at": None,
        "resolved_by_user_id": None,
        "resolution_summary": None,
        "created_by": TECHNICIAN_ID,
        "created_at": "2026-09-21T12:00:00Z",
        "updated_at": "2026-09-21T12:00:00Z",
    }
    record.update(overrides)
    return record


class FakeFaultReportGateway:
    def __init__(self) -> None:
        self.list_created_by: str | None | object = object()
        self.list_workspace_id: str | None = None
        self.get_scope: tuple[str, str, str | None] | None = None
        self.created_payload: dict[str, object] | None = None
        self.activation_scope: tuple[str, str, str] | None = None
        self.activation_payload: dict[str, object] | None = None
        self.work_log_scope: tuple[str, str] | None = None
        self.created_work_log: tuple[str, str, str, str, str] | None = None
        self.resolution_scope: tuple[str, str, str, str] | None = None
        self.work_logs: list[dict[str, object]] = []
        self.resolved_search_scope: tuple[str, str | None, str | None, int] | None = None
        self.resolved_records: list[dict[str, object]] = []
        self.current_record: dict[str, object] | None = report_record()
        self.equipment_record: dict[str, object] | None = {
            "id": str(EQUIPMENT_ID),
            "name": "ACS580 Drive",
            "asset_tag": "FT-DRV-001",
            "status": "active",
        }

    async def list_fault_reports(
        self,
        _workspace_id: str,
        *,
        created_by: str | None,
    ) -> list[dict[str, object]]:
        self.list_workspace_id = _workspace_id
        self.list_created_by = created_by
        return [report_record()]

    async def search_resolved_fault_reports(
        self,
        workspace_id: str,
        *,
        equipment_id: str | None,
        search_text: str | None,
        limit: int,
    ) -> list[dict[str, object]]:
        self.resolved_search_scope = (
            workspace_id,
            equipment_id,
            search_text,
            limit,
        )
        return self.resolved_records

    async def list_equipment(
        self,
        _workspace_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, object]]:
        assert include_archived
        return [self.equipment_record] if self.equipment_record else []

    async def list_profiles(self, _user_ids: list[str]) -> list[dict[str, object]]:
        return [{"id": TECHNICIAN_ID, "display_name": "Demo Technician"}]

    async def get_equipment(
        self,
        _workspace_id: str,
        _equipment_id: str,
    ) -> dict[str, object] | None:
        return self.equipment_record

    async def create_fault_report(self, payload: dict[str, object]) -> dict[str, object]:
        self.created_payload = payload
        return report_record(**payload)

    async def get_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        *,
        created_by: str | None,
    ) -> dict[str, object] | None:
        self.get_scope = (workspace_id, report_id, created_by)
        return self.current_record

    async def activate_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        created_by: str,
        activation: dict[str, object],
    ) -> dict[str, object]:
        self.activation_scope = (workspace_id, report_id, created_by)
        self.activation_payload = activation
        return report_record(**activation)

    async def list_fault_report_work_logs(
        self,
        workspace_id: str,
        report_id: str,
    ) -> list[dict[str, object]]:
        self.work_log_scope = (workspace_id, report_id)
        return self.work_logs

    async def create_fault_report_work_log(
        self,
        workspace_id: str,
        report_id: str,
        author_user_id: str,
        entry_type: str,
        note: str,
    ) -> dict[str, object]:
        self.created_work_log = (
            workspace_id,
            report_id,
            author_user_id,
            entry_type,
            note,
        )
        record: dict[str, object] = {
            "id": "55555555-5555-5555-5555-555555555555",
            "fault_report_id": report_id,
            "author_user_id": author_user_id,
            "entry_type": entry_type,
            "note": note,
            "created_at": "2026-09-22T14:00:00Z",
        }
        self.work_logs.append(record)
        return record

    async def resolve_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        user_id: str,
        resolution_summary: str,
    ) -> dict[str, object]:
        self.resolution_scope = (
            workspace_id,
            report_id,
            user_id,
            resolution_summary,
        )
        self.work_logs.append(
            {
                "id": "66666666-6666-6666-6666-666666666666",
                "fault_report_id": report_id,
                "author_user_id": user_id,
                "entry_type": "resolution",
                "note": resolution_summary,
                "created_at": "2026-09-22T15:00:00Z",
            }
        )
        return report_record(
            status="resolved",
            activated_at="2026-09-22T13:00:00Z",
            ack_authorized_qualified=True,
            ack_loto_isolation=True,
            ack_ppe_stored_energy=True,
            ack_stop_escalate=True,
            resolved_at="2026-09-22T15:00:00Z",
            resolved_by_user_id=user_id,
            resolution_summary=resolution_summary,
        )


class FakeAuthorizationGateway:
    @property
    def is_configured(self) -> bool:
        return True

    async def verify_user(self, _token: str) -> dict[str, str]:
        return {"id": TECHNICIAN_ID}

    async def get_workspace_role(
        self,
        _token: str,
        _user_id: str,
        _workspace_id: str,
    ) -> str:
        return "admin"


class FaultReportValidationTests(unittest.TestCase):
    def test_required_symptom_is_rejected_when_blank(self) -> None:
        with self.assertRaises(ValidationError):
            FaultReportInput(equipment_id=EQUIPMENT_ID, symptom="   ")

    def test_optional_blank_values_become_none(self) -> None:
        payload = FaultReportInput(
            equipment_id=EQUIPMENT_ID,
            symptom=" Drive   will not start ",
            fault_code=" ",
            planned_task=" ",
        )

        self.assertEqual(payload.symptom, "Drive will not start")
        self.assertIsNone(payload.fault_code)
        self.assertIsNone(payload.planned_task)

    def test_blank_work_log_and_resolution_notes_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            WorkLogInput(entry_type="observation", note="   ")
        with self.assertRaises(ValidationError):
            ResolutionInput(resolution_summary="\n\t")


class FaultReportAuthorizationTests(unittest.TestCase):
    def test_admin_cannot_use_technician_only_helper(self) -> None:
        gateway = FakeAuthorizationGateway()
        with patch("app.authorization.SupabaseGateway", return_value=gateway):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    authorized_workspace_technician(
                        WORKSPACE_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)


class FaultReportEndpointTests(unittest.TestCase):
    def test_technician_list_is_scoped_to_authenticated_creator(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            records = asyncio.run(
                list_fault_reports(WORKSPACE_ID, "token", test_settings())
            )

        self.assertEqual(gateway.list_created_by, TECHNICIAN_ID)
        self.assertEqual(gateway.list_workspace_id, str(WORKSPACE_ID))
        self.assertEqual(records[0].technician_name, "Demo Technician")

    def test_admin_list_reads_workspace_reports_without_creator_filter(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": "admin-id"}, "admin")
        )
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            records = asyncio.run(
                list_fault_reports(WORKSPACE_ID, "token", test_settings())
            )

        self.assertIsNone(gateway.list_created_by)
        self.assertEqual(gateway.list_workspace_id, str(WORKSPACE_ID))
        self.assertEqual(len(records), 1)

    def test_create_uses_path_workspace_authenticated_technician_and_draft_status(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        payload = FaultReportInput(
            equipment_id=EQUIPMENT_ID,
            fault_code="F0001",
            symptom="Drive will not start.",
        )
        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            result = asyncio.run(
                create_fault_report(WORKSPACE_ID, payload, "token", test_settings())
            )

        self.assertEqual(gateway.created_payload["workspace_id"], str(WORKSPACE_ID))
        self.assertEqual(gateway.created_payload["created_by"], TECHNICIAN_ID)
        self.assertEqual(gateway.created_payload["status"], "draft")
        self.assertEqual(result.status, "draft")

    def test_create_rejects_archived_or_cross_workspace_equipment(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.equipment_record = None
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        payload = FaultReportInput(equipment_id=EQUIPMENT_ID, symptom="No output.")
        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    create_fault_report(
                        OTHER_WORKSPACE_ID,
                        payload,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 422)
        self.assertIsNone(gateway.created_payload)

    def test_technician_get_is_scoped_to_workspace_report_and_creator(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            asyncio.run(
                get_fault_report(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.get_scope,
            (str(WORKSPACE_ID), str(REPORT_ID), TECHNICIAN_ID),
        )

    def test_admin_get_is_workspace_scoped_without_creator_filter(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": "admin-id"}, "admin")
        )
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            asyncio.run(
                get_fault_report(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.get_scope,
            (str(WORKSPACE_ID), str(REPORT_ID), None),
        )

    def test_missing_workspace_report_returns_not_found(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = None
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    get_fault_report(
                        OTHER_WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 404)

    def test_safety_gate_requires_every_acknowledgement(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        payload = SafetyAcknowledgements(
            ack_authorized_qualified=True,
            ack_loto_isolation=True,
            ack_ppe_stored_energy=False,
            ack_stop_escalate=True,
        )
        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    activate_fault_report(
                        WORKSPACE_ID,
                        REPORT_ID,
                        payload,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 422)
        self.assertIsNone(gateway.activation_payload)

    def test_completed_safety_gate_moves_own_draft_to_active(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        payload = SafetyAcknowledgements(
            ack_authorized_qualified=True,
            ack_loto_isolation=True,
            ack_ppe_stored_energy=True,
            ack_stop_escalate=True,
        )
        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            result = asyncio.run(
                activate_fault_report(
                    WORKSPACE_ID,
                    REPORT_ID,
                    payload,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.activation_scope,
            (str(WORKSPACE_ID), str(REPORT_ID), TECHNICIAN_ID),
        )
        self.assertEqual(gateway.activation_payload["status"], "active")
        self.assertTrue(gateway.activation_payload["ack_stop_escalate"])
        self.assertIsNotNone(gateway.activation_payload["activated_at"])
        self.assertEqual(result.status, "active")

    def test_admin_cannot_activate_a_fault_report(self) -> None:
        authorization = AsyncMock(
            side_effect=HTTPException(status_code=403, detail="Technician access required.")
        )
        payload = SafetyAcknowledgements(
            ack_authorized_qualified=True,
            ack_loto_isolation=True,
            ack_ppe_stored_energy=True,
            ack_stop_escalate=True,
        )
        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    activate_fault_report(
                        WORKSPACE_ID,
                        REPORT_ID,
                        payload,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)


class ResolvedHistoryEndpointTests(unittest.TestCase):
    def test_history_filters_are_workspace_scoped_and_enriched(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.resolved_records = [
            report_record(
                status="resolved",
                resolved_at="2026-09-22T15:00:00Z",
                resolved_by_user_id=TECHNICIAN_ID,
                resolution_summary="Replaced the damaged control fuse.",
            )
        ]
        authorization = AsyncMock(
            return_value=(gateway, {"id": "admin-id"}, "admin")
        )

        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            results = asyncio.run(
                list_resolved_fault_reports(
                    WORKSPACE_ID,
                    "token",
                    test_settings(),
                    EQUIPMENT_ID,
                    "  control   fuse  ",
                    25,
                )
            )

        self.assertEqual(
            gateway.resolved_search_scope,
            (
                str(WORKSPACE_ID),
                str(EQUIPMENT_ID),
                "control fuse",
                25,
            ),
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].equipment_name, "ACS580 Drive")
        self.assertEqual(results[0].report_owner, "Demo Technician")
        self.assertEqual(
            results[0].resolution_summary,
            "Replaced the damaged control fuse.",
        )

    def test_technician_can_list_workspace_resolved_history(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.resolved_records = [
            report_record(
                created_by="77777777-7777-7777-7777-777777777777",
                status="resolved",
                resolved_at="2026-09-22T15:00:00Z",
                resolved_by_user_id="77777777-7777-7777-7777-777777777777",
                resolution_summary="Verified the approved reset sequence.",
            )
        ]
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )

        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            results = asyncio.run(
                list_resolved_fault_reports(
                    WORKSPACE_ID,
                    "token",
                    test_settings(),
                    None,
                    None,
                    3,
                )
            )

        self.assertEqual(len(results), 1)
        self.assertEqual(gateway.resolved_search_scope[0], str(WORKSPACE_ID))

    def test_resolved_detail_rejects_cross_workspace_or_active_report(self) -> None:
        gateway = FakeFaultReportGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )

        gateway.current_record = None
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as missing_context:
                asyncio.run(
                    get_resolved_fault_report(
                        OTHER_WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(missing_context.exception.status_code, 404)
        self.assertEqual(gateway.get_scope[0], str(OTHER_WORKSPACE_ID))

        gateway.current_record = report_record(status="active")
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as active_context:
                asyncio.run(
                    get_resolved_fault_report(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(active_context.exception.status_code, 404)

    def test_resolved_detail_is_readable_by_workspace_technician(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = report_record(
            status="resolved",
            resolved_at="2026-09-22T15:00:00Z",
            resolved_by_user_id=TECHNICIAN_ID,
            resolution_summary="Restored operation after the approved inspection.",
        )
        authorization = AsyncMock(
            return_value=(gateway, {"id": "another-technician"}, "technician")
        )

        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            result = asyncio.run(
                get_resolved_fault_report(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(result.status, "resolved")
        self.assertEqual(gateway.get_scope[2], None)


class WorkLogEndpointTests(unittest.TestCase):
    def test_technician_work_log_read_allows_owned_active_report(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = report_record(status="active")
        gateway.work_logs = [
            {
                "id": "55555555-5555-5555-5555-555555555555",
                "fault_report_id": str(REPORT_ID),
                "author_user_id": TECHNICIAN_ID,
                "entry_type": "observation",
                "note": "Contactor remains open after the start request.",
                "created_at": "2026-09-22T14:00:00Z",
            }
        ]
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )

        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            entries = asyncio.run(
                list_fault_report_work_logs(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.get_scope,
            (str(WORKSPACE_ID), str(REPORT_ID), None),
        )
        self.assertEqual(
            gateway.work_log_scope,
            (str(WORKSPACE_ID), str(REPORT_ID)),
        )
        self.assertEqual(entries[0].author_name, "Demo Technician")

    def test_technician_can_read_shared_resolved_log_but_not_shared_active_log(self) -> None:
        gateway = FakeFaultReportGateway()
        other_technician_id = "77777777-7777-7777-7777-777777777777"
        gateway.current_record = report_record(
            created_by=other_technician_id,
            status="resolved",
            resolved_at="2026-09-22T15:00:00Z",
            resolved_by_user_id=other_technician_id,
            resolution_summary="Verified the approved reset sequence.",
        )
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )

        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            entries = asyncio.run(
                list_fault_report_work_logs(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(entries, [])
        self.assertEqual(
            gateway.work_log_scope,
            (str(WORKSPACE_ID), str(REPORT_ID)),
        )

        gateway.current_record = report_record(
            created_by=other_technician_id,
            status="active",
        )
        gateway.work_log_scope = None
        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    list_fault_report_work_logs(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertIsNone(gateway.work_log_scope)

    def test_admin_can_read_workspace_work_log_without_creator_filter(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = report_record(status="active")
        authorization = AsyncMock(
            return_value=(gateway, {"id": "admin-id"}, "admin")
        )

        with patch("app.routers.fault_reports.authorized_workspace_member", authorization):
            asyncio.run(
                list_fault_report_work_logs(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.get_scope,
            (str(WORKSPACE_ID), str(REPORT_ID), None),
        )

    def test_technician_adds_entry_to_own_active_report(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = report_record(status="active")
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        payload = WorkLogInput(
            entry_type="measurement",
            note="Measured 24.1 VDC at the control input.",
        )

        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            result = asyncio.run(
                create_fault_report_work_log(
                    WORKSPACE_ID,
                    REPORT_ID,
                    payload,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.created_work_log,
            (
                str(WORKSPACE_ID),
                str(REPORT_ID),
                TECHNICIAN_ID,
                "measurement",
                "Measured 24.1 VDC at the control input.",
            ),
        )
        self.assertEqual(result.entry_type, "measurement")

    def test_resolved_report_rejects_new_work_log_entry(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = report_record(
            status="resolved",
            resolved_at="2026-09-22T15:00:00Z",
            resolved_by_user_id=TECHNICIAN_ID,
            resolution_summary="Reset the approved interlock after inspection.",
        )
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))

        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    create_fault_report_work_log(
                        WORKSPACE_ID,
                        REPORT_ID,
                        WorkLogInput(entry_type="observation", note="Late note."),
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIsNone(gateway.created_work_log)

    def test_owner_resolves_active_report_and_records_resolution_entry(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = report_record(status="active")
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        payload = ResolutionInput(
            resolution_summary="Replaced the damaged control fuse per the approved procedure."
        )

        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            result = asyncio.run(
                resolve_fault_report(
                    WORKSPACE_ID,
                    REPORT_ID,
                    payload,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(result.status, "resolved")
        self.assertEqual(result.resolved_by_user_id, UUID(TECHNICIAN_ID))
        self.assertEqual(gateway.work_logs[-1]["entry_type"], "resolution")
        self.assertEqual(
            gateway.resolution_scope,
            (
                str(WORKSPACE_ID),
                str(REPORT_ID),
                TECHNICIAN_ID,
                payload.resolution_summary,
            ),
        )

    def test_already_resolved_report_cannot_be_resolved_again(self) -> None:
        gateway = FakeFaultReportGateway()
        gateway.current_record = report_record(
            status="resolved",
            resolved_at="2026-09-22T15:00:00Z",
            resolved_by_user_id=TECHNICIAN_ID,
            resolution_summary="Issue corrected.",
        )
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))

        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    resolve_fault_report(
                        WORKSPACE_ID,
                        REPORT_ID,
                        ResolutionInput(resolution_summary="Resolve again."),
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIsNone(gateway.resolution_scope)

    def test_admin_cannot_add_work_log_or_resolve_report(self) -> None:
        authorization = AsyncMock(
            side_effect=HTTPException(status_code=403, detail="Technician access required.")
        )

        with patch(
            "app.routers.fault_reports.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as create_context:
                asyncio.run(
                    create_fault_report_work_log(
                        WORKSPACE_ID,
                        REPORT_ID,
                        WorkLogInput(entry_type="escalation", note="Escalated."),
                        "token",
                        test_settings(),
                    )
                )
            with self.assertRaises(HTTPException) as resolve_context:
                asyncio.run(
                    resolve_fault_report(
                        WORKSPACE_ID,
                        REPORT_ID,
                        ResolutionInput(resolution_summary="Closed."),
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(create_context.exception.status_code, 403)
        self.assertEqual(resolve_context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
