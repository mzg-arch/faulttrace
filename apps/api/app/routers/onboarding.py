"""Public company onboarding backed by trusted, server-only Supabase operations."""

from __future__ import annotations

from collections import defaultdict, deque
from hashlib import sha256
import logging
import re
from threading import Lock
import time
import unicodedata

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.authorization import SettingsDependency
from app.supabase import SupabaseGateway, SupabaseRequestError


router = APIRouter(prefix="/onboarding", tags=["onboarding"])
logger = logging.getLogger("faulttrace.onboarding")

GENERIC_ACCEPTED_MESSAGE = (
    "If this company setup request is eligible, an administrator invitation "
    "will be sent to the work email provided."
)
RATE_LIMIT_MESSAGE = "Too many company setup attempts. Wait before trying again."
SERVICE_ERROR_MESSAGE = "Company workspace setup is unavailable right now. Try again later."


class WorkspaceOnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_name: str = Field(min_length=2, max_length=120)
    administrator_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)

    @field_validator("workspace_name", "administrator_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 2:
            raise ValueError("Enter at least two characters.")
        if any(unicodedata.category(character).startswith("C") for character in normalized):
            raise ValueError("Control characters are not allowed.")
        return normalized

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid work email.")
        return normalized


class WorkspaceOnboardingResponse(BaseModel):
    message: str


class OnboardingRateLimiter:
    """Small in-process limiter suitable for a single-process prototype API."""

    def __init__(
        self,
        *,
        ip_limit: int = 5,
        ip_window_seconds: int = 15 * 60,
        email_limit: int = 3,
        email_window_seconds: int = 60 * 60,
    ) -> None:
        self.ip_limit = ip_limit
        self.ip_window_seconds = ip_window_seconds
        self.email_limit = email_limit
        self.email_window_seconds = email_window_seconds
        self._ip_attempts: dict[str, deque[float]] = defaultdict(deque)
        self._email_attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    @staticmethod
    def _prune(attempts: deque[float], cutoff: float) -> None:
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()

    def allow(self, client_ip: str, email: str, *, now: float | None = None) -> bool:
        timestamp = time.monotonic() if now is None else now
        email_key = sha256(email.encode("utf-8")).hexdigest()
        with self._lock:
            ip_attempts = self._ip_attempts[client_ip]
            email_attempts = self._email_attempts[email_key]
            self._prune(ip_attempts, timestamp - self.ip_window_seconds)
            self._prune(email_attempts, timestamp - self.email_window_seconds)
            if len(ip_attempts) >= self.ip_limit or len(email_attempts) >= self.email_limit:
                return False
            ip_attempts.append(timestamp)
            email_attempts.append(timestamp)
            return True

    def reset(self) -> None:
        """Clear process-local counters; used by isolated tests."""
        with self._lock:
            self._ip_attempts.clear()
            self._email_attempts.clear()


onboarding_rate_limiter = OnboardingRateLimiter()


def workspace_slug(workspace_name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", workspace_name).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-") or "company"
    digest = sha256(workspace_name.casefold().encode("utf-8")).hexdigest()[:8]
    return f"{base[:55].rstrip('-')}-{digest}"


async def _cancel_unfinished_onboarding(
    gateway: SupabaseGateway,
    workspace_id: str,
    invitation_id: str,
) -> None:
    try:
        removed = await gateway.cancel_company_workspace_onboarding(
            workspace_id=workspace_id,
            invitation_id=invitation_id,
        )
        if not removed:
            logger.warning("Unfinished onboarding cleanup was safely refused")
    except (httpx.HTTPError, SupabaseRequestError):
        logger.error("Unfinished onboarding cleanup failed")


def _is_duplicate(error: SupabaseRequestError) -> bool:
    return error.status_code == status.HTTP_409_CONFLICT or (error.code or "") == "23505"


@router.post(
    "/workspaces",
    response_model=WorkspaceOnboardingResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_company_workspace(
    payload: WorkspaceOnboardingRequest,
    request: Request,
    settings: SettingsDependency,
) -> WorkspaceOnboardingResponse:
    client_ip = request.client.host if request.client else "unknown"
    if not onboarding_rate_limiter.allow(client_ip, payload.email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=RATE_LIMIT_MESSAGE,
        )

    gateway = SupabaseGateway(settings)
    if not gateway.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SERVICE_ERROR_MESSAGE,
        )

    try:
        onboarding = await gateway.begin_company_workspace_onboarding(
            workspace_name=payload.workspace_name,
            workspace_slug=workspace_slug(payload.workspace_name),
            email=payload.email,
            display_name=payload.administrator_name,
        )
    except SupabaseRequestError as error:
        if _is_duplicate(error):
            try:
                onboarding = await gateway.resume_company_workspace_onboarding(
                    workspace_name=payload.workspace_name,
                    workspace_slug=workspace_slug(payload.workspace_name),
                    email=payload.email,
                    display_name=payload.administrator_name,
                )
            except (httpx.HTTPError, SupabaseRequestError):
                logger.warning("Orphaned company onboarding recovery lookup failed")
                return WorkspaceOnboardingResponse(message=GENERIC_ACCEPTED_MESSAGE)
            if onboarding is None:
                return WorkspaceOnboardingResponse(message=GENERIC_ACCEPTED_MESSAGE)
            logger.info("Resuming an orphaned initial administrator invitation")
        else:
            logger.warning(
                "Onboarding transaction rejected status=%s code=%s operation=%s",
                error.status_code,
                error.code or "unknown",
                error.operation,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=SERVICE_ERROR_MESSAGE,
            ) from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SERVICE_ERROR_MESSAGE,
        ) from None

    try:
        invited_user = await gateway.send_invitation(
            payload.email,
            payload.administrator_name,
        )
        auth_user_id = invited_user.get("id") or invited_user.get("user", {}).get("id")
        if not auth_user_id:
            raise SupabaseRequestError(
                status.HTTP_502_BAD_GATEWAY,
                "send_invitation",
                "invalid_response",
                "Invitation provider did not return an invited user identifier",
            )
        await gateway.finalize_invitation(onboarding["invitation_id"], str(auth_user_id))
    except SupabaseRequestError as error:
        await _cancel_unfinished_onboarding(
            gateway,
            onboarding["workspace_id"],
            onboarding["invitation_id"],
        )
        logger.warning(
            "Onboarding invitation failed status=%s code=%s operation=%s",
            error.status_code,
            error.code or "unknown",
            error.operation,
        )
        if error.status_code == status.HTTP_429_TOO_MANY_REQUESTS or "rate_limit" in (
            error.code or ""
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=RATE_LIMIT_MESSAGE,
            ) from None
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=SERVICE_ERROR_MESSAGE,
        ) from None
    except httpx.HTTPError:
        await _cancel_unfinished_onboarding(
            gateway,
            onboarding["workspace_id"],
            onboarding["invitation_id"],
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SERVICE_ERROR_MESSAGE,
        ) from None

    return WorkspaceOnboardingResponse(message=GENERIC_ACCEPTED_MESSAGE)
