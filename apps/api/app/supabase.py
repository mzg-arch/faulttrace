"""Small HTTP client for Supabase Auth and Data APIs."""

import asyncio
import logging
import re
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from app.settings import Settings


logger = logging.getLogger("faulttrace.supabase")

_EMAIL_PATTERN = re.compile(
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    re.IGNORECASE,
)
_KEY_PATTERN = re.compile(
    r"\b(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+|"
    r"eyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){1,2})\b"
)
_NAMED_SECRET_PATTERN = re.compile(
    r"(?i)\b(access_token|refresh_token|confirmation_token|token_hash|token|apikey|"
    r"authorization|secret|action_link)"
    r"([\"']?\s*[:=]\s*[\"']?)([^\"'\s,;}]+)"
)
_QUERY_SECRET_PATTERN = re.compile(
    r"(?i)([?&](?:access_token|refresh_token|confirmation_token|token_hash|token|code)=)[^&\s]+"
)


def _redact_message(value: str) -> str:
    redacted = _EMAIL_PATTERN.sub("[email redacted]", value)
    redacted = _KEY_PATTERN.sub("[credential redacted]", redacted)
    redacted = _NAMED_SECRET_PATTERN.sub(r"\1\2[credential redacted]", redacted)
    redacted = _QUERY_SECRET_PATTERN.sub(r"\1[credential redacted]", redacted)
    return " ".join(redacted.split())[:300]


def _safe_error_details(response: httpx.Response) -> tuple[str | None, str]:
    code: str | None = None
    message = response.reason_phrase or "Supabase request rejected"
    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        raw_code = payload.get("code") or payload.get("error_code")
        if isinstance(raw_code, str):
            code = re.sub(r"[^a-zA-Z0-9_.-]", "", raw_code)[:80] or None
        for field in ("message", "msg", "error_description", "error"):
            candidate = payload.get(field)
            if isinstance(candidate, str) and candidate.strip():
                message = candidate
                break
    return code, _redact_message(message)


class SupabaseRequestError(Exception):
    """A Supabase request failed with sanitized diagnostic details."""

    def __init__(
        self,
        status_code: int,
        operation: str,
        code: str | None = None,
        safe_message: str = "Supabase request rejected",
    ) -> None:
        super().__init__(f"Supabase {operation} failed with status {status_code}")
        self.status_code = status_code
        self.operation = operation
        self.code = code
        self.safe_message = safe_message


class SupabaseGateway:
    document_bucket = "faulttrace-sources"
    fault_report_attachment_bucket = "fault-report-attachments"

    def __init__(self, settings: Settings) -> None:
        self.url = settings.supabase_url.strip().rstrip("/")
        self.publishable_key = settings.supabase_publishable_key.strip()
        self.secret_key = settings.supabase_secret_key.get_secret_value().strip()
        self.redirect_url = settings.invite_redirect_url

    @property
    def is_configured(self) -> bool:
        return bool(self.url and self.publishable_key and self.secret_key and self.redirect_url)

    async def verify_user(self, access_token: str) -> dict[str, Any]:
        response = await self._request(
            "GET",
            "/auth/v1/user",
            key=self.publishable_key,
            bearer=access_token,
            operation="verify_user",
        )
        return response.json()

    async def is_workspace_admin(
        self,
        access_token: str,
        user_id: str,
        workspace_id: str,
    ) -> bool:
        return await self.get_workspace_role(access_token, user_id, workspace_id) == "admin"

    async def get_workspace_role(
        self,
        access_token: str,
        user_id: str,
        workspace_id: str,
    ) -> str | None:
        response = await self._request(
            "GET",
            "/rest/v1/workspace_memberships",
            key=self.publishable_key,
            bearer=access_token,
            params={
                "select": "role",
                "workspace_id": f"eq.{workspace_id}",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
            operation="verify_workspace_membership",
        )
        memberships = response.json()
        if not memberships:
            return None
        role = memberships[0].get("role")
        return role if role in ("admin", "technician") else None

    async def reserve_invitation(self, invitation: dict[str, Any]) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/rest/v1/workspace_invitations",
            key=self.secret_key,
            json=invitation,
            headers={"Prefer": "return=representation"},
            operation="reserve_invitation",
        )
        return response.json()[0]

    async def workspace_access_exists(self, workspace_id: str, email: str) -> bool:
        """Check workspace invitations and memberships for an exact email match."""
        invitation_response = await self._request(
            "GET",
            "/rest/v1/workspace_invitations",
            key=self.secret_key,
            params={
                "select": "id",
                "workspace_id": f"eq.{workspace_id}",
                "email": f"eq.{email}",
                "status": "in.(sending,pending,accepted)",
                "limit": "1",
            },
            operation="check_workspace_invitation",
        )
        if invitation_response.json():
            return True

        memberships = await self.list_workspace_memberships(workspace_id)
        auth_users = await asyncio.gather(
            *(self.get_auth_user(membership["user_id"]) for membership in memberships)
        )
        normalized_email = email.casefold()
        return any(
            isinstance(user.get("email"), str)
            and user["email"].strip().casefold() == normalized_email
            for user in auth_users
        )

    async def send_invitation(
        self,
        email: str,
        display_name: str,
    ) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/auth/v1/invite",
            key=self.secret_key,
            params={"redirect_to": self.redirect_url},
            json={"email": email, "data": {"full_name": display_name}},
            operation="send_invitation",
        )
        return response.json()

    async def finalize_invitation(self, invitation_id: str, auth_user_id: str) -> None:
        await self._request(
            "POST",
            "/rest/v1/rpc/finalize_workspace_invitation",
            key=self.secret_key,
            json={
                "target_invitation_id": invitation_id,
                "target_auth_user_id": auth_user_id,
            },
            operation="finalize_invitation",
        )

    async def mark_invitation_failed(self, invitation_id: str) -> None:
        try:
            await self._request(
                "PATCH",
                "/rest/v1/workspace_invitations",
                key=self.secret_key,
                params={"id": f"eq.{invitation_id}"},
                json={"status": "failed"},
                operation="mark_invitation_failed",
            )
        except (httpx.HTTPError, SupabaseRequestError):
            # Preserve the original safe invitation error if cleanup fails.
            pass

    async def list_workspace_memberships(self, workspace_id: str) -> list[dict[str, Any]]:
        response = await self._request(
            "GET",
            "/rest/v1/workspace_memberships",
            key=self.secret_key,
            params={
                "select": "user_id,role,created_at",
                "workspace_id": f"eq.{workspace_id}",
                "order": "created_at.asc",
            },
            operation="list_workspace_memberships",
        )
        return response.json()

    async def list_profiles(self, user_ids: list[str]) -> list[dict[str, Any]]:
        if not user_ids:
            return []
        response = await self._request(
            "GET",
            "/rest/v1/profiles",
            key=self.secret_key,
            params={
                "select": "id,display_name",
                "id": f"in.({','.join(user_ids)})",
            },
            operation="list_profiles",
        )
        return response.json()

    async def get_auth_user(self, user_id: str) -> dict[str, Any]:
        response = await self._request(
            "GET",
            f"/auth/v1/admin/users/{user_id}",
            key=self.secret_key,
            operation="get_auth_user",
        )
        payload = response.json()
        return payload.get("user", payload)

    async def mark_invitation_accepted(self, workspace_id: str, user_id: str) -> None:
        try:
            await self._request(
                "PATCH",
                "/rest/v1/workspace_invitations",
                key=self.secret_key,
                params={
                    "workspace_id": f"eq.{workspace_id}",
                    "auth_user_id": f"eq.{user_id}",
                    "status": "eq.pending",
                },
                json={"status": "accepted"},
                operation="mark_invitation_accepted",
            )
        except (httpx.HTTPError, SupabaseRequestError):
            pass

    async def list_equipment(
        self,
        workspace_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, Any]]:
        params = {
            "select": (
                "id,name,asset_tag,manufacturer,model,location,status,created_at,updated_at"
            ),
            "workspace_id": f"eq.{workspace_id}",
            "order": "name.asc,asset_tag.asc",
        }
        if not include_archived:
            params["status"] = "eq.active"
        response = await self._request(
            "GET",
            "/rest/v1/equipment",
            key=self.secret_key,
            params=params,
            operation="list_equipment",
        )
        return response.json()

    async def create_equipment(self, equipment: dict[str, Any]) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/rest/v1/equipment",
            key=self.secret_key,
            json=equipment,
            headers={"Prefer": "return=representation"},
            operation="create_equipment",
        )
        records = response.json()
        return records[0] if records else {}

    async def update_equipment(
        self,
        workspace_id: str,
        equipment_id: str,
        equipment: dict[str, Any],
    ) -> dict[str, Any] | None:
        response = await self._request(
            "PATCH",
            "/rest/v1/equipment",
            key=self.secret_key,
            params={
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{equipment_id}",
            },
            json=equipment,
            headers={"Prefer": "return=representation"},
            operation="update_equipment",
        )
        records = response.json()
        return records[0] if records else None

    async def archive_equipment(
        self,
        workspace_id: str,
        equipment_id: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "PATCH",
            "/rest/v1/equipment",
            key=self.secret_key,
            params={
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{equipment_id}",
            },
            json={"status": "archived"},
            headers={"Prefer": "return=representation"},
            operation="archive_equipment",
        )
        records = response.json()
        return records[0] if records else None

    async def get_equipment(
        self,
        workspace_id: str,
        equipment_id: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "GET",
            "/rest/v1/equipment",
            key=self.secret_key,
            params={
                "select": "id,name,asset_tag,manufacturer,model,status",
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{equipment_id}",
                "limit": "1",
            },
            operation="get_equipment",
        )
        records = response.json()
        return records[0] if records else None

    async def list_fault_reports(
        self,
        workspace_id: str,
        *,
        created_by: str | None,
    ) -> list[dict[str, Any]]:
        params = {
            "select": (
                "id,equipment_id,fault_code,symptom,planned_task,operating_context,status,"
                "ack_authorized_qualified,ack_loto_isolation,ack_ppe_stored_energy,"
                "ack_stop_escalate,activated_at,resolved_at,resolved_by_user_id,"
                "resolution_summary,created_by,created_at,updated_at"
            ),
            "workspace_id": f"eq.{workspace_id}",
            "order": "created_at.desc",
        }
        if created_by:
            params["created_by"] = f"eq.{created_by}"
        response = await self._request(
            "GET",
            "/rest/v1/fault_reports",
            key=self.secret_key,
            params=params,
            operation="list_fault_reports",
        )
        return response.json()

    async def search_resolved_fault_reports(
        self,
        workspace_id: str,
        *,
        equipment_id: str | None,
        search_text: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "POST",
            "/rest/v1/rpc/search_resolved_fault_reports",
            key=self.secret_key,
            json={
                "target_workspace_id": workspace_id,
                "target_equipment_id": equipment_id,
                "target_search_text": search_text,
                "target_limit": limit,
            },
            operation="search_resolved_fault_reports",
        )
        return response.json()

    async def create_fault_report(self, report: dict[str, Any]) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/rest/v1/fault_reports",
            key=self.secret_key,
            json=report,
            headers={"Prefer": "return=representation"},
            operation="create_fault_report",
        )
        records = response.json()
        return records[0] if records else {}

    async def get_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        *,
        created_by: str | None,
    ) -> dict[str, Any] | None:
        params = {
            "select": (
                "id,equipment_id,fault_code,symptom,planned_task,operating_context,status,"
                "ack_authorized_qualified,ack_loto_isolation,ack_ppe_stored_energy,"
                "ack_stop_escalate,activated_at,resolved_at,resolved_by_user_id,"
                "resolution_summary,created_by,created_at,updated_at"
            ),
            "workspace_id": f"eq.{workspace_id}",
            "id": f"eq.{report_id}",
            "limit": "1",
        }
        if created_by:
            params["created_by"] = f"eq.{created_by}"
        response = await self._request(
            "GET",
            "/rest/v1/fault_reports",
            key=self.secret_key,
            params=params,
            operation="get_fault_report",
        )
        records = response.json()
        return records[0] if records else None

    async def list_fault_report_work_logs(
        self,
        workspace_id: str,
        report_id: str,
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "GET",
            "/rest/v1/fault_report_work_logs",
            key=self.secret_key,
            params={
                "select": "id,fault_report_id,author_user_id,entry_type,note,created_at",
                "workspace_id": f"eq.{workspace_id}",
                "fault_report_id": f"eq.{report_id}",
                "order": "created_at.asc,id.asc",
            },
            operation="list_fault_report_work_logs",
        )
        return response.json()

    async def create_fault_report_work_log(
        self,
        workspace_id: str,
        report_id: str,
        author_user_id: str,
        entry_type: str,
        note: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "POST",
            "/rest/v1/rpc/create_fault_report_work_log",
            key=self.secret_key,
            json={
                "target_workspace_id": workspace_id,
                "target_report_id": report_id,
                "target_author_user_id": author_user_id,
                "target_entry_type": entry_type,
                "target_note": note,
            },
            operation="create_fault_report_work_log",
        )
        records = response.json()
        return records[0] if records else None

    async def resolve_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        user_id: str,
        resolution_summary: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "POST",
            "/rest/v1/rpc/resolve_fault_report_with_log",
            key=self.secret_key,
            json={
                "target_workspace_id": workspace_id,
                "target_report_id": report_id,
                "target_user_id": user_id,
                "target_resolution_summary": resolution_summary,
            },
            operation="resolve_fault_report",
        )
        records = response.json()
        return records[0] if records else None

    async def list_fault_report_attachments(
        self,
        workspace_id: str,
        report_id: str,
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "GET",
            "/rest/v1/fault_report_attachments",
            key=self.secret_key,
            params={
                "select": (
                    "id,workspace_id,fault_report_id,uploaded_by_user_id,"
                    "storage_path,file_name,mime_type,size_bytes,created_at"
                ),
                "workspace_id": f"eq.{workspace_id}",
                "fault_report_id": f"eq.{report_id}",
                "order": "created_at.asc,id.asc",
            },
            operation="list_fault_report_attachments",
        )
        return response.json()

    async def get_fault_report_attachment(
        self,
        workspace_id: str,
        report_id: str,
        attachment_id: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "GET",
            "/rest/v1/fault_report_attachments",
            key=self.secret_key,
            params={
                "select": (
                    "id,workspace_id,fault_report_id,uploaded_by_user_id,"
                    "storage_path,file_name,mime_type,size_bytes,created_at"
                ),
                "workspace_id": f"eq.{workspace_id}",
                "fault_report_id": f"eq.{report_id}",
                "id": f"eq.{attachment_id}",
                "limit": "1",
            },
            operation="get_fault_report_attachment",
        )
        records = response.json()
        return records[0] if records else None

    async def create_fault_report_attachment(
        self,
        attachment: dict[str, Any],
    ) -> dict[str, Any] | None:
        response = await self._request(
            "POST",
            "/rest/v1/rpc/create_fault_report_attachment",
            key=self.secret_key,
            json={
                "target_id": attachment["id"],
                "target_workspace_id": attachment["workspace_id"],
                "target_report_id": attachment["fault_report_id"],
                "target_user_id": attachment["uploaded_by_user_id"],
                "target_storage_path": attachment["storage_path"],
                "target_file_name": attachment["file_name"],
                "target_mime_type": attachment["mime_type"],
                "target_size_bytes": attachment["size_bytes"],
            },
            operation="create_fault_report_attachment",
        )
        records = response.json()
        return records[0] if records else None

    async def delete_draft_fault_report_attachment(
        self,
        workspace_id: str,
        report_id: str,
        attachment_id: str,
        user_id: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "POST",
            "/rest/v1/rpc/delete_draft_fault_report_attachment",
            key=self.secret_key,
            json={
                "target_workspace_id": workspace_id,
                "target_report_id": report_id,
                "target_attachment_id": attachment_id,
                "target_user_id": user_id,
            },
            operation="delete_draft_fault_report_attachment",
        )
        records = response.json()
        return records[0] if records else None

    async def activate_fault_report(
        self,
        workspace_id: str,
        report_id: str,
        created_by: str,
        activation: dict[str, Any],
    ) -> dict[str, Any] | None:
        response = await self._request(
            "PATCH",
            "/rest/v1/fault_reports",
            key=self.secret_key,
            params={
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{report_id}",
                "created_by": f"eq.{created_by}",
                "status": "eq.draft",
            },
            json=activation,
            headers={"Prefer": "return=representation"},
            operation="activate_fault_report",
        )
        records = response.json()
        return records[0] if records else None

    async def list_documents(
        self,
        workspace_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, Any]]:
        params = {
            "select": (
                "id,title,document_type,status,equipment_id,source_revision,description,"
                "file_name,content_type,size_bytes,index_status,indexed_at,"
                "indexed_page_count,indexed_chunk_count,indexing_error_code,"
                "created_at,updated_at"
            ),
            "workspace_id": f"eq.{workspace_id}",
            "order": "title.asc,created_at.desc",
        }
        if not include_archived:
            params["status"] = "eq.approved"
        response = await self._request(
            "GET",
            "/rest/v1/documents",
            key=self.secret_key,
            params=params,
            operation="list_documents",
        )
        return response.json()

    async def create_document(self, document: dict[str, Any]) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/rest/v1/documents",
            key=self.secret_key,
            json=document,
            headers={"Prefer": "return=representation"},
            operation="create_document",
        )
        records = response.json()
        return records[0] if records else {}

    async def update_document(
        self,
        workspace_id: str,
        document_id: str,
        metadata: dict[str, Any],
    ) -> dict[str, Any] | None:
        response = await self._request(
            "PATCH",
            "/rest/v1/documents",
            key=self.secret_key,
            params={
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{document_id}",
            },
            json=metadata,
            headers={"Prefer": "return=representation"},
            operation="update_document",
        )
        records = response.json()
        return records[0] if records else None

    async def archive_document(
        self,
        workspace_id: str,
        document_id: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "PATCH",
            "/rest/v1/documents",
            key=self.secret_key,
            params={
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{document_id}",
            },
            json={"status": "archived"},
            headers={"Prefer": "return=representation"},
            operation="archive_document",
        )
        records = response.json()
        return records[0] if records else None

    async def get_document_for_access(
        self,
        workspace_id: str,
        document_id: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "GET",
            "/rest/v1/documents",
            key=self.secret_key,
            params={
                "select": "id,status,storage_path,file_name,content_type",
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{document_id}",
                "limit": "1",
            },
            operation="get_document_for_access",
        )
        records = response.json()
        return records[0] if records else None

    async def get_document_for_index(
        self,
        workspace_id: str,
        document_id: str,
    ) -> dict[str, Any] | None:
        response = await self._request(
            "GET",
            "/rest/v1/documents",
            key=self.secret_key,
            params={
                "select": (
                    "id,workspace_id,equipment_id,title,document_type,status,storage_path,"
                    "source_revision,description,file_name,content_type,size_bytes,"
                    "index_status,indexed_at,indexed_page_count,indexed_chunk_count,"
                    "indexing_error_code,created_at,updated_at"
                ),
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{document_id}",
                "limit": "1",
            },
            operation="get_document_for_index",
        )
        records = response.json()
        return records[0] if records else None

    async def download_document_file(self, storage_path: str) -> bytes:
        encoded_path = quote(storage_path, safe="/")
        response = await self._request(
            "GET",
            f"/storage/v1/object/{self.document_bucket}/{encoded_path}",
            key=self.secret_key,
            headers={"Accept": "application/pdf"},
            operation="download_document_file",
        )
        return response.content

    async def update_document_index_status(
        self,
        workspace_id: str,
        document_id: str,
        values: dict[str, Any],
    ) -> dict[str, Any] | None:
        response = await self._request(
            "PATCH",
            "/rest/v1/documents",
            key=self.secret_key,
            params={
                "workspace_id": f"eq.{workspace_id}",
                "id": f"eq.{document_id}",
            },
            json=values,
            headers={"Prefer": "return=representation"},
            operation="update_document_index_status",
        )
        records = response.json()
        return records[0] if records else None

    async def replace_document_chunks(
        self,
        workspace_id: str,
        document_id: str,
        chunks: list[dict[str, Any]],
    ) -> None:
        await self._request(
            "DELETE",
            "/rest/v1/document_chunks",
            key=self.secret_key,
            params={
                "workspace_id": f"eq.{workspace_id}",
                "document_id": f"eq.{document_id}",
            },
            operation="clear_document_chunks",
        )
        for start in range(0, len(chunks), 200):
            await self._request(
                "POST",
                "/rest/v1/document_chunks",
                key=self.secret_key,
                json=chunks[start : start + 200],
                headers={"Prefer": "return=minimal"},
                operation="insert_document_chunks",
            )

    async def search_approved_document_chunks(
        self,
        workspace_id: str,
        equipment_id: str,
        search_text: str,
        *,
        limit: int,
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "POST",
            "/rest/v1/rpc/search_grounded_document_chunks",
            key=self.secret_key,
            json={
                "target_workspace_id": workspace_id,
                "target_equipment_id": equipment_id,
                "target_search_text": search_text,
                "target_limit": limit,
            },
            operation="search_grounded_document_chunks",
        )
        return response.json()

    async def get_latest_guidance_plan(
        self,
        workspace_id: str,
        report_id: str,
        *,
        created_by: str | None,
    ) -> dict[str, Any] | None:
        params = {
            "select": (
                "id,fault_report_id,status,case_summary,safety_brief_items,guided_checks,"
                "escalation_criteria,evidence_chunk_ids,evidence_snapshot,model,created_by,"
                "created_at"
            ),
            "workspace_id": f"eq.{workspace_id}",
            "fault_report_id": f"eq.{report_id}",
            "order": "created_at.desc",
            "limit": "1",
        }
        if created_by:
            params["created_by"] = f"eq.{created_by}"
        response = await self._request(
            "GET",
            "/rest/v1/guidance_plans",
            key=self.secret_key,
            params=params,
            operation="get_latest_guidance_plan",
        )
        records = response.json()
        return records[0] if records else None

    async def create_guidance_plan(
        self,
        plan: dict[str, Any],
    ) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/rest/v1/guidance_plans",
            key=self.secret_key,
            json=plan,
            headers={"Prefer": "return=representation"},
            operation="create_guidance_plan",
        )
        records = response.json()
        return records[0] if records else {}

    async def upload_document_file(
        self,
        storage_path: str,
        content_type: str,
        content: bytes,
    ) -> None:
        encoded_path = quote(storage_path, safe="/")
        await self._request(
            "POST",
            f"/storage/v1/object/{self.document_bucket}/{encoded_path}",
            key=self.secret_key,
            content=content,
            headers={"Content-Type": content_type, "x-upsert": "false"},
            operation="upload_document_file",
        )

    async def remove_document_file(self, storage_path: str) -> None:
        encoded_path = quote(storage_path, safe="/")
        await self._request(
            "DELETE",
            f"/storage/v1/object/{self.document_bucket}/{encoded_path}",
            key=self.secret_key,
            operation="remove_document_file",
        )

    async def create_document_signed_url(
        self,
        storage_path: str,
        *,
        expires_in: int,
    ) -> str:
        encoded_path = quote(storage_path, safe="/")
        response = await self._request(
            "POST",
            f"/storage/v1/object/sign/{self.document_bucket}/{encoded_path}",
            key=self.secret_key,
            json={"expiresIn": expires_in},
            operation="create_document_signed_url",
        )
        payload = response.json()
        signed_path = payload.get("signedURL") or payload.get("signedUrl")
        if not isinstance(signed_path, str) or not signed_path:
            raise SupabaseRequestError(
                502,
                "create_document_signed_url",
                "invalid_response",
                "Supabase did not return a signed document URL",
            )
        if signed_path.startswith("/storage/v1/"):
            return f"{self.url}{signed_path}"
        if signed_path.startswith("/object/"):
            return f"{self.url}/storage/v1{signed_path}"
        parsed = urlparse(signed_path)
        if parsed.scheme in {"http", "https"} and parsed.netloc == urlparse(self.url).netloc:
            return signed_path
        raise SupabaseRequestError(
            502,
            "create_document_signed_url",
            "invalid_response",
            "Supabase returned an invalid signed document URL",
        )

    async def upload_fault_report_attachment_file(
        self,
        storage_path: str,
        content_type: str,
        content: bytes,
    ) -> None:
        encoded_path = quote(storage_path, safe="/")
        await self._request(
            "POST",
            f"/storage/v1/object/{self.fault_report_attachment_bucket}/{encoded_path}",
            key=self.secret_key,
            content=content,
            headers={"Content-Type": content_type, "x-upsert": "false"},
            operation="upload_fault_report_attachment_file",
        )

    async def remove_fault_report_attachment_file(self, storage_path: str) -> None:
        encoded_path = quote(storage_path, safe="/")
        await self._request(
            "DELETE",
            f"/storage/v1/object/{self.fault_report_attachment_bucket}/{encoded_path}",
            key=self.secret_key,
            operation="remove_fault_report_attachment_file",
        )

    async def create_fault_report_attachment_signed_url(
        self,
        storage_path: str,
        *,
        expires_in: int,
    ) -> str:
        encoded_path = quote(storage_path, safe="/")
        response = await self._request(
            "POST",
            (
                "/storage/v1/object/sign/"
                f"{self.fault_report_attachment_bucket}/{encoded_path}"
            ),
            key=self.secret_key,
            json={"expiresIn": expires_in},
            operation="create_fault_report_attachment_signed_url",
        )
        payload = response.json()
        signed_path = payload.get("signedURL") or payload.get("signedUrl")
        if not isinstance(signed_path, str) or not signed_path:
            raise SupabaseRequestError(
                502,
                "create_fault_report_attachment_signed_url",
                "invalid_response",
                "Supabase did not return a signed attachment URL",
            )
        if signed_path.startswith("/storage/v1/"):
            return f"{self.url}{signed_path}"
        if signed_path.startswith("/object/"):
            return f"{self.url}/storage/v1{signed_path}"
        parsed = urlparse(signed_path)
        if parsed.scheme in {"http", "https"} and parsed.netloc == urlparse(self.url).netloc:
            return signed_path
        raise SupabaseRequestError(
            502,
            "create_fault_report_attachment_signed_url",
            "invalid_response",
            "Supabase returned an invalid signed attachment URL",
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        key: str,
        operation: str,
        bearer: str | None = None,
        params: dict[str, str] | None = None,
        json: Any | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        request_headers = {"apikey": key, "Accept": "application/json"}
        if bearer:
            request_headers["Authorization"] = f"Bearer {bearer}"
        elif key.startswith("eyJ"):
            # Legacy service-role JWTs require a bearer header. Modern
            # sb_secret_ keys must remain only in the apikey header.
            request_headers["Authorization"] = f"Bearer {key}"
        if headers:
            request_headers.update(headers)

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                response = await client.request(
                    method,
                    f"{self.url}{path}",
                    headers=request_headers,
                    params=params,
                    json=json,
                    content=content,
                )
        except httpx.RequestError as error:
            logger.error(
                "Supabase network failure operation=%s error_type=%s",
                operation,
                type(error).__name__,
            )
            raise

        if not response.is_success:
            code, safe_message = _safe_error_details(response)
            logger.warning(
                "Supabase request rejected operation=%s status=%s code=%s message=%s",
                operation,
                response.status_code,
                code or "unknown",
                safe_message,
            )
            raise SupabaseRequestError(
                response.status_code,
                operation,
                code,
                safe_message,
            )
        return response
