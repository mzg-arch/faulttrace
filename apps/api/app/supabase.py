"""Small HTTP client for Supabase Auth and Data APIs."""

import asyncio
import logging
import re
from typing import Any

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

    async def _request(
        self,
        method: str,
        path: str,
        *,
        key: str,
        operation: str,
        bearer: str | None = None,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
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
