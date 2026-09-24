"""Grounding, authorization, and persistence tests for guidance plans."""

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr

from app.gemini_guidance import (
    CitedStatement,
    GEMINI_MAX_OUTPUT_TOKENS,
    GEMINI_THINKING_LEVEL,
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
        schema = _provider_response_schema()
        schema_text = str(schema)

        self.assertNotIn("additionalProperties", schema_text)
        self.assertIn("evidence_citation_ids", schema_text)
        self.assertEqual(
            set(schema["required"]),
            {
                "status",
                "case_summary",
                "safety_brief_items",
                "guided_checks",
                "escalation_criteria",
                "evidence_citation_ids",
            },
        )

    def test_valid_json_fallback_uses_typed_structured_output_config(self) -> None:
        from google.genai import types as genai_types

        response = unittest.mock.MagicMock()
        response.parsed = None
        response.text = json.dumps(grounded_draft().model_dump())
        client = unittest.mock.MagicMock()
        client.models.generate_content.return_value = response

        with patch("google.genai.Client", return_value=client):
            result = _generate_sync(
                "test-api-key",
                "gemini-3.8-flash",
                {},
                [{"chunk_id": 17, "excerpt": "Approved evidence"}],
                report_id=str(REPORT_ID),
            )

        config = client.models.generate_content.call_args.kwargs["config"]
        self.assertIsInstance(config, genai_types.GenerateContentConfig)
        self.assertEqual(config.response_mime_type, "application/json")
        self.assertIsInstance(config.response_schema, dict)
        self.assertIn("evidence_citation_ids", str(config.response_schema))
        self.assertEqual(config.max_output_tokens, GEMINI_MAX_OUTPUT_TOKENS)
        self.assertEqual(
            config.thinking_config.thinking_level.value.lower(),
            GEMINI_THINKING_LEVEL,
        )
        self.assertEqual(result, grounded_draft())

    def test_fenced_json_fallback_is_validated(self) -> None:
        response = unittest.mock.MagicMock()
        response.parsed = None
        response.text = (
            "```json\n"
            + json.dumps(grounded_draft().model_dump())
            + "\n```"
        )
        client = unittest.mock.MagicMock()
        client.models.generate_content.return_value = response

        with patch("google.genai.Client", return_value=client):
            result = _generate_sync(
                "test-api-key",
                "gemini-3.8-flash",
                {},
                [{"chunk_id": 17, "excerpt": "Approved evidence"}],
            )

        self.assertEqual(result, grounded_draft())

    def test_sdk_parsed_response_is_preferred_over_text(self) -> None:
        response = unittest.mock.MagicMock()
        response.parsed = grounded_draft()
        response.text = "not valid json"
        client = unittest.mock.MagicMock()
        client.models.generate_content.return_value = response

        with patch("google.genai.Client", return_value=client):
            result = _generate_sync(
                "test-api-key",
                "gemini-3.8-flash",
                {},
                [{"chunk_id": 17, "excerpt": "Approved evidence"}],
            )

        self.assertEqual(result, grounded_draft())

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
            _generate_sync(
                api_key,
                "invalid-model",
                {},
                [],
                report_id=str(REPORT_ID),
            )

        log_output = "\n".join(logs.output)
        self.assertEqual(context.exception.code, "provider_rejected")
        self.assertIn("provider_http_status=404", log_output)
        self.assertIn("exception_class=ClientError", log_output)
        self.assertIn("exception_message=Model was not found", log_output)
        self.assertIn("exception_repr=ClientError", log_output)
        self.assertIn("model=invalid-model", log_output)
        self.assertIn(f"report_id={REPORT_ID}", log_output)
        self.assertIn("evidence_chunk_count=0", log_output)
        self.assertIn("[REDACTED]", log_output)
        self.assertNotIn(api_key, log_output)
        self.assertNotIn("must-not-be-logged", log_output)
        self.assertNotIn("\nCheck", log_output)

    def test_server_error_logs_safe_provider_diagnostics_and_context(self) -> None:
        from google.genai import errors as genai_errors

        api_key = "secret-server-test-api-key"
        bearer_token = "private-provider-bearer-token"
        evidence_text = "Private ACS580 evidence text that must never enter a server log."
        provider_error = genai_errors.ServerError(
            503,
            {
                "error": {
                    "code": 503,
                    "message": (
                        f"Service unavailable for {evidence_text} key={api_key} "
                        f"Authorization: Bearer {bearer_token}"
                    ),
                    "status": "UNAVAILABLE",
                    "details": {"provider_internal": "must-not-be-logged"},
                }
            },
        )
        client = unittest.mock.MagicMock()
        client.models.generate_content.side_effect = provider_error

        with (
            patch("google.genai.Client", return_value=client),
            patch("app.gemini_guidance.random.uniform", return_value=0.1),
            patch("app.gemini_guidance.time.sleep") as sleep,
            self.assertLogs("faulttrace.gemini", level="WARNING") as logs,
            self.assertRaises(GeminiGuidanceError) as context,
        ):
            _generate_sync(
                api_key,
                "gemini-3.8-flash",
                {"symptom": "Private reported symptom"},
                [{"chunk_id": 17, "excerpt": evidence_text}],
                report_id=str(REPORT_ID),
            )

        log_output = "\n".join(logs.output)
        self.assertEqual(context.exception.code, "provider_busy")
        self.assertEqual(client.models.generate_content.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertAlmostEqual(sleep.call_args_list[0].args[0], 0.6)
        self.assertAlmostEqual(sleep.call_args_list[1].args[0], 1.1)
        self.assertIn("exception_class=ServerError", log_output)
        self.assertIn("provider_http_status=503", log_output)
        self.assertIn("UNAVAILABLE", log_output)
        self.assertIn("model=gemini-3.8-flash", log_output)
        self.assertIn(f"report_id={REPORT_ID}", log_output)
        self.assertIn("evidence_chunk_count=1", log_output)
        self.assertIn("[CONTENT REDACTED]", log_output)
        self.assertNotIn(api_key, log_output)
        self.assertNotIn(bearer_token, log_output)
        self.assertNotIn(evidence_text, log_output)
        self.assertNotIn("must-not-be-logged", log_output)

    def test_429_and_503_retry_and_can_recover(self) -> None:
        from google.genai import errors as genai_errors

        for status_code, error_class in (
            (429, genai_errors.ClientError),
            (503, genai_errors.ServerError),
        ):
            with self.subTest(status_code=status_code):
                provider_error = error_class(
                    status_code,
                    {
                        "error": {
                            "code": status_code,
                            "message": "Provider is temporarily busy",
                            "status": "RESOURCE_EXHAUSTED" if status_code == 429 else "UNAVAILABLE",
                        }
                    },
                )
                successful_response = unittest.mock.MagicMock()
                successful_response.parsed = grounded_draft()
                client = unittest.mock.MagicMock()
                client.models.generate_content.side_effect = [
                    provider_error,
                    successful_response,
                ]

                with (
                    patch("google.genai.Client", return_value=client),
                    patch("app.gemini_guidance.random.uniform", return_value=0.05),
                    patch("app.gemini_guidance.time.sleep") as sleep,
                    self.assertLogs("faulttrace.gemini", level="WARNING") as logs,
                ):
                    result = _generate_sync(
                        "test-api-key",
                        "gemini-3.8-flash",
                        {},
                        [{"chunk_id": 17, "excerpt": "Approved evidence"}],
                        report_id=str(REPORT_ID),
                    )

                self.assertEqual(result.status, "grounded")
                self.assertEqual(client.models.generate_content.call_count, 2)
                sleep.assert_called_once()
                self.assertAlmostEqual(sleep.call_args.args[0], 0.55)
                self.assertIn("attempt=1 retrying=True", "\n".join(logs.output))

    def test_authentication_and_validation_errors_are_not_retried(self) -> None:
        from google.genai import errors as genai_errors

        for status_code in (400, 401, 403):
            with self.subTest(status_code=status_code):
                provider_error = genai_errors.ClientError(
                    status_code,
                    {
                        "error": {
                            "code": status_code,
                            "message": "Request rejected",
                            "status": "INVALID_ARGUMENT",
                        }
                    },
                )
                client = unittest.mock.MagicMock()
                client.models.generate_content.side_effect = provider_error

                with (
                    patch("google.genai.Client", return_value=client),
                    patch("app.gemini_guidance.time.sleep") as sleep,
                    self.assertLogs("faulttrace.gemini", level="WARNING"),
                    self.assertRaises(GeminiGuidanceError) as context,
                ):
                    _generate_sync("test-api-key", "gemini-3.8-flash", {}, [])

                self.assertEqual(context.exception.code, "provider_rejected")
                self.assertEqual(client.models.generate_content.call_count, 1)
                sleep.assert_not_called()

    def test_invalid_structured_response_is_not_retried(self) -> None:
        response = unittest.mock.MagicMock()
        response.parsed = None
        response.text = "not valid json private-document-fragment"
        response.candidates = [
            unittest.mock.Mock(finish_reason=unittest.mock.Mock(value="MAX_TOKENS"))
        ]
        client = unittest.mock.MagicMock()
        client.models.generate_content.return_value = response

        with (
            patch("google.genai.Client", return_value=client),
            patch("app.gemini_guidance.time.sleep") as sleep,
            self.assertLogs("faulttrace.gemini", level="WARNING") as logs,
            self.assertRaises(GeminiGuidanceError) as context,
        ):
            _generate_sync("test-api-key", "gemini-3.8-flash", {}, [])

        self.assertEqual(context.exception.code, "invalid_structured_response")
        self.assertEqual(client.models.generate_content.call_count, 1)
        sleep.assert_not_called()
        log_output = "\n".join(logs.output)
        self.assertIn("reason=invalid_json", log_output)
        self.assertIn("json_error=Expecting value", log_output)
        self.assertIn("finish_reason=MAX_TOKENS", log_output)
        self.assertNotIn("private-document-fragment", log_output)

    def test_missing_structured_fields_are_logged_without_response_values(self) -> None:
        response = unittest.mock.MagicMock()
        response.parsed = None
        response.text = json.dumps(
            {
                "status": "insufficient_evidence",
                "case_summary": {
                    "text": "private-summary-value",
                    "citation_ids": [],
                },
                "private_field": "do-not-log-this-value",
            }
        )
        client = unittest.mock.MagicMock()
        client.models.generate_content.return_value = response

        with (
            patch("google.genai.Client", return_value=client),
            self.assertLogs("faulttrace.gemini", level="WARNING") as logs,
            self.assertRaises(GeminiGuidanceError) as context,
        ):
            _generate_sync(
                "test-api-key",
                "gemini-3.8-flash",
                {},
                [{"chunk_id": 17, "excerpt": "Approved evidence"}],
                report_id=str(REPORT_ID),
            )

        log_output = "\n".join(logs.output)
        self.assertEqual(context.exception.code, "invalid_structured_response")
        self.assertIn("reason=schema_validation", log_output)
        self.assertIn('\"field\":\"safety_brief_items\"', log_output)
        self.assertIn('\"type\":\"missing\"', log_output)
        self.assertNotIn("private-summary-value", log_output)
        self.assertNotIn("do-not-log-this-value", log_output)

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
        self.assertEqual(generate.await_args.kwargs["report_id"], str(REPORT_ID))
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
            self.assertLogs("faulttrace.guidance", level="WARNING") as logs,
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
        log_output = "\n".join(logs.output)
        self.assertIn("grounded statement cited unavailable evidence", log_output)
        self.assertIn(f"report_id={REPORT_ID}", log_output)
        self.assertNotIn(evidence_match()["excerpt"], log_output)

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

    def test_invalid_structured_result_returns_generic_error_without_saving(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                AsyncMock(
                    side_effect=GeminiGuidanceError("invalid_structured_response")
                ),
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
            "AI service returned an invalid structured result. No guidance plan was saved.",
        )
        self.assertIsNone(gateway.saved_payload)

    def test_provider_busy_failure_returns_temporary_ui_error_without_saving(self) -> None:
        gateway = FakeGuidanceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with (
            patch(
                "app.routers.guidance.authorized_workspace_technician",
                authorization,
            ),
            patch(
                "app.routers.guidance.generate_guidance_with_gemini",
                AsyncMock(side_effect=GeminiGuidanceError("provider_busy")),
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
            (
                "The AI service is temporarily busy. "
                "Try again shortly. No guidance plan was saved."
            ),
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

    def test_technician_can_read_saved_plan_for_shared_resolved_report(self) -> None:
        gateway = FakeGuidanceGateway()
        other_technician_id = "77777777-7777-7777-7777-777777777777"
        gateway.report = active_report(
            status="resolved",
            created_by=other_technician_id,
        )
        gateway.latest_record = {
            "id": PLAN_ID,
            "fault_report_id": str(REPORT_ID),
            "status": "grounded",
            "case_summary": grounded_draft().case_summary.model_dump(),
            "safety_brief_items": [item.model_dump() for item in grounded_draft().safety_brief_items],
            "guided_checks": [item.model_dump() for item in grounded_draft().guided_checks],
            "escalation_criteria": [item.model_dump() for item in grounded_draft().escalation_criteria],
            "evidence_chunk_ids": [17],
            "evidence_snapshot": [
                {key: value for key, value in evidence_match().items() if key != "relevance"}
            ],
            "model": "gemini-3.8-flash",
            "created_by": other_technician_id,
            "created_at": "2026-09-22T12:00:00Z",
        }
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )

        with patch(
            "app.routers.guidance.authorized_workspace_member",
            authorization,
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
        self.assertEqual(gateway.report_scope[2], None)
        self.assertEqual(gateway.latest_scope[2], None)


if __name__ == "__main__":
    unittest.main()
