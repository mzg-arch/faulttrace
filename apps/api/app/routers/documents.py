"""Approved workspace document library and PDF indexing endpoints."""

import asyncio
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_admin,
    authorized_workspace_member,
)
from app.pdf_indexing import PdfIndexingFailure, extract_pdf_chunks
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["documents"])
logger = logging.getLogger("faulttrace.documents")

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
SIGNED_URL_SECONDS = 60
DocumentType = Literal["manual", "diagram", "bulletin", "fault_code_sheet"]
DocumentStatus = Literal["draft", "approved", "archived"]
DocumentIndexStatus = Literal[
    "not_indexed",
    "indexing",
    "indexed",
    "no_text",
    "failed",
    "unsupported",
]

ALLOWED_FILE_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


class DocumentMetadataInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    document_type: DocumentType
    equipment_id: UUID | None = None
    source_revision: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Title is required.")
        return normalized

    @field_validator("source_revision", "description")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class DocumentResponse(BaseModel):
    id: UUID
    title: str
    document_type: DocumentType
    status: DocumentStatus
    equipment_id: UUID | None
    equipment_name: str | None = None
    source_revision: str | None
    description: str | None
    file_name: str | None
    content_type: str | None
    size_bytes: int | None
    index_status: DocumentIndexStatus
    indexed_at: datetime | None
    indexed_page_count: int
    indexed_chunk_count: int
    indexing_error_code: str | None
    created_at: datetime
    updated_at: datetime


class DocumentAccessResponse(BaseModel):
    url: str
    expires_in: int
    file_name: str | None


def sanitize_filename(filename: str) -> str:
    basename = filename.replace("\\", "/").split("/")[-1].strip()
    suffix = Path(basename).suffix.lower()
    stem = Path(basename).stem
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("._-")[:120]
    return f"{safe_stem or 'document'}{suffix}"


def validate_document_file(filename: str, content_type: str, content: bytes) -> str:
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Choose a non-empty document file.",
        )
    if len(content) > MAX_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Document files must be 10 MB or smaller.",
        )

    safe_filename = sanitize_filename(filename)
    suffix = Path(safe_filename).suffix.lower()
    expected_type = ALLOWED_FILE_TYPES.get(suffix)
    normalized_type = content_type.lower().split(";", 1)[0].strip()
    if not expected_type or normalized_type != expected_type:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Upload a PDF, PNG, JPG/JPEG, or WEBP file.",
        )

    signatures = {
        "application/pdf": content.startswith(b"%PDF-"),
        "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": content.startswith(b"\xff\xd8\xff"),
        "image/webp": len(content) >= 12
        and content.startswith(b"RIFF")
        and content[8:12] == b"WEBP",
    }
    if not signatures[normalized_type]:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The file contents do not match the selected file type.",
        )
    return safe_filename


async def read_upload(upload: Any) -> bytes:
    content = bytearray()
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > MAX_DOCUMENT_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Document files must be 10 MB or smaller.",
            )
    return bytes(content)


async def parse_document_upload(request: Request) -> tuple[DocumentMetadataInput, Any]:
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
            detail="Choose a document file to upload.",
        )

    equipment_id = form.get("equipment_id")
    try:
        metadata = DocumentMetadataInput(
            title=str(form.get("title") or ""),
            document_type=str(form.get("document_type") or ""),
            equipment_id=str(equipment_id) if equipment_id else None,
            source_revision=str(form.get("source_revision") or "") or None,
            description=str(form.get("description") or "") or None,
        )
    except ValidationError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Check the document title, type, equipment, revision, and description.",
        ) from None
    return metadata, upload


def document_http_error(error: SupabaseRequestError, action: str) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Document or evidence setup is incomplete. Apply the pending migrations.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend document credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not {action} the document. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The document service rejected the request to {action} the document.",
    )


async def linked_equipment(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    equipment_id: UUID | None,
) -> dict[str, Any] | None:
    if equipment_id is None:
        return None
    equipment = await gateway.get_equipment(str(workspace_id), str(equipment_id))
    if equipment is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Linked equipment was not found in this workspace.",
        )
    return equipment


def document_response(
    record: dict[str, Any],
    equipment: dict[str, Any] | None = None,
) -> DocumentResponse:
    return DocumentResponse.model_validate(
        {
            **record,
            "equipment_name": equipment.get("name") if equipment else None,
        }
    )


async def mark_index_failure(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    document_id: str,
    error_code: str,
) -> dict[str, Any] | None:
    return await gateway.update_document_index_status(
        str(workspace_id),
        document_id,
        {
            "index_status": "failed",
            "indexed_at": None,
            "indexed_page_count": 0,
            "indexed_chunk_count": 0,
            "indexing_error_code": error_code,
        },
    )


async def index_pdf_content(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    document: dict[str, Any],
    content: bytes,
) -> dict[str, Any]:
    document_id = str(document["id"])
    indexing_record = await gateway.update_document_index_status(
        str(workspace_id),
        document_id,
        {
            "index_status": "indexing",
            "indexed_at": None,
            "indexed_page_count": 0,
            "indexed_chunk_count": 0,
            "indexing_error_code": None,
        },
    )
    if indexing_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document was not found in this workspace.",
        )

    try:
        extraction = await asyncio.to_thread(extract_pdf_chunks, content)
        if not extraction.chunks:
            await gateway.replace_document_chunks(str(workspace_id), document_id, [])
            updated = await gateway.update_document_index_status(
                str(workspace_id),
                document_id,
                {
                    "index_status": "no_text",
                    "indexed_at": datetime.now(UTC).isoformat(),
                    "indexed_page_count": 0,
                    "indexed_chunk_count": 0,
                    "indexing_error_code": "no_readable_text",
                },
            )
            return updated or {
                **indexing_record,
                "index_status": "no_text",
                "indexing_error_code": "no_readable_text",
            }

        chunk_records = [
            {
                "workspace_id": str(workspace_id),
                "document_id": document_id,
                "page_number": chunk.page_number,
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
            }
            for chunk in extraction.chunks
        ]
        await gateway.replace_document_chunks(
            str(workspace_id),
            document_id,
            chunk_records,
        )
        updated = await gateway.update_document_index_status(
            str(workspace_id),
            document_id,
            {
                "index_status": "indexed",
                "indexed_at": datetime.now(UTC).isoformat(),
                "indexed_page_count": extraction.readable_page_count,
                "indexed_chunk_count": len(chunk_records),
                "indexing_error_code": None,
            },
        )
        if updated is None:
            raise SupabaseRequestError(
                502,
                "update_document_index_status",
                "empty_response",
                "Supabase did not return indexed document metadata",
            )
        return updated
    except PdfIndexingFailure as error:
        updated = await mark_index_failure(
            gateway,
            workspace_id,
            document_id,
            error.code,
        )
        return updated or {
            **indexing_record,
            "index_status": "failed",
            "indexing_error_code": error.code,
        }
    except (httpx.HTTPError, SupabaseRequestError):
        try:
            await mark_index_failure(
                gateway,
                workspace_id,
                document_id,
                "index_store_failed",
            )
        except (httpx.HTTPError, SupabaseRequestError):
            logger.error("PDF index status cleanup failed")
        raise


@router.get("/{workspace_id}/documents", response_model=list[DocumentResponse])
async def list_documents(
    workspace_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> list[DocumentResponse]:
    gateway, _, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        records = await gateway.list_documents(
            str(workspace_id),
            include_archived=role == "admin",
        )
        equipment_records = await gateway.list_equipment(
            str(workspace_id),
            include_archived=role == "admin",
        )
    except SupabaseRequestError as error:
        raise document_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The document service is unavailable.",
        ) from None

    equipment_by_id = {record["id"]: record for record in equipment_records}
    responses: list[DocumentResponse] = []
    for record in records:
        equipment = equipment_by_id.get(record.get("equipment_id"))
        visible_record = record
        if role != "admin" and record.get("equipment_id") and equipment is None:
            visible_record = {**record, "equipment_id": None}
        responses.append(document_response(visible_record, equipment))
    return responses


@router.post(
    "/{workspace_id}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    workspace_id: UUID,
    request: Request,
    token: TokenDependency,
    settings: SettingsDependency,
) -> DocumentResponse:
    gateway, user = await authorized_workspace_admin(workspace_id, token, settings)
    metadata, upload = await parse_document_upload(request)
    filename = str(getattr(upload, "filename", "") or "")
    content_type = str(getattr(upload, "content_type", "") or "")
    try:
        content = await read_upload(upload)
    finally:
        close = getattr(upload, "close", None)
        if callable(close):
            await close()

    safe_filename = validate_document_file(filename, content_type, content)
    content_type = content_type.lower().split(";", 1)[0].strip()

    try:
        equipment = await linked_equipment(gateway, workspace_id, metadata.equipment_id)
    except SupabaseRequestError as error:
        raise document_http_error(error, "validate") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The equipment link could not be verified.",
        ) from None

    document_id = uuid4()
    storage_path = f"{workspace_id}/{document_id}/{safe_filename}"
    uploaded = False
    try:
        await gateway.upload_document_file(storage_path, content_type, content)
        uploaded = True
        now = datetime.now(UTC).isoformat()
        record = await gateway.create_document(
            {
                "id": str(document_id),
                "workspace_id": str(workspace_id),
                "equipment_id": str(metadata.equipment_id) if metadata.equipment_id else None,
                "title": metadata.title,
                "document_type": metadata.document_type,
                "status": "approved",
                "storage_path": storage_path,
                "source_revision": metadata.source_revision,
                "description": metadata.description,
                "file_name": safe_filename,
                "content_type": content_type,
                "size_bytes": len(content),
                "index_status": (
                    "indexing" if content_type == "application/pdf" else "unsupported"
                ),
                "indexed_page_count": 0,
                "indexed_chunk_count": 0,
                "created_by": user["id"],
                "approved_by": user["id"],
                "approved_at": now,
            }
        )
    except SupabaseRequestError as error:
        if uploaded:
            try:
                await gateway.remove_document_file(storage_path)
            except (httpx.HTTPError, SupabaseRequestError):
                logger.error("Document upload cleanup failed after metadata rejection")
        raise document_http_error(error, "upload") from None
    except httpx.HTTPError:
        if uploaded:
            try:
                await gateway.remove_document_file(storage_path)
            except (httpx.HTTPError, SupabaseRequestError):
                logger.error("Document upload cleanup failed after network error")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The document service is unavailable.",
        ) from None

    if not record:
        try:
            await gateway.remove_document_file(storage_path)
        except (httpx.HTTPError, SupabaseRequestError):
            logger.error("Document upload cleanup failed after an empty metadata response")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase did not return the uploaded document record.",
        )
    if content_type == "application/pdf":
        try:
            record = await index_pdf_content(
                gateway,
                workspace_id,
                record,
                content,
            )
        except (httpx.HTTPError, SupabaseRequestError):
            logger.error("Automatic PDF indexing failed after document upload")
            record = {
                **record,
                "index_status": "failed",
                "indexed_at": None,
                "indexed_page_count": 0,
                "indexed_chunk_count": 0,
                "indexing_error_code": "index_store_failed",
            }
    return document_response(record, equipment)


@router.post(
    "/{workspace_id}/documents/{document_id}/index",
    response_model=DocumentResponse,
)
async def index_document(
    workspace_id: UUID,
    document_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> DocumentResponse:
    gateway, _ = await authorized_workspace_admin(workspace_id, token, settings)
    try:
        document = await gateway.get_document_for_index(
            str(workspace_id),
            str(document_id),
        )
        if document is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document was not found in this workspace.",
            )
        if document.get("status") != "approved":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only approved documents can be indexed as evidence.",
            )
        if document.get("content_type") != "application/pdf":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Only PDF documents support text evidence indexing.",
            )
        content = await gateway.download_document_file(document["storage_path"])
        if not content or len(content) > MAX_DOCUMENT_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="The stored PDF is empty or exceeds the 10 MB indexing limit.",
            )
        indexed = await index_pdf_content(
            gateway,
            workspace_id,
            document,
            content,
        )
        equipment = await linked_equipment(
            gateway,
            workspace_id,
            UUID(indexed["equipment_id"]) if indexed.get("equipment_id") else None,
        )
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise document_http_error(error, "index") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The PDF indexing service is unavailable.",
        ) from None
    return document_response(indexed, equipment)


@router.patch("/{workspace_id}/documents/{document_id}", response_model=DocumentResponse)
async def update_document(
    workspace_id: UUID,
    document_id: UUID,
    payload: DocumentMetadataInput,
    token: TokenDependency,
    settings: SettingsDependency,
) -> DocumentResponse:
    gateway, _ = await authorized_workspace_admin(workspace_id, token, settings)
    try:
        equipment = await linked_equipment(gateway, workspace_id, payload.equipment_id)
        record = await gateway.update_document(
            str(workspace_id),
            str(document_id),
            {
                "title": payload.title,
                "document_type": payload.document_type,
                "equipment_id": str(payload.equipment_id) if payload.equipment_id else None,
                "source_revision": payload.source_revision,
                "description": payload.description,
            },
        )
    except SupabaseRequestError as error:
        raise document_http_error(error, "update") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The document service is unavailable.",
        ) from None
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document was not found in this workspace.",
        )
    return document_response(record, equipment)


@router.post(
    "/{workspace_id}/documents/{document_id}/archive",
    response_model=DocumentResponse,
)
async def archive_document(
    workspace_id: UUID,
    document_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> DocumentResponse:
    gateway, _ = await authorized_workspace_admin(workspace_id, token, settings)
    try:
        record = await gateway.archive_document(str(workspace_id), str(document_id))
        equipment = await linked_equipment(
            gateway,
            workspace_id,
            UUID(record["equipment_id"]) if record and record.get("equipment_id") else None,
        )
    except SupabaseRequestError as error:
        raise document_http_error(error, "archive") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The document service is unavailable.",
        ) from None
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document was not found in this workspace.",
        )
    return document_response(record, equipment)


@router.post(
    "/{workspace_id}/documents/{document_id}/access",
    response_model=DocumentAccessResponse,
)
async def access_document(
    workspace_id: UUID,
    document_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> DocumentAccessResponse:
    gateway, _, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        record = await gateway.get_document_for_access(str(workspace_id), str(document_id))
        if record is None or (role != "admin" and record.get("status") != "approved"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="An active approved document was not found in this workspace.",
            )
        signed_url = await gateway.create_document_signed_url(
            record["storage_path"],
            expires_in=SIGNED_URL_SECONDS,
        )
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise document_http_error(error, "open") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The document service is unavailable.",
        ) from None
    return DocumentAccessResponse(
        url=signed_url,
        expires_in=SIGNED_URL_SECONDS,
        file_name=record.get("file_name"),
    )
