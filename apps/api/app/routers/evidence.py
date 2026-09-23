"""Deterministic retrieval of exact excerpts from approved workspace PDFs."""

import re
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_member,
)
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["evidence"])
EVIDENCE_URL_SECONDS = 300
MAX_EVIDENCE_RESULTS = 6
MAX_GUIDANCE_EVIDENCE_RESULTS = 8
DocumentType = Literal["manual", "diagram", "bulletin", "fault_code_sheet"]

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9]+(?:[._/-][A-Za-z0-9]+)*")
STOP_WORDS = {
    "about",
    "after",
    "also",
    "been",
    "before",
    "being",
    "could",
    "during",
    "from",
    "have",
    "into",
    "normal",
    "that",
    "their",
    "there",
    "this",
    "with",
    "would",
}


class EvidenceSnapshot(BaseModel):
    chunk_id: int
    document_id: UUID
    document_title: str
    document_type: DocumentType
    source_revision: str | None
    page_number: int
    excerpt: str
    equipment_linked: bool


class EvidenceExcerpt(EvidenceSnapshot):
    source_url: str
    source_url_expires_in: int


class EvidenceRetrievalResponse(BaseModel):
    report_id: UUID
    evidence: list[EvidenceExcerpt]
    message: str


def build_search_text(*values: str | None) -> str:
    terms: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value:
            continue
        for match in TOKEN_PATTERN.findall(value):
            term = match.casefold().strip("._/-")
            if len(term) < 2 or term in STOP_WORDS or term in seen:
                continue
            seen.add(term)
            terms.append(term)
            if len(terms) == 32:
                break
        if len(terms) == 32:
            break
    return " OR ".join(f'"{term}"' for term in terms)


def evidence_http_error(error: SupabaseRequestError) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "42883", "pgrst202", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Evidence Retrieval setup is incomplete. Apply the pending evidence migration.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend evidence credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase could not retrieve approved evidence. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="The evidence service rejected the retrieval request.",
    )


async def retrieve_approved_evidence(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    report: dict,
    equipment: dict,
    *,
    limit: int,
) -> list[EvidenceSnapshot]:
    """Retrieve and revalidate approved PDF chunks without trusting browser input."""
    search_text = build_search_text(
        report.get("fault_code"),
        report.get("symptom"),
        report.get("planned_task"),
        equipment.get("name"),
        equipment.get("model"),
    )
    if not search_text:
        return []

    matches = await gateway.search_approved_document_chunks(
        str(workspace_id),
        report["equipment_id"],
        search_text,
        limit=limit,
    )

    checked_documents: dict[str, bool] = {}
    evidence: list[EvidenceSnapshot] = []
    for match in matches:
        chunk_id = int(match.get("chunk_id") or 0)
        document_id = str(match.get("document_id") or "")
        excerpt = str(match.get("excerpt") or "").strip()
        page_number = int(match.get("page_number") or 0)
        if chunk_id < 1 or not document_id or not excerpt or page_number < 1:
            continue

        if document_id not in checked_documents:
            document = await gateway.get_document_for_access(
                str(workspace_id),
                document_id,
            )
            checked_documents[document_id] = bool(
                document is not None
                and document.get("status") == "approved"
                and document.get("content_type") == "application/pdf"
            )
        if not checked_documents[document_id]:
            continue

        evidence.append(
            EvidenceSnapshot(
                chunk_id=chunk_id,
                document_id=UUID(document_id),
                document_title=str(match["document_title"]),
                document_type=match["document_type"],
                source_revision=match.get("source_revision"),
                page_number=page_number,
                excerpt=excerpt,
                equipment_linked=bool(match.get("equipment_linked")),
            )
        )
    return evidence


@router.post(
    "/{workspace_id}/fault-reports/{report_id}/evidence/retrieve",
    response_model=EvidenceRetrievalResponse,
)
async def retrieve_evidence(
    workspace_id: UUID,
    report_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> EvidenceRetrievalResponse:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        report = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=user["id"] if role == "technician" else None,
        )
        if report is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Active fault report was not found in this workspace.",
            )
        if report.get("status") != "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Complete the Safety Gate before retrieving approved evidence.",
            )

        equipment = await gateway.get_equipment(
            str(workspace_id),
            report["equipment_id"],
        )
        if equipment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fault report equipment was not found in this workspace.",
            )

        matches = await retrieve_approved_evidence(
            gateway,
            workspace_id,
            report,
            equipment,
            limit=MAX_EVIDENCE_RESULTS,
        )

        signed_sources: dict[str, str] = {}
        evidence: list[EvidenceExcerpt] = []
        for match in matches:
            document_id = str(match.document_id)
            if document_id not in signed_sources:
                document = await gateway.get_document_for_access(
                    str(workspace_id),
                    document_id,
                )
                if (
                    document is None
                    or document.get("status") != "approved"
                    or document.get("content_type") != "application/pdf"
                ):
                    continue
                signed_sources[document_id] = await gateway.create_document_signed_url(
                    document["storage_path"],
                    expires_in=EVIDENCE_URL_SECONDS,
                )

            evidence.append(
                EvidenceExcerpt(
                    **match.model_dump(),
                    source_url=signed_sources[document_id],
                    source_url_expires_in=EVIDENCE_URL_SECONDS,
                )
            )

    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise evidence_http_error(error) from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The approved evidence service is unavailable.",
        ) from None

    if not evidence:
        return EvidenceRetrievalResponse(
            report_id=report_id,
            evidence=[],
            message=(
                "No matching approved PDF evidence was found. Review the Document Library "
                "and current site procedures."
            ),
        )
    return EvidenceRetrievalResponse(
        report_id=report_id,
        evidence=evidence,
        message="Approved source excerpts retrieved. Review each original procedure before acting.",
    )
