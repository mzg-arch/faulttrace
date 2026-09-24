"""Fault-report photo validation, authorization, and workspace-scoping tests."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr

from app.routers.attachments import (
    MAX_ATTACHMENT_BYTES,
    SIGNED_URL_SECONDS,
    access_fault_report_attachment,
    delete_fault_report_attachment,
    list_fault_report_attachments,
    upload_fault_report_attachment,
    validate_attachment_file,
)
from app.settings import Settings
from app.supabase import SupabaseRequestError


WORKSPACE_ID = UUID("11111111-1111-1111-1111-111111111111")
OTHER_WORKSPACE_ID = UUID("99999999-9999-9999-9999-999999999999")
REPORT_ID = UUID("22222222-2222-2222-2222-222222222222")
ATTACHMENT_ID = UUID("33333333-3333-3333-3333-333333333333")
TECHNICIAN_ID = "44444444-4444-4444-4444-444444444444"
OTHER_TECHNICIAN_ID = "77777777-7777-7777-7777-777777777777"


def attachment_settings() -> Settings:
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
        "workspace_id": str(WORKSPACE_ID),
        "equipment_id": "55555555-5555-5555-5555-555555555555",
        "status": "active",
        "created_by": TECHNICIAN_ID,
    }
    record.update(overrides)
    return record


def attachment_record(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "id": str(ATTACHMENT_ID),
        "workspace_id": str(WORKSPACE_ID),
        "fault_report_id": str(REPORT_ID),
        "uploaded_by_user_id": TECHNICIAN_ID,
        "storage_path": (
            f"{WORKSPACE_ID}/{REPORT_ID}/{ATTACHMENT_ID}/motor-terminal.jpg"
        ),
        "file_name": "motor-terminal.jpg",
        "mime_type": "image/jpeg",
        "size_bytes": 128,
        "created_at": "2026-09-23T18:00:00Z",
    }
    record.update(overrides)
    return record


class FakeAttachmentGateway:
    def __init__(self) -> None:
        self.report: dict[str, object] | None = report_record()
        self.attachments: list[dict[str, object]] = [attachment_record()]
        self.get_report_scope: tuple[str, str, str | None] | None = None
        self.list_scope: tuple[str, str] | None = None
        self.get_attachment_scope: tuple[str, str, str] | None = None
        self.uploaded_file: tuple[str, str, bytes] | None = None
        self.created_payload: dict[str, object] | None = None
        self.deleted_scope: tuple[str, str, str, str] | None = None
        self.removed_path: str | None = None
        self.signed_scope: tuple[str, int] | None = None
        self.create_error: SupabaseRequestError | None = None

    async def get_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        *,
        created_by: str | None,
    ) -> dict[str, object] | None:
        self.get_report_scope = (workspace_id, report_id, created_by)
        return self.report

    async def list_fault_report_attachments(
        self,
        workspace_id: str,
        report_id: str,
    ) -> list[dict[str, object]]:
        self.list_scope = (workspace_id, report_id)
        return self.attachments

    async def get_fault_report_attachment(
        self,
        workspace_id: str,
        report_id: str,
        attachment_id: str,
    ) -> dict[str, object] | None:
        self.get_attachment_scope = (workspace_id, report_id, attachment_id)
        return self.attachments[0] if self.attachments else None

    async def upload_fault_report_attachment_file(
        self,
        storage_path: str,
        content_type: str,
        content: bytes,
    ) -> None:
        self.uploaded_file = (storage_path, content_type, content)

    async def create_fault_report_attachment(
        self,
        payload: dict[str, object],
    ) -> dict[str, object]:
        self.created_payload = payload
        if self.create_error:
            raise self.create_error
        return attachment_record(**payload)

    async def delete_draft_fault_report_attachment(
        self,
        workspace_id: str,
        report_id: str,
        attachment_id: str,
        user_id: str,
    ) -> dict[str, object]:
        self.deleted_scope = (workspace_id, report_id, attachment_id, user_id)
        return self.attachments[0]

    async def remove_fault_report_attachment_file(self, storage_path: str) -> None:
        self.removed_path = storage_path

    async def create_fault_report_attachment_signed_url(
        self,
        storage_path: str,
        *,
        expires_in: int,
    ) -> str:
        self.signed_scope = (storage_path, expires_in)
        return "https://example.supabase.co/storage/v1/object/sign/photo?token=redacted"


class FakeUpload:
    def __init__(
        self,
        *,
        filename: str = "motor terminal.jpg",
        content_type: str = "image/jpeg",
        content: bytes = b"\xff\xd8\xffphoto",
    ) -> None:
        self.filename = filename
        self.content_type = content_type
        self.content = content
        self.closed = False

    async def read(self, _size: int) -> bytes:
        content, self.content = self.content, b""
        return content

    async def close(self) -> None:
        self.closed = True


class FakeRequest:
    def __init__(self, upload: FakeUpload | None = None) -> None:
        self.upload = upload or FakeUpload()

    async def form(self) -> dict[str, object]:
        return {"file": self.upload}


class AttachmentFileValidationTests(unittest.TestCase):
    def test_supported_images_require_matching_extension_mime_and_signature(self) -> None:
        cases = [
            ("panel.jpg", "image/jpeg", b"\xff\xd8\xffdata"),
            ("panel.jpeg", "image/jpeg", b"\xff\xd8\xffdata"),
            ("panel.png", "image/png", b"\x89PNG\r\n\x1a\ndata"),
            ("panel.webp", "image/webp", b"RIFF\x04\x00\x00\x00WEBPdata"),
        ]
        for filename, mime_type, content in cases:
            with self.subTest(filename=filename):
                self.assertEqual(
                    validate_attachment_file(filename, mime_type, content),
                    filename,
                )

    def test_mismatched_extension_or_spoofed_contents_are_rejected(self) -> None:
        with self.assertRaises(HTTPException) as mismatch:
            validate_attachment_file("panel.png", "image/jpeg", b"\xff\xd8\xffdata")
        self.assertEqual(mismatch.exception.status_code, 415)

        with self.assertRaises(HTTPException) as spoofed:
            validate_attachment_file("panel.jpg", "image/jpeg", b"not-an-image")
        self.assertEqual(spoofed.exception.status_code, 415)

    def test_unsupported_type_and_oversize_file_are_rejected(self) -> None:
        with self.assertRaises(HTTPException) as unsupported:
            validate_attachment_file("panel.gif", "image/gif", b"GIF89a")
        self.assertEqual(unsupported.exception.status_code, 415)

        with self.assertRaises(HTTPException) as oversized:
            validate_attachment_file(
                "panel.jpg",
                "image/jpeg",
                b"\xff\xd8\xff" + (b"x" * MAX_ATTACHMENT_BYTES),
            )
        self.assertEqual(oversized.exception.status_code, 413)


class AttachmentEndpointTests(unittest.TestCase):
    def test_owner_uploads_to_private_workspace_report_path(self) -> None:
        gateway = FakeAttachmentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with patch(
            "app.routers.attachments.authorized_workspace_technician",
            authorization,
        ):
            result = asyncio.run(
                upload_fault_report_attachment(
                    WORKSPACE_ID,
                    REPORT_ID,
                    FakeRequest(),  # type: ignore[arg-type]
                    "token",
                    attachment_settings(),
                )
            )

        storage_path, mime_type, content = gateway.uploaded_file
        self.assertTrue(storage_path.startswith(f"{WORKSPACE_ID}/{REPORT_ID}/"))
        self.assertTrue(storage_path.endswith("/motor-terminal.jpg"))
        self.assertEqual(mime_type, "image/jpeg")
        self.assertTrue(content.startswith(b"\xff\xd8\xff"))
        self.assertEqual(gateway.created_payload["uploaded_by_user_id"], TECHNICIAN_ID)
        self.assertFalse(result.can_delete)

    def test_resolved_report_rejects_upload_before_storage(self) -> None:
        gateway = FakeAttachmentGateway()
        gateway.report = report_record(status="resolved")
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with patch(
            "app.routers.attachments.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    upload_fault_report_attachment(
                        WORKSPACE_ID,
                        REPORT_ID,
                        FakeRequest(),  # type: ignore[arg-type]
                        "token",
                        attachment_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertIsNone(gateway.uploaded_file)

    def test_upload_cleans_private_object_when_report_resolves_during_request(self) -> None:
        gateway = FakeAttachmentGateway()
        gateway.create_error = SupabaseRequestError(
            400,
            "create_fault_report_attachment",
            "P0001",
            "Fault report is not open or accessible.",
        )
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with patch(
            "app.routers.attachments.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    upload_fault_report_attachment(
                        WORKSPACE_ID,
                        REPORT_ID,
                        FakeRequest(),  # type: ignore[arg-type]
                        "token",
                        attachment_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(gateway.removed_path, gateway.uploaded_file[0])

    def test_admin_cannot_upload_technician_photo(self) -> None:
        authorization = AsyncMock(
            side_effect=HTTPException(status_code=403, detail="Technician access required.")
        )
        with patch(
            "app.routers.attachments.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    upload_fault_report_attachment(
                        WORKSPACE_ID,
                        REPORT_ID,
                        FakeRequest(),  # type: ignore[arg-type]
                        "token",
                        attachment_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)

    def test_admin_cannot_delete_technician_photo(self) -> None:
        authorization = AsyncMock(
            side_effect=HTTPException(status_code=403, detail="Technician access required.")
        )
        with patch(
            "app.routers.attachments.authorized_workspace_technician",
            authorization,
        ):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    delete_fault_report_attachment(
                        WORKSPACE_ID,
                        REPORT_ID,
                        ATTACHMENT_ID,
                        "token",
                        attachment_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 403)

    def test_admin_list_is_workspace_scoped_and_read_only(self) -> None:
        gateway = FakeAttachmentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "admin-id"}, "admin"))
        with patch("app.routers.attachments.authorized_workspace_member", authorization):
            records = asyncio.run(
                list_fault_report_attachments(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    attachment_settings(),
                )
            )

        self.assertEqual(gateway.get_report_scope, (str(WORKSPACE_ID), str(REPORT_ID), None))
        self.assertEqual(gateway.list_scope, (str(WORKSPACE_ID), str(REPORT_ID)))
        self.assertFalse(records[0].can_delete)

    def test_owner_can_delete_only_own_draft_attachment(self) -> None:
        gateway = FakeAttachmentGateway()
        gateway.report = report_record(status="draft")
        authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
        with patch(
            "app.routers.attachments.authorized_workspace_technician",
            authorization,
        ):
            response = asyncio.run(
                delete_fault_report_attachment(
                    WORKSPACE_ID,
                    REPORT_ID,
                    ATTACHMENT_ID,
                    "token",
                    attachment_settings(),
                )
            )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(
            gateway.deleted_scope,
            (str(WORKSPACE_ID), str(REPORT_ID), str(ATTACHMENT_ID), TECHNICIAN_ID),
        )
        self.assertEqual(gateway.removed_path, attachment_record()["storage_path"])

    def test_active_and_resolved_reports_reject_attachment_deletion(self) -> None:
        for report_status in ("active", "resolved"):
            gateway = FakeAttachmentGateway()
            gateway.report = report_record(status=report_status)
            authorization = AsyncMock(return_value=(gateway, {"id": TECHNICIAN_ID}))
            with self.subTest(status=report_status), patch(
                "app.routers.attachments.authorized_workspace_technician",
                authorization,
            ):
                with self.assertRaises(HTTPException) as context:
                    asyncio.run(
                        delete_fault_report_attachment(
                            WORKSPACE_ID,
                            REPORT_ID,
                            ATTACHMENT_ID,
                            "token",
                            attachment_settings(),
                        )
                    )
                self.assertEqual(context.exception.status_code, 409)
                self.assertIsNone(gateway.deleted_scope)

    def test_other_technician_cannot_read_active_report_photos(self) -> None:
        gateway = FakeAttachmentGateway()
        gateway.report = report_record(created_by=OTHER_TECHNICIAN_ID, status="active")
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.attachments.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    list_fault_report_attachments(
                        WORKSPACE_ID,
                        REPORT_ID,
                        "token",
                        attachment_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertIsNone(gateway.list_scope)

    def test_workspace_technician_can_read_shared_resolved_photos(self) -> None:
        gateway = FakeAttachmentGateway()
        gateway.report = report_record(created_by=OTHER_TECHNICIAN_ID, status="resolved")
        authorization = AsyncMock(
            return_value=(gateway, {"id": TECHNICIAN_ID}, "technician")
        )
        with patch("app.routers.attachments.authorized_workspace_member", authorization):
            records = asyncio.run(
                list_fault_report_attachments(
                    WORKSPACE_ID,
                    REPORT_ID,
                    "token",
                    attachment_settings(),
                )
            )

        self.assertEqual(len(records), 1)
        self.assertFalse(records[0].can_delete)

    def test_cross_workspace_report_cannot_list_or_sign_photos(self) -> None:
        gateway = FakeAttachmentGateway()
        gateway.report = None
        authorization = AsyncMock(return_value=(gateway, {"id": "admin-id"}, "admin"))
        with patch("app.routers.attachments.authorized_workspace_member", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    access_fault_report_attachment(
                        OTHER_WORKSPACE_ID,
                        REPORT_ID,
                        ATTACHMENT_ID,
                        "token",
                        attachment_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 404)
        self.assertEqual(gateway.get_report_scope[0], str(OTHER_WORKSPACE_ID))
        self.assertIsNone(gateway.get_attachment_scope)
        self.assertIsNone(gateway.signed_scope)

    def test_authorized_access_uses_short_lived_signed_url(self) -> None:
        gateway = FakeAttachmentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "admin-id"}, "admin"))
        with patch("app.routers.attachments.authorized_workspace_member", authorization):
            result = asyncio.run(
                access_fault_report_attachment(
                    WORKSPACE_ID,
                    REPORT_ID,
                    ATTACHMENT_ID,
                    "token",
                    attachment_settings(),
                )
            )

        self.assertEqual(gateway.signed_scope[1], SIGNED_URL_SECONDS)
        self.assertEqual(result.expires_in, SIGNED_URL_SECONDS)
        self.assertNotIn("secret", result.url)


if __name__ == "__main__":
    unittest.main()
