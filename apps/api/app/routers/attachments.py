"""Private workspace-scoped photo attachments for fault reports."""

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_member,
    authorized_workspace_technician,
)
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["fault report attachments"])
logger = logging.getLogger("faulttrace.attachments")

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
SIGNED_URL_SECONDS = 60
ALLOWED_IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


class FaultReportAttachmentResponse(BaseModel):
    id: UUID
    fault_report_id: UUID
    uploaded_by_user_id: UUID
    file_name: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    can_delete: bool = False


class FaultReportAttachmentAccessResponse(BaseModel):
    url: str
    expires_in: int
    file_name: str


def sanitize_attachment_filename(filename: str) -> str:
    basename = filename.replace("\\", "/").split("/")[-1].strip()
    suffix = Path(basename).suffix.lower()
    stem = Path(basename).stem
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("._-")[:180]
    return f"{safe_stem or 'fault-photo'}{suffix}"


def validate_attachment_file(filename: str, content_type: str, content: bytes) -> str:
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Choose a non-empty photo.",
        )
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Fault-report photos must be 10 MB or smaller.",
        )

    safe_filename = sanitize_attachment_filename(filename)
    suffix = Path(safe_filename).suffix.lower()
    normalized_type = content_type.lower().split(";", 1)[0].strip()
    expected_type = ALLOWED_IMAGE_TYPES.get(suffix)
    if expected_type is None or normalized_type != expected_type:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload a JPEG, PNG, or WebP image with a matching file extension.",
        )

    signatures = {
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/webp": (
            len(content) >= 12
            and content.startswith(b"RIFF")
            and content[8:12] == b"WEBP"
        ),
    }
    if not signatures[normalized_type]:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The photo contents do not match its file type.",
        )
    return safe_filename


async def read_attachment_upload(upload: Any) -> bytes:
    content = bytearray()
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Fault-report photos must be 10 MB or smaller.",
            )
    return bytes(content)


async def parse_attachment_upload(request: Request) -> tuple[str, str, bytes]:
    try:
        form = await request.form()
    except (AssertionError, RuntimeError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Multipart upload support is not installed on the API server.",
        ) from None

    upload = form.get("file")
    if upload is None or not callable(getattr(upload, "read", None)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Choose a photo to upload.",
        )

    filename = str(getattr(upload, "filename", "") or "")
    content_type = str(getattr(upload, "content_type", "") or "")
    try:
        content = await read_attachment_upload(upload)
    finally:
        close = getattr(upload, "close", None)
        if callable(close):
            await close()
    safe_filename = validate_attachment_file(filename, content_type, content)
    normalized_type = content_type.lower().split(";", 1)[0].strip()
    return safe_filename, normalized_type, content


def attachment_http_error(error: SupabaseRequestError, action: str) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "42883", "pgrst202", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Photo attachment setup is incomplete. Apply the pending attachment migration.",
        )
    if code in {"p0001", "23514", "23503", "23505"}:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The report or attachment changed before the request completed. Reload and try again.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend attachment credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not {action} the photo attachment. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The attachment service rejected the request to {action} the photo.",
    )


async def accessible_report(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    report_id: UUID,
    user_id: str,
    role: str,
) -> dict[str, Any]:
    report = await gateway.get_fault_report(
        str(workspace_id),
        str(report_id),
        created_by=None,
    )
    if (
        report is None
        or (
            role == "technician"
            and report.get("created_by") != user_id
            and report.get("status") != "resolved"
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fault report was not found in this workspace.",
        )
    return report


def attachment_response(
    record: dict[str, Any],
    *,
    can_delete: bool,
) -> FaultReportAttachmentResponse:
    return FaultReportAttachmentResponse.model_validate(
        {**record, "can_delete": can_delete}
    )


@router.get(
    "/{workspace_id}/fault-reports/{report_id}/attachments",
    response_model=list[FaultReportAttachmentResponse],
)
async def list_fault_report_attachments(
    workspace_id: UUID,
    report_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> list[FaultReportAttachmentResponse]:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        report = await accessible_report(
            gateway,
            workspace_id,
            report_id,
            user["id"],
            role,
        )
        records = await gateway.list_fault_report_attachments(
            str(workspace_id),
            str(report_id),
        )
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise attachment_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The attachment service is unavailable.",
        ) from None

    may_delete = (
        role == "technician"
        and report.get("created_by") == user["id"]
        and report.get("status") == "draft"
    )
    return [
        attachment_response(
            record,
            can_delete=(may_delete and record.get("uploaded_by_user_id") == user["id"]),
        )
        for record in records
    ]


@router.post(
    "/{workspace_id}/fault-reports/{report_id}/attachments",
    response_model=FaultReportAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_fault_report_attachment(
    workspace_id: UUID,
    report_id: UUID,
    request: Request,
    token: TokenDependency,
    settings: SettingsDependency,
) -> FaultReportAttachmentResponse:
    gateway, user = await authorized_workspace_technician(workspace_id, token, settings)
    try:
        report = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=user["id"],
        )
    except SupabaseRequestError as error:
        raise attachment_http_error(error, "validate") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The attachment service is unavailable.",
        ) from None
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fault report was not found in this workspace.",
        )
    if report.get("status") not in {"draft", "active"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Photos cannot be added after a fault report is resolved.",
        )

    safe_filename, mime_type, content = await parse_attachment_upload(request)
    attachment_id = uuid4()
    storage_path = (
        f"{workspace_id}/{report_id}/{attachment_id}/{safe_filename}"
    )
    uploaded = False
    try:
        await gateway.upload_fault_report_attachment_file(
            storage_path,
            mime_type,
            content,
        )
        uploaded = True
        record = await gateway.create_fault_report_attachment(
            {
                "id": str(attachment_id),
                "workspace_id": str(workspace_id),
                "fault_report_id": str(report_id),
                "uploaded_by_user_id": user["id"],
                "storage_path": storage_path,
                "file_name": safe_filename,
                "mime_type": mime_type,
                "size_bytes": len(content),
            }
        )
    except SupabaseRequestError as error:
        if uploaded:
            try:
                await gateway.remove_fault_report_attachment_file(storage_path)
            except (httpx.HTTPError, SupabaseRequestError):
                logger.error("Attachment upload cleanup failed after metadata rejection")
        raise attachment_http_error(error, "upload") from None
    except httpx.HTTPError:
        if uploaded:
            try:
                await gateway.remove_fault_report_attachment_file(storage_path)
            except (httpx.HTTPError, SupabaseRequestError):
                logger.error("Attachment upload cleanup failed after network error")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The attachment service is unavailable.",
        ) from None

    if record is None:
        try:
            await gateway.remove_fault_report_attachment_file(storage_path)
        except (httpx.HTTPError, SupabaseRequestError):
            logger.error("Attachment upload cleanup failed after an empty metadata response")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase did not return the uploaded attachment record.",
        )
    return attachment_response(record, can_delete=report.get("status") == "draft")


@router.post(
    "/{workspace_id}/fault-reports/{report_id}/attachments/{attachment_id}/access",
    response_model=FaultReportAttachmentAccessResponse,
)
async def access_fault_report_attachment(
    workspace_id: UUID,
    report_id: UUID,
    attachment_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> FaultReportAttachmentAccessResponse:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        await accessible_report(
            gateway,
            workspace_id,
            report_id,
            user["id"],
            role,
        )
        record = await gateway.get_fault_report_attachment(
            str(workspace_id),
            str(report_id),
            str(attachment_id),
        )
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Photo attachment was not found in this report.",
            )
        signed_url = await gateway.create_fault_report_attachment_signed_url(
            record["storage_path"],
            expires_in=SIGNED_URL_SECONDS,
        )
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise attachment_http_error(error, "open") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The attachment service is unavailable.",
        ) from None
    return FaultReportAttachmentAccessResponse(
        url=signed_url,
        expires_in=SIGNED_URL_SECONDS,
        file_name=record["file_name"],
    )


@router.delete(
    "/{workspace_id}/fault-reports/{report_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_fault_report_attachment(
    workspace_id: UUID,
    report_id: UUID,
    attachment_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> Response:
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
        if report.get("status") != "draft":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Photos can be deleted only while the fault report is Draft.",
            )
        attachment = await gateway.get_fault_report_attachment(
            str(workspace_id),
            str(report_id),
            str(attachment_id),
        )
        if attachment is None or attachment.get("uploaded_by_user_id") != user["id"]:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Photo attachment was not found in this report.",
            )
        deleted = await gateway.delete_draft_fault_report_attachment(
            str(workspace_id),
            str(report_id),
            str(attachment_id),
            user["id"],
        )
        if deleted is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The attachment could not be deleted. Reload the report and try again.",
            )
        try:
            await gateway.remove_fault_report_attachment_file(deleted["storage_path"])
        except (httpx.HTTPError, SupabaseRequestError):
            logger.error("Private attachment object cleanup failed after metadata deletion")
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise attachment_http_error(error, "delete") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The attachment service is unavailable.",
        ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
