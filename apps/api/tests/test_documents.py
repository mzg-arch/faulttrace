"""Document library authorization, scoping, and file validation tests."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr

from app.routers.documents import (
    MAX_DOCUMENT_BYTES,
    SIGNED_URL_SECONDS,
    access_document,
    archive_document,
    index_document,
    index_pdf_content,
    list_documents,
    sanitize_filename,
    upload_document,
    validate_document_file,
)
from app.pdf_indexing import DocumentChunk, PdfExtractionResult
from app.settings import Settings


WORKSPACE_ID = UUID("11111111-1111-1111-1111-111111111111")
DOCUMENT_ID = UUID("22222222-2222-2222-2222-222222222222")
EQUIPMENT_ID = UUID("33333333-3333-3333-3333-333333333333")


def test_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example_key_1234567890",
        supabase_secret_key=SecretStr("sb_secret_example_key_1234567890"),
        cors_origins="http://localhost:3000",
    )


def document_record(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "id": str(DOCUMENT_ID),
        "title": "ACS580 Hardware Manual",
        "document_type": "manual",
        "status": "approved",
        "equipment_id": str(EQUIPMENT_ID),
        "source_revision": "Rev C",
        "description": "Approved drive installation and service manual.",
        "file_name": "acs580-hardware-manual.pdf",
        "content_type": "application/pdf",
        "size_bytes": 1024,
        "index_status": "not_indexed",
        "indexed_at": None,
        "indexed_page_count": 0,
        "indexed_chunk_count": 0,
        "indexing_error_code": None,
        "created_at": "2026-09-21T12:00:00Z",
        "updated_at": "2026-09-21T12:00:00Z",
    }
    record.update(overrides)
    return record


class FakeDocumentGateway:
    def __init__(self) -> None:
        self.include_archived: bool | None = None
        self.equipment_include_archived: bool | None = None
        self.listed_equipment: list[dict[str, object]] = [
            {
                "id": str(EQUIPMENT_ID),
                "name": "ACS580 Drive",
                "asset_tag": "FT-DRV-001",
                "status": "active",
            }
        ]
        self.access_record: dict[str, object] | None = {
            "id": str(DOCUMENT_ID),
            "status": "approved",
            "storage_path": f"{WORKSPACE_ID}/{DOCUMENT_ID}/manual.pdf",
            "file_name": "manual.pdf",
        }
        self.access_scope: tuple[str, str] | None = None
        self.signed_request: tuple[str, int] | None = None
        self.archive_scope: tuple[str, str] | None = None
        self.upload_called = False
        self.uploaded_file: tuple[str, str, bytes] | None = None
        self.created_payload: dict[str, object] | None = None
        self.return_empty_create = False
        self.removed_path: str | None = None
        self.index_status_values: dict[str, object] | None = None
        self.index_status_history: list[dict[str, object]] = []
        self.replaced_chunks: list[dict[str, object]] | None = None
        self.index_document_scope: tuple[str, str] | None = None
        self.downloaded_path: str | None = None
        self.equipment_record: dict[str, object] | None = {
            "id": str(EQUIPMENT_ID),
            "name": "ACS580 Drive",
            "asset_tag": "FT-DRV-001",
            "status": "active",
        }

    async def list_documents(
        self,
        _workspace_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, object]]:
        self.include_archived = include_archived
        return [document_record()]

    async def list_equipment(
        self,
        _workspace_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, object]]:
        self.equipment_include_archived = include_archived
        return self.listed_equipment

    async def get_document_for_access(
        self,
        workspace_id: str,
        document_id: str,
    ) -> dict[str, object] | None:
        self.access_scope = (workspace_id, document_id)
        return self.access_record

    async def get_document_for_index(
        self,
        workspace_id: str,
        document_id: str,
    ) -> dict[str, object] | None:
        self.index_document_scope = (workspace_id, document_id)
        return {
            **document_record(),
            "workspace_id": str(WORKSPACE_ID),
            "storage_path": f"{WORKSPACE_ID}/{DOCUMENT_ID}/manual.pdf",
        }

    async def download_document_file(self, storage_path: str) -> bytes:
        self.downloaded_path = storage_path
        return b"%PDF-1.7\ntext"

    async def create_document_signed_url(
        self,
        storage_path: str,
        *,
        expires_in: int,
    ) -> str:
        self.signed_request = (storage_path, expires_in)
        return "https://example.supabase.co/storage/v1/object/sign/private/token"

    async def archive_document(
        self,
        workspace_id: str,
        document_id: str,
    ) -> dict[str, object]:
        self.archive_scope = (workspace_id, document_id)
        return document_record(status="archived")

    async def get_equipment(
        self,
        _workspace_id: str,
        _equipment_id: str,
    ) -> dict[str, object] | None:
        return self.equipment_record

    async def upload_document_file(
        self,
        storage_path: str,
        content_type: str,
        content: bytes,
    ) -> None:
        self.upload_called = True
        self.uploaded_file = (storage_path, content_type, content)

    async def create_document(
        self,
        payload: dict[str, object],
    ) -> dict[str, object]:
        self.created_payload = payload
        if self.return_empty_create:
            return {}
        return document_record(**payload)

    async def remove_document_file(self, storage_path: str) -> None:
        self.removed_path = storage_path

    async def update_document_index_status(
        self,
        _workspace_id: str,
        _document_id: str,
        values: dict[str, object],
    ) -> dict[str, object]:
        self.index_status_values = values
        self.index_status_history.append(values)
        return document_record(**values)

    async def replace_document_chunks(
        self,
        _workspace_id: str,
        _document_id: str,
        chunks: list[dict[str, object]],
    ) -> None:
        self.replaced_chunks = chunks


class FakeUpload:
    filename = "manual.pdf"
    content_type = "application/pdf"

    def __init__(self) -> None:
        self.content = b"%PDF-1.7\n"

    async def read(self, _size: int) -> bytes:
        content, self.content = self.content, b""
        return content

    async def close(self) -> None:
        return None


class FakeRequest:
    async def form(self) -> dict[str, object]:
        return {
            "title": "Drive manual",
            "document_type": "manual",
            "equipment_id": str(EQUIPMENT_ID),
            "source_revision": "Rev C",
            "description": "Approved source",
            "file": FakeUpload(),
        }


class DocumentFileValidationTests(unittest.TestCase):
    def test_valid_pdf_is_accepted_and_filename_is_sanitized(self) -> None:
        filename = validate_document_file(
            "../ACS580 Service Manual.pdf",
            "application/pdf",
            b"%PDF-1.7\ncontent",
        )

        self.assertEqual(filename, "ACS580-Service-Manual.pdf")
        self.assertEqual(sanitize_filename(r"..\diagrams\panel layout.png"), "panel-layout.png")

    def test_spoofed_file_type_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as context:
            validate_document_file("manual.pdf", "application/pdf", b"not a pdf")

        self.assertEqual(context.exception.status_code, 415)

    def test_file_over_size_limit_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as context:
            validate_document_file(
                "manual.pdf",
                "application/pdf",
                b"%PDF-" + (b"x" * MAX_DOCUMENT_BYTES),
            )

        self.assertEqual(context.exception.status_code, 413)

    def test_pdf_without_readable_text_is_marked_no_text_and_chunks_are_cleared(self) -> None:
        gateway = FakeDocumentGateway()
        with patch(
            "app.routers.documents.extract_pdf_chunks",
            return_value=PdfExtractionResult(readable_page_count=0, chunks=[]),
        ):
            result = asyncio.run(
                index_pdf_content(
                    gateway,  # type: ignore[arg-type]
                    WORKSPACE_ID,
                    document_record(),
                    b"%PDF-scanned",
                )
            )

        self.assertEqual(result["index_status"], "no_text")
        self.assertEqual(result["indexing_error_code"], "no_readable_text")
        self.assertEqual(gateway.replaced_chunks, [])
        self.assertEqual(gateway.index_status_history[0]["index_status"], "indexing")
        self.assertEqual(gateway.index_status_history[-1]["index_status"], "no_text")


class DocumentEndpointTests(unittest.TestCase):
    def test_technician_list_excludes_non_approved_documents(self) -> None:
        gateway = FakeDocumentGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": "caller-id"}, "technician")
        )
        with patch("app.routers.documents.authorized_workspace_member", authorization):
            records = asyncio.run(
                list_documents(WORKSPACE_ID, "token", test_settings())
            )

        self.assertEqual(len(records), 1)
        self.assertFalse(gateway.include_archived)
        self.assertFalse(gateway.equipment_include_archived)

    def test_admin_list_includes_archived_documents(self) -> None:
        gateway = FakeDocumentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}, "admin"))
        with patch("app.routers.documents.authorized_workspace_member", authorization):
            asyncio.run(list_documents(WORKSPACE_ID, "token", test_settings()))

        self.assertTrue(gateway.include_archived)
        self.assertTrue(gateway.equipment_include_archived)

    def test_technician_document_hides_an_archived_equipment_link(self) -> None:
        gateway = FakeDocumentGateway()
        gateway.listed_equipment = []
        authorization = AsyncMock(
            return_value=(gateway, {"id": "caller-id"}, "technician")
        )
        with patch("app.routers.documents.authorized_workspace_member", authorization):
            records = asyncio.run(
                list_documents(WORKSPACE_ID, "token", test_settings())
            )

        self.assertIsNone(records[0].equipment_id)
        self.assertIsNone(records[0].equipment_name)

    def test_technician_cannot_archive_document(self) -> None:
        authorization = AsyncMock(
            side_effect=HTTPException(status_code=403, detail="Admin access is required.")
        )
        with patch("app.routers.documents.authorized_workspace_admin", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    archive_document(
                        WORKSPACE_ID,
                        DOCUMENT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)

    def test_technician_cannot_index_document(self) -> None:
        authorization = AsyncMock(
            side_effect=HTTPException(status_code=403, detail="Admin access is required.")
        )
        with patch("app.routers.documents.authorized_workspace_admin", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    index_document(
                        WORKSPACE_ID,
                        DOCUMENT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)

    def test_admin_explicit_index_is_workspace_scoped_and_page_aware(self) -> None:
        gateway = FakeDocumentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        extraction = PdfExtractionResult(
            readable_page_count=1,
            chunks=[
                DocumentChunk(
                    page_number=17,
                    chunk_index=0,
                    content="F0001 start permissive evidence.",
                )
            ],
        )
        with (
            patch("app.routers.documents.authorized_workspace_admin", authorization),
            patch("app.routers.documents.extract_pdf_chunks", return_value=extraction),
        ):
            result = asyncio.run(
                index_document(
                    WORKSPACE_ID,
                    DOCUMENT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.index_document_scope,
            (str(WORKSPACE_ID), str(DOCUMENT_ID)),
        )
        self.assertEqual(
            gateway.downloaded_path,
            f"{WORKSPACE_ID}/{DOCUMENT_ID}/manual.pdf",
        )
        self.assertEqual(result.index_status, "indexed")
        self.assertEqual(result.indexed_page_count, 1)
        self.assertEqual(gateway.replaced_chunks[0]["page_number"], 17)

    def test_technician_cannot_open_archived_document(self) -> None:
        gateway = FakeDocumentGateway()
        gateway.access_record = {
            "id": str(DOCUMENT_ID),
            "status": "archived",
            "storage_path": f"{WORKSPACE_ID}/{DOCUMENT_ID}/manual.pdf",
            "file_name": "manual.pdf",
        }
        authorization = AsyncMock(
            return_value=(gateway, {"id": "caller-id"}, "technician")
        )
        with patch("app.routers.documents.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    access_document(
                        WORKSPACE_ID,
                        DOCUMENT_ID,
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertIsNone(gateway.signed_request)

    def test_document_access_is_workspace_scoped_and_short_lived(self) -> None:
        gateway = FakeDocumentGateway()
        authorization = AsyncMock(
            return_value=(gateway, {"id": "caller-id"}, "technician")
        )
        with patch("app.routers.documents.authorized_workspace_member", authorization):
            result = asyncio.run(
                access_document(
                    WORKSPACE_ID,
                    DOCUMENT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.access_scope,
            (str(WORKSPACE_ID), str(DOCUMENT_ID)),
        )
        self.assertEqual(gateway.signed_request[1], SIGNED_URL_SECONDS)
        self.assertEqual(result.expires_in, SIGNED_URL_SECONDS)

    def test_archive_is_scoped_to_path_workspace(self) -> None:
        gateway = FakeDocumentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        with patch("app.routers.documents.authorized_workspace_admin", authorization):
            result = asyncio.run(
                archive_document(
                    WORKSPACE_ID,
                    DOCUMENT_ID,
                    "token",
                    test_settings(),
                )
            )

        self.assertEqual(
            gateway.archive_scope,
            (str(WORKSPACE_ID), str(DOCUMENT_ID)),
        )
        self.assertEqual(result.status, "archived")

    def test_upload_rejects_equipment_from_another_workspace_before_storage(self) -> None:
        gateway = FakeDocumentGateway()
        gateway.equipment_record = None
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        with patch("app.routers.documents.authorized_workspace_admin", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    upload_document(
                        WORKSPACE_ID,
                        FakeRequest(),  # type: ignore[arg-type]
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 422)
        self.assertFalse(gateway.upload_called)

    def test_admin_upload_uses_private_workspace_path_and_approval_metadata(self) -> None:
        gateway = FakeDocumentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        extraction = PdfExtractionResult(
            readable_page_count=1,
            chunks=[DocumentChunk(page_number=1, chunk_index=0, content="Approved PDF text")],
        )
        with (
            patch("app.routers.documents.authorized_workspace_admin", authorization),
            patch("app.routers.documents.extract_pdf_chunks", return_value=extraction),
        ):
            result = asyncio.run(
                upload_document(
                    WORKSPACE_ID,
                    FakeRequest(),  # type: ignore[arg-type]
                    "token",
                    test_settings(),
                )
            )

        storage_path, content_type, content = gateway.uploaded_file
        self.assertTrue(storage_path.startswith(f"{WORKSPACE_ID}/"))
        self.assertTrue(storage_path.endswith("/manual.pdf"))
        self.assertEqual(content_type, "application/pdf")
        self.assertTrue(content.startswith(b"%PDF-"))
        self.assertEqual(gateway.created_payload["workspace_id"], str(WORKSPACE_ID))
        self.assertEqual(gateway.created_payload["created_by"], "caller-id")
        self.assertEqual(gateway.created_payload["approved_by"], "caller-id")
        self.assertEqual(gateway.created_payload["status"], "approved")
        self.assertEqual(result.status, "approved")

    def test_orphaned_file_is_removed_when_metadata_creation_is_empty(self) -> None:
        gateway = FakeDocumentGateway()
        gateway.return_empty_create = True
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        with patch("app.routers.documents.authorized_workspace_admin", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    upload_document(
                        WORKSPACE_ID,
                        FakeRequest(),  # type: ignore[arg-type]
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 502)
        self.assertEqual(gateway.removed_path, gateway.uploaded_file[0])


if __name__ == "__main__":
    unittest.main()
