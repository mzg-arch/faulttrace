"""Stored, evidence-grounded Gemini guidance for active fault reports."""

import logging
from datetime import datetime
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ValidationError

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_member,
    authorized_workspace_technician,
)
from app.gemini_guidance import (
    CitedStatement,
    GeminiGuidanceDraft,
    GeminiGuidanceError,
    GuidedCheckDraft,
    generate_guidance_with_gemini,
)
from app.routers.evidence import (
    EVIDENCE_URL_SECONDS,
    MAX_GUIDANCE_EVIDENCE_RESULTS,
    EvidenceSnapshot,
    retrieve_approved_evidence,
)
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["guidance"])
logger = logging.getLogger("faulttrace.guidance")
INSUFFICIENT_SUMMARY = (
    "The retrieved approved PDF evidence is insufficient to create a grounded safety brief "
    "or guidance plan. No maintenance guidance was generated."
)
GROUNDING_VALIDATION_REASONS = frozenset(
    {
        "insufficient result contained guidance or citations",
        "grounded result omitted a required guidance section",
        "grounded statement had no citation",
        "grounded statement repeated a citation",
        "grounded statement cited unavailable evidence",
        "evidence citation list contained duplicates",
        "evidence citation list did not match statement citations",
    }
)


class PlanEvidence(EvidenceSnapshot):
    source_available: bool
    source_url: str | None = None
    source_url_expires_in: int | None = None


class GuidancePlanResponse(BaseModel):
    id: UUID
    fault_report_id: UUID
    status: Literal["grounded", "insufficient_evidence"]
    case_summary: CitedStatement
    safety_brief_items: list[CitedStatement]
    guided_checks: list[GuidedCheckDraft]
    escalation_criteria: list[CitedStatement]
    evidence_citation_ids: list[int]
    evidence: list[PlanEvidence]
    model: str | None
    created_by: UUID
    created_at: datetime


def guidance_http_error(error: SupabaseRequestError, action: str) -> HTTPException:
    code = (error.code or "").lower()
    if code in {"42p01", "42703", "42883", "pgrst202", "pgrst204", "pgrst205"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Guidance Plan setup is incomplete. Apply the pending guidance migration.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend guidance credentials.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not {action} the guidance plan. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The guidance service rejected the request to {action} the plan.",
    )


def validate_grounded_draft(
    draft: GeminiGuidanceDraft,
    available_chunk_ids: set[int],
) -> GeminiGuidanceDraft:
    if draft.status == "insufficient_evidence":
        if (
            draft.case_summary.citation_ids
            or draft.safety_brief_items
            or draft.guided_checks
            or draft.escalation_criteria
            or draft.evidence_citation_ids
        ):
            raise ValueError("insufficient result contained guidance or citations")
        return GeminiGuidanceDraft(
            status="insufficient_evidence",
            case_summary=CitedStatement(text=INSUFFICIENT_SUMMARY, citation_ids=[]),
            safety_brief_items=[],
            guided_checks=[],
            escalation_criteria=[],
            evidence_citation_ids=[],
        )

    if not (
        draft.safety_brief_items
        and draft.guided_checks
        and draft.escalation_criteria
    ):
        raise ValueError("grounded result omitted a required guidance section")

    citation_groups = [draft.case_summary.citation_ids]
    citation_groups.extend(item.citation_ids for item in draft.safety_brief_items)
    citation_groups.extend(item.citation_ids for item in draft.guided_checks)
    citation_groups.extend(item.citation_ids for item in draft.escalation_criteria)

    used_ids: set[int] = set()
    for citation_ids in citation_groups:
        if not citation_ids:
            raise ValueError("grounded statement had no citation")
        if len(citation_ids) != len(set(citation_ids)):
            raise ValueError("grounded statement repeated a citation")
        if not set(citation_ids).issubset(available_chunk_ids):
            raise ValueError("grounded statement cited unavailable evidence")
        used_ids.update(citation_ids)

    if len(draft.evidence_citation_ids) != len(set(draft.evidence_citation_ids)):
        raise ValueError("evidence citation list contained duplicates")
    if set(draft.evidence_citation_ids) != used_ids:
        raise ValueError("evidence citation list did not match statement citations")
    return draft


def insufficient_draft() -> GeminiGuidanceDraft:
    return GeminiGuidanceDraft(
        status="insufficient_evidence",
        case_summary=CitedStatement(text=INSUFFICIENT_SUMMARY, citation_ids=[]),
        safety_brief_items=[],
        guided_checks=[],
        escalation_criteria=[],
        evidence_citation_ids=[],
    )


async def response_from_record(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    record: dict,
) -> GuidancePlanResponse:
    try:
        snapshots = [
            EvidenceSnapshot.model_validate(item)
            for item in record.get("evidence_snapshot", [])
        ]
        case_summary = CitedStatement.model_validate(record["case_summary"])
        safety_items = [
            CitedStatement.model_validate(item)
            for item in record.get("safety_brief_items", [])
        ]
        checks = [
            GuidedCheckDraft.model_validate(item)
            for item in record.get("guided_checks", [])
        ]
        escalation = [
            CitedStatement.model_validate(item)
            for item in record.get("escalation_criteria", [])
        ]
        validated = validate_grounded_draft(
            GeminiGuidanceDraft(
                status=record["status"],
                case_summary=case_summary,
                safety_brief_items=safety_items,
                guided_checks=checks,
                escalation_criteria=escalation,
                evidence_citation_ids=record.get("evidence_chunk_ids", []),
            ),
            {item.chunk_id for item in snapshots},
        )
    except (KeyError, TypeError, ValidationError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The saved guidance plan could not be validated.",
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The saved guidance plan failed evidence-grounding validation.",
        ) from error

    signed_sources: dict[str, str | None] = {}
    for snapshot in snapshots:
        document_id = str(snapshot.document_id)
        if document_id in signed_sources:
            continue
        document = await gateway.get_document_for_access(
            str(workspace_id),
            document_id,
        )
        if (
            document is None
            or document.get("status") != "approved"
            or document.get("content_type") != "application/pdf"
        ):
            signed_sources[document_id] = None
            continue
        signed_sources[document_id] = await gateway.create_document_signed_url(
            document["storage_path"],
            expires_in=EVIDENCE_URL_SECONDS,
        )

    evidence = [
        PlanEvidence(
            **snapshot.model_dump(),
            source_available=signed_sources[str(snapshot.document_id)] is not None,
            source_url=signed_sources[str(snapshot.document_id)],
            source_url_expires_in=(
                EVIDENCE_URL_SECONDS
                if signed_sources[str(snapshot.document_id)] is not None
                else None
            ),
        )
        for snapshot in snapshots
    ]
    return GuidancePlanResponse(
        id=record["id"],
        fault_report_id=record["fault_report_id"],
        status=record["status"],
        case_summary=validated.case_summary,
        safety_brief_items=validated.safety_brief_items,
        guided_checks=validated.guided_checks,
        escalation_criteria=validated.escalation_criteria,
        evidence_citation_ids=validated.evidence_citation_ids,
        evidence=evidence,
        model=record.get("model"),
        created_by=record["created_by"],
        created_at=record["created_at"],
    )


async def accessible_active_report(
    gateway: SupabaseGateway,
    workspace_id: UUID,
    report_id: UUID,
    *,
    created_by: str | None,
) -> tuple[dict, dict]:
    report = await gateway.get_fault_report(
        str(workspace_id),
        str(report_id),
        created_by=created_by,
    )
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fault report was not found in this workspace.",
        )
    if report.get("status") != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete the Safety Gate before using evidence-grounded guidance.",
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
    return report, equipment


@router.get(
    "/{workspace_id}/fault-reports/{report_id}/guidance-plan",
    response_model=GuidancePlanResponse,
)
async def get_guidance_plan(
    workspace_id: UUID,
    report_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> GuidancePlanResponse:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        report = await gateway.get_fault_report(
            str(workspace_id),
            str(report_id),
            created_by=None,
        )
        if (
            report is None
            or (
                role == "technician"
                and report.get("created_by") != user["id"]
                and report.get("status") != "resolved"
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fault report was not found in this workspace.",
            )
        if report.get("status") not in {"active", "resolved"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Complete the Safety Gate before viewing evidence-grounded guidance.",
            )

        plan_creator = (
            user["id"]
            if role == "technician" and report.get("status") == "active"
            else None
        )
        record = await gateway.get_latest_guidance_plan(
            str(workspace_id),
            str(report_id),
            created_by=plan_creator,
        )
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No saved guidance plan exists for this report.",
            )
        return await response_from_record(gateway, workspace_id, record)
    except HTTPException:
        raise
    except SupabaseRequestError as error:
        raise guidance_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The guidance service is unavailable.",
        ) from None


@router.post(
    "/{workspace_id}/fault-reports/{report_id}/guidance-plan/generate",
    response_model=GuidancePlanResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generate_guidance_plan(
    workspace_id: UUID,
    report_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> GuidancePlanResponse:
    gateway, user = await authorized_workspace_technician(workspace_id, token, settings)
    try:
        report, equipment = await accessible_active_report(
            gateway,
            workspace_id,
            report_id,
            created_by=user["id"],
        )
        if not settings.gemini_is_configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service is not configured. Add the backend Gemini settings and restart the API.",
            )

        evidence = await retrieve_approved_evidence(
            gateway,
            workspace_id,
            report,
            equipment,
            limit=MAX_GUIDANCE_EVIDENCE_RESULTS,
        )
        model_name: str | None = None
        if not evidence:
            draft = insufficient_draft()
        else:
            report_context = {
                "equipment": {
                    "name": equipment.get("name"),
                    "asset_tag": equipment.get("asset_tag"),
                    "manufacturer": equipment.get("manufacturer"),
                    "model": equipment.get("model"),
                },
                "fault_code": report.get("fault_code"),
                "symptom": report.get("symptom"),
                "planned_task": report.get("planned_task"),
                "operating_context": report.get("operating_context"),
                "safety_gate_completed": {
                    "authorized_qualified": report.get("ack_authorized_qualified"),
                    "loto_isolation": report.get("ack_loto_isolation"),
                    "ppe_stored_energy": report.get("ack_ppe_stored_energy"),
                    "stop_escalate": report.get("ack_stop_escalate"),
                },
            }
            draft = await generate_guidance_with_gemini(
                settings.gemini_api_key.get_secret_value().strip(),
                settings.gemini_model.strip(),
                report_context,
                [item.model_dump(mode="json") for item in evidence],
                report_id=str(report_id),
            )
            model_name = draft._provider_model or settings.gemini_model.strip()
            try:
                draft = validate_grounded_draft(
                    draft,
                    {item.chunk_id for item in evidence},
                )
            except ValueError as error:
                validation_reason = str(error)
                if validation_reason not in GROUNDING_VALIDATION_REASONS:
                    validation_reason = "grounding_validation_failed"
                logger.warning(
                    "Gemini grounding validation failed reason=%s report_id=%s "
                    "evidence_chunk_count=%s",
                    validation_reason,
                    report_id,
                    len(evidence),
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        "AI output failed evidence-grounding validation. No guidance plan was saved."
                    ),
                ) from None

        record = await gateway.create_guidance_plan(
            {
                "workspace_id": str(workspace_id),
                "fault_report_id": str(report_id),
                "status": draft.status,
                "case_summary": draft.case_summary.model_dump(),
                "safety_brief_items": [item.model_dump() for item in draft.safety_brief_items],
                "guided_checks": [item.model_dump() for item in draft.guided_checks],
                "escalation_criteria": [
                    item.model_dump() for item in draft.escalation_criteria
                ],
                "evidence_chunk_ids": draft.evidence_citation_ids,
                "evidence_snapshot": [item.model_dump(mode="json") for item in evidence],
                "model": model_name,
                "created_by": user["id"],
            }
        )
        if not record:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Supabase did not return the saved guidance plan.",
            )
        return await response_from_record(gateway, workspace_id, record)
    except HTTPException:
        raise
    except GeminiGuidanceError as error:
        if error.code == "dependency_unavailable":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service dependency is not installed on the API server.",
            ) from None
        if error.code == "timeout":
            detail = "AI service timed out. No guidance plan was saved."
        elif error.code == "provider_busy":
            detail = (
                "The AI service is temporarily busy. "
                "Try again shortly. No guidance plan was saved."
            )
        elif error.code == "provider_rejected":
            detail = (
                "AI provider rejected the request. "
                "Check the backend configuration and server log."
            )
        elif error.code in {"empty_response", "invalid_structured_response"}:
            detail = "AI service returned an invalid structured result. No guidance plan was saved."
        else:
            detail = "AI service could not generate guidance. No guidance plan was saved."
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from None
    except SupabaseRequestError as error:
        raise guidance_http_error(error, "save") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The guidance service is unavailable.",
        ) from None
