"""PDF extraction and grounded evidence retrieval tests."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr

from app.pdf_indexing import MAX_CHUNK_CHARACTERS, extract_pdf_chunks
from app.routers.evidence import EVIDENCE_URL_SECONDS, retrieve_evidence
from app.settings import Settings


WORKSPACE_ID = UUID("11111111-1111-1111-1111-111111111111")
OTHER_WORKSPACE_ID = UUID("99999999-9999-9999-9999-999999999999")
REPORT_ID = UUID("22222222-2222-2222-2222-222222222222")
EQUIPMENT_ID = UUID("33333333-3333-3333-3333-333333333333")
DOCUMENT_ID = UUID("55555555-5555-5555-5555-555555555555")
TECHNICIAN_ID = "44444444-4444-4444-4444-444444444444"


def test_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example_key_1234567890",
        supabase_secret_key=SecretStr("sb_secret_example_key_1234567890"),
        cors_origins="http://localhost:3000",
    )


class FakePage:
    def __init__(self, text: str | None) -> None:
        self.text = text

    def extract_text(self) -> str | None:
        return self.text


def reader_with_pages(*page_text: str | None):
    class FakeReader:
        is_encrypted = False

        def __init__(self, _stream: object) -> None:
            self.pages = [FakePage(text) for text in page_text]

    return FakeReader


def active_report(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "id": str(REPORT_ID),
        "equipment_id": str(EQUIPMENT_ID),
        "fault_code": "F0001",
        "symptom": "ACS580 drive will not start after a permissive is lost.",
        "planned_task": "Verify start permissives.",
        "status": "active",
        "created_by": TECHNICIAN_ID,
    }
    record.update(overrides)
    return record


def evidence_match(**overrides: object) -> dict[str, object]:
    match: dict[str, object] = {
        "chunk_id": 17,
        "document_id": str(DOCUMENT_ID),
        "document_title": "ACS580 Hardware Manual",
        "document_type": "manual",
        "source_revision": "Rev C",
        "page_number": 17,
        "excerpt": "Check that the start permissive input is present before enabling the drive.",
        "equipment_linked": True,
        "relevance": 0.83,
    }
    match.update(overrides)
    return match


class FakeEvidenceGateway:
    def __init__(self) -> None:
        self.report: dict[str, object] | None = active_report()
        self.matches: list[dict[str, object]] = [evidence_match()]
        self.document: dict[str, object] | None = {
            "id": str(DOCUMENT_ID),
            "status": "approved",
            "storage_path": f"{WORKSPACE_ID}/{DOCUMENT_ID}/manual.pdf",
            "file_name": "manual.pdf",
            "content_type": "application/pdf",
        }
        self.report_scope: tuple[str, str, str | None] | None = None
        self.search_scope: tuple[str, str, str, int] | None = None
        self.document_scope: tuple[str, str] | None = None
        self.signed_scope: tuple[str, int] | None = None

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
        workspace_id: str,
        document_id: str,
    ) -> dict[str, object] | None:
        self.document_scope = (workspace_id, document_id)
        return self.document

    async def create_document_signed_url(
        self,
        storage_path: str,
        *,
        expires_in: int,
    ) -> str:
        self.signed_scope = (storage_path, expires_in)
        return "https://example.supabase.co/storage/v1/object/sign/source?token=redacted"


class PdfExtractionTests(unittest.TestCase):
    def test_extraction_preserves_page_numbers_and_page_aware_chunks(self) -> None:
        long_text = (
            "F0001 start permissive troubleshooting evidence. "
            "Verify the approved isolation procedure before inspection. " * 30
        )
        result = extract_pdf_chunks(
            b"%PDF-fake",
            reader_factory=reader_with_pages("cover", long_text, "Page three has readable drive reset information."),
        )

        self.assertEqual(result.readable_page_count, 2)
        self.assertGreater(len(result.chunks), 1)
        self.assertTrue(all(chunk.page_number in {2, 3} for chunk in result.chunks))
        self.assertEqual(result.chunks[0].page_number, 2)
        self.assertIn("F0001 start permissive", result.chunks[0].content)
        self.assertTrue(all(len(chunk.content) <= MAX_CHUNK_CHARACTERS for chunk in result.chunks))

    def test_scanned_or_empty_pdf_has_no_readable_chunks_without_ocr(self) -> None:
        result = extract_pdf_chunks(
            b"%PDF-scanned",
            reader_factory=reader_with_pages(None, "", "Page 3"),
        )

        self.assertEqual(result.readable_page_count, 0)
        self.assertEqual(result.chunks, [])


class EvidenceRetrievalTests(unittest.TestCase):
    def test_technician_retrieval_is_scoped_and_returns_exact_page_citation(self) -> None:
        gateway = FakeEvidenceGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.evidence.authorized_workspace_member", authorization):
            result = asyncio.run(
                retrieve_evidence(WORKSPACE_ID, REPORT_ID, "token", test_settings())
            )

        self.assertEqual(
            gateway.report_scope,
            (str(WORKSPACE_ID), str(REPORT_ID), TECHNICIAN_ID),
        )
        self.assertEqual(gateway.search_scope[0], str(WORKSPACE_ID))
        self.assertEqual(gateway.search_scope[1], str(EQUIPMENT_ID))
        self.assertIn('"f0001"', gateway.search_scope[2])
        self.assertIn('"acs580"', gateway.search_scope[2])
        self.assertEqual(gateway.document_scope, (str(WORKSPACE_ID), str(DOCUMENT_ID)))
        self.assertEqual(gateway.signed_scope[1], EVIDENCE_URL_SECONDS)
        self.assertEqual(result.evidence[0].page_number, 17)
        self.assertEqual(result.evidence[0].chunk_id, 17)
        self.assertEqual(
            result.evidence[0].excerpt,
            evidence_match()["excerpt"],
        )
        self.assertEqual(result.evidence[0].source_revision, "Rev C")

    def test_admin_can_read_active_report_evidence_in_workspace(self) -> None:
        gateway = FakeEvidenceGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "admin-id"}, "admin"))
        with patch("app.routers.evidence.authorized_workspace_member", authorization):
            result = asyncio.run(
                retrieve_evidence(WORKSPACE_ID, REPORT_ID, "token", test_settings())
            )

        self.assertEqual(gateway.report_scope[2], None)
        self.assertEqual(len(result.evidence), 1)

    def test_report_from_another_workspace_is_not_searchable(self) -> None:
        gateway = FakeEvidenceGateway()
        gateway.report = None
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.evidence.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    retrieve_evidence(
                        OTHER_WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertIsNone(gateway.search_scope)

    def test_draft_report_cannot_retrieve_evidence(self) -> None:
        gateway = FakeEvidenceGateway()
        gateway.report = active_report(status="draft")
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.evidence.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    retrieve_evidence(WORKSPACE_ID, REPORT_ID, "token", test_settings())
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIsNone(gateway.search_scope)

    def test_archived_or_non_pdf_document_match_is_filtered_before_signing(self) -> None:
        for document_override in (
            {"status": "archived"},
            {"content_type": "image/png"},
        ):
            with self.subTest(document_override=document_override):
                gateway = FakeEvidenceGateway()
                gateway.document = {
                    **gateway.document,
                    **document_override,
                }
                authorization = AsyncMock(
                    return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
                )
                with patch(
                    "app.routers.evidence.authorized_workspace_member",
                    authorization,
                ):
                    result = asyncio.run(
                        retrieve_evidence(
                            WORKSPACE_ID,
                            REPORT_ID,
                            "token",
                            test_settings(),
                        )
                    )

                self.assertEqual(result.evidence, [])
                self.assertIn("No matching approved PDF evidence", result.message)
                self.assertIsNone(gateway.signed_scope)

    def test_no_lexical_matches_returns_clear_no_evidence_result(self) -> None:
        gateway = FakeEvidenceGateway()
        gateway.matches = []
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.evidence.authorized_workspace_member", authorization):
            result = asyncio.run(
                retrieve_evidence(WORKSPACE_ID, REPORT_ID, "token", test_settings())
            )

        self.assertEqual(result.evidence, [])
        self.assertIn("No matching approved PDF evidence", result.message)
        self.assertIsNone(gateway.document_scope)


if __name__ == "__main__":
    unittest.main()
