"""Grounding, authorization, and persistence tests for guidance plans."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr

from app.gemini_guidance import (
    CitedStatement,
    GeminiGuidanceDraft,
    GeminiGuidanceError,
    GuidedCheckDraft,
    _generate_sync,
    _provider_response_schema,
)
from app.routers.guidance import (
    INSUFFICIENT_SUMMARY,
    generate_guidance_plan,
    get_guidance_plan,
)
from app.settings import Settings


WORKSPACE_ID = UUID("11111111-1111-1111-1111-111111111111")
OTHER_WORKSPACE_ID = UUID("99999999-9999-9999-9999-999999999999")
REPORT_ID = UUID("22222222-2222-2222-2222-222222222222")
EQUIPMENT_ID = UUID("33333333-3333-3333-3333-333333333333")
TECHNICIAN_ID = "44444444-4444-4444-4444-444444444444"
DOCUMENT_ID = "55555555-5555-5555-5555-555555555555"
PLAN_ID = "66666666-6666-6666-6666-666666666666"


def test_settings(*, gemini_key: str = "gemini-test-key") -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example_key_1234567890",
        supabase_secret_key=SecretStr("sb_secret_example_key_1234567890"),
        gemini_api_key=SecretStr(gemini_key),
        gemini_model="gemini-3.8-flash",
        cors_origins="http://localhost:3000",
    )


def active_report(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "id": str(REPORT_ID),
        "equipment_id": str(EQUIPMENT_ID),
        "fault_code": "F0001",
        "symptom": "ACS580 drive will not start after a permissive is lost.",
        "planned_task": "Verify start permissives.",
        "operating_context": "Stopped production conveyor.",
        "status": "active",
        "ack_authorized_qualified": True,
        "ack_loto_isolation": True,
        "ack_ppe_stored_energy": True,
        "ack_stop_escalate": True,
        "created_by": TECHNICIAN_ID,
    }
    record.update(overrides)
    return record


def evidence_match(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "chunk_id": 17,
        "document_id": DOCUMENT_ID,
        "document_title": "ACS580 Hardware Manual",
        "document_type": "manual",
        "source_revision": "Rev C",
        "page_number": 42,
        "excerpt": "Verify that the start permissive input is present before enabling the drive.",
        "equipment_linked": True,
        "relevance": 0.9,
    }
    record.update(overrides)
    return record


def grounded_draft(citation_id: int = 17) -> GeminiGuidanceDraft:
    return GeminiGuidanceDraft(
        status="grounded",
        case_summary=CitedStatement(
            text="The reported start issue is associated with the cited start permissive check.",
            citation_ids=[citation_id],
        ),
        safety_brief_items=[
            CitedStatement(
                text="Review the cited start permissive requirement before proceeding.",
                citation_ids=[citation_id],
            )
        ],
        guided_checks=[
            GuidedCheckDraft(
                title="Start permissive",
                supported_action="Verify the start permissive input described in the approved source.",
                citation_ids=[citation_id],
            )
        ],
        escalation_criteria=[
            CitedStatement(
                text="Escalate if the cited start permissive requirement cannot be verified.",
                citation_ids=[citation_id],
            )
        ],
        evidence_citation_ids=[citation_id],
    )


def insufficient_model_draft() -> GeminiGuidanceDraft:
    return GeminiGuidanceDraft(
        status="insufficient_evidence",
        case_summary=CitedStatement(
            text="The supplied excerpts do not support a safe guidance plan.",
            citation_ids=[],
        ),
        safety_brief_items=[],
        guided_checks=[],
        escalation_criteria=[],
        evidence_citation_ids=[],
    )


class FakeGuidanceGateway:
    def __init__(self) -> None:
        self.report: dict[str, object] | None = active_report()
        self.matches: list[dict[str, object]] = [evidence_match()]
        self.saved_payload: dict[str, object] | None = None
        self.latest_record: dict[str, object] | None = None
        self.report_scope: tuple[str, str, str | None] | None = None
        self.search_scope: tuple[str, str, str, int] | None = None
        self.latest_scope: tuple[str, str, str | None] | None = None

    async def get_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        *,
        created_by: str | None,
    ) -> dict[str, object] | None:
        self.report_scope = (workspace_id, report_id, created_by)
        return self.report

    async def get_equipment(
        self,
        _workspace_id: str,
        _equipment_id: str,
    ) -> dict[str, object]:
        return {
            "id": str(EQUIPMENT_ID),
            "name": "ACS580 Drive",
            "asset_tag": "DRV-001",
            "manufacturer": "ABB",
            "model": "ACS580-01",
            "status": "active",
        }

    async def search_approved_document_chunks(
        self,
        workspace_id: str,
        equipment_id: str,
        search_text: str,
        *,
        limit: int,
    ) -> list[dict[str, object]]:
        self.search_scope = (workspace_id, equipment_id, search_text, limit)
        return self.matches

    async def get_document_for_access(
        self,
        _workspace_id: str,
        _document_id: str,
    ) -> dict[str, object]:
        return {
            "id": DOCUMENT_ID,
            "status": "approved",
            "content_type": "application/pdf",
            "storage_path": f"{WORKSPACE_ID}/{DOCUMENT_ID}/manual.pdf",
            "file_name": "manual.pdf",
        }

    async def create_document_signed_url(
        self,
        _storage_path: str,
        *,
        expires_in: int,
    ) -> str:
        return f"https://example.supabase.co/signed/source?expires={expires_in}"

    async def create_guidance_plan(
        self,
        plan: dict[str, object],
    ) -> dict[str, object]:
        self.saved_payload = plan
        record = {
            **plan,
            "id": PLAN_ID,
            "created_at": "2026-09-22T12:00:00Z",
        }
        self.latest_record = record
        return record

    async def get_latest_guidance_plan(
        self,
        workspace_id: str,
        report_id: str,
        *,
        created_by: str | None,
    ) -> dict[str, object] | None:
        self.latest_scope = (workspace_id, report_id, created_by)
        return self.latest_record


class GuidancePlanTests(unittest.TestCase):
    def test_provider_schema_omits_unsupported_additional_properties(self) -> None:
        schema_text = str(_provider_response_schema())

        self.assertNotIn("additionalProperties", schema_text)
        self.assertIn("evidence_citation_ids", schema_text)

    def test_client_error_logs_only_sanitized_provider_status_and_message(self) -> None:
        from google.genai import errors as genai_errors

        api_key = "secret-test-api-key"
        provider_error = genai_errors.ClientError(
            404,
            {
                "error": {
                    "message": f"Model was not found for key {api_key}.\nCheck the model name.",
                    "status": "NOT_FOUND",
                    "internal": "must-not-be-logged",
                }
            },
        )
        client = unittest.mock.MagicMock()
        client.models.generate_content.side_effect = provider_error

        with (
            patch("google.genai.Client", return_value=client),
            self.assertLogs("faulttrace.gemini", level="WARNING") as logs,
            self.assertRaises(GeminiGuidanceError) as context,
        ):
            _generate_sync(api_key, "invalid-model", {}, [])

        log_output = "\n".join(logs.output)
        self.assertEqual(context.exception.code, "provider_rejected")
        self.assertIn("provider_http_status=404", log_output)
        self.assertIn("provider_message=Model was not found", log_output)
        self.assertIn("[REDACTED]", log_output)
        self.assertNotIn(api_key, log_output)
        self.assertNotIn("must-not-be-logged", log_output)
        self.assertNotIn("\nCheck", log_output)

    def test_no_key_configured_returns_safe_service_state(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with patch(
            "app.routers.guidance.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    generate_guidance_plan(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(gemini_key=""),
                    )
                )

        self.assertEqual(context.exception.status_code, 503)
        self.assertIn("AI service is not configured", context.exception.detail)
        self.assertIsNone(gateway.search_scope)
        self.assertIsNone(gateway.saved_payload)

    def test_report_workspace_isolation_happens_before_retrieval(self) -> None:
        gateway = FakeGuidanceGateway()
        gateway.report = None
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with patch(
            "app.routers.guidance.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    generate_guidance_plan(
                        OTHER_WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertIsNone(gateway.search_scope)

    def test_draft_report_cannot_generate_guidance(self) -> None:
        gateway = FakeGuidanceGateway()
        gateway.report = active_report(status="draft")
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with patch(
            "app.routers.guidance.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    generate_guidance_plan(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIsNone(gateway.search_scope)

    def test_evidence_is_retrieved_server_side_and_snapshot_is_saved(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        generate = AsyncMock(return_value=grounded_draft())
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                generate,
            ),
        ):
            result = asyncio.run(
                generate_guidance_plan(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(gateway.report_scope[2], TECHNICIAN_ID)
        self.assertEqual(gateway.search_scope[0], str(WORKSPACE_ID))
        self.assertEqual(gateway.search_scope[1], str(EQUIPMENT_ID))
        sent_evidence = generate.await_args.args[3]
        self.assertEqual(sent_evidence[0]["chunk_id"], 17)
        self.assertEqual(gateway.saved_payload["evidence_chunk_ids"], [17])
        self.assertEqual(gateway.saved_payload["evidence_snapshot"][0]["excerpt"], evidence_match()["excerpt"])
        self.assertEqual(result.status, "grounded")
        self.assertEqual(result.evidence[0].chunk_id, 17)

    def test_nonexistent_citation_is_rejected_without_saving(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                AsyncMock(return_value=grounded_draft(citation_id=999)),
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    generate_guidance_plan(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("grounding validation", context.exception.detail)
        self.assertIsNone(gateway.saved_payload)

    def test_provider_rejection_returns_safe_error_without_saving(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                AsyncMock(side_effect=GeminiGuidanceError("provider_rejected")),
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    generate_guidance_plan(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 502)
        self.assertEqual(
            context.exception.detail,
            "AI provider rejected the request. Check the backend configuration and server log.",
        )
        self.assertIsNone(gateway.saved_payload)

    def test_uncited_grounded_statement_is_rejected_without_saving(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        draft = grounded_draft()
        draft.guided_checks[0].citation_ids = []
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                AsyncMock(return_value=draft),
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    generate_guidance_plan(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 502)
        self.assertIsNone(gateway.saved_payload)

    def test_model_insufficient_evidence_result_has_no_guidance(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                AsyncMock(return_value=insufficient_model_draft()),
            ),
        ):
            result = asyncio.run(
                generate_guidance_plan(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(result.status, "insufficient_evidence")
        self.assertEqual(result.case_summary.text, INSUFFICIENT_SUMMARY)
        self.assertEqual(result.guided_checks, [])
        self.assertEqual(gateway.saved_payload["evidence_chunk_ids"], [])
        self.assertEqual(len(gateway.saved_payload["evidence_snapshot"]), 1)

    def test_no_matching_evidence_skips_gemini_and_saves_insufficient(self) -> None:
        gateway = FakeGuidanceGateway()
        gateway.matches = []
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        generate = AsyncMock()
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                generate,
            ),
        ):
            result = asyncio.run(
                generate_guidance_plan(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(),
                )
            )

        generate.assert_not_awaited()
        self.assertEqual(result.status, "insufficient_evidence")
        self.assertIsNone(result.model)

    def test_admin_can_read_saved_plan_but_cannot_generate(self) -> None:
        gateway = FakeGuidanceGateway()
        gateway.latest_record = {
            "id": PLAN_ID,
            "fault_report_id": str(REPORT_ID),
            "status": "grounded",
            "case_summary": grounded_draft().case_summary.model_dump(),
            "safety_brief_items": [item.model_dump() for item in grounded_draft().safety_brief_items],
            "guided_checks": [item.model_dump() for item in grounded_draft().guided_checks],
            "escalation_criteria": [item.model_dump() for item in grounded_draft().escalation_criteria],
            "evidence_chunk_ids": [17],
            "evidence_snapshot": [{key: value for key, value in evidence_match().items() if key != "relevance"}],
            "model": "gemini-3.8-flash",
            "created_by": TECHNICIAN_ID,
            "created_at": "2026-09-22T12:00:00Z",
        }
        member_authorization = AsyncMock(
            return_value=(gateway, {"id": "admin-id"}, "admin")
        )
        with patch(
            "app.routers.guidance.authorized_workspace_member",
            member_authorization,
        ):
            result = asyncio.run(
                get_guidance_plan(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    test_settings(gemini_key=""),
                )
            )

        self.assertEqual(result.status, "grounded")
        self.assertEqual(gateway.latest_scope[2], None)

        technician_authorization = AsyncMock(
            side_effect=HTTPException(status_code=403, detail="Technician access is required.")
        )
        with patch(
            "app.routers.guidance.authorized_workspace_technician",
            technician_authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    generate_guidance_plan(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "admin-token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
