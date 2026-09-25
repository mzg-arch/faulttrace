"""Admin-only workspace member and invitation endpoints."""

import asyncio
import logging
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_admin as authorized_admin,
)
from app.supabase import SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["team"])
logger = logging.getLogger("faulttrace.team")
WORKSPACE_DUPLICATE_DETAIL = (
    "This email already has an invitation or membership in this workspace."
)


def invitation_http_error(error: SupabaseRequestError) -> HTTPException:
    """Translate a sanitized Supabase failure into an actionable API response."""
    code = (error.code or "").lower()
    message = error.safe_message.lower()

    if error.operation == "finalize_invitation":
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Supabase created the invited account, but FaultTrace could not finalize "
                "workspace access. Check the API logs before retrying."
            ),
        )

    is_rate_limited = error.status_code == status.HTTP_429_TOO_MANY_REQUESTS or "rate_limit" in code
    if is_rate_limited:
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Supabase's email delivery limit was reached. "
                "Wait before sending another invitation."
            ),
        )

    recipient_is_restricted = (
        code == "email_address_not_authorized" or "email address not authorized" in message
    )
    if recipient_is_restricted:
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Supabase's built-in email service is not authorized to send to this "
                "address. Use an address authorized for this Supabase project."
            ),
        )

    if code in {"email_address_invalid", "email_validation_failed", "validation_failed"}:
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Supabase rejected this email address. Check it and try again.",
        )

    account_conflict_codes = {"email_exists", "identity_already_exists", "user_already_exists"}
    if code in account_conflict_codes:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Supabase could not create a new invited account because this email may already "
                "be registered. FaultTrace found no invitation or membership in this workspace."
            ),
        )

    if code in {"email_provider_disabled", "signup_disabled"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Supabase email invitations are disabled for this project. "
                "Check the Auth provider configuration."
            ),
        )

    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN) or code in {
        "bad_jwt",
        "invalid_jwt",
    }:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Supabase rejected the backend invitation credentials. "
                "Check the API server configuration."
            ),
        )

    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR or code == "unexpected_failure":
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Supabase could not deliver the invitation email. "
                "Try again later or check the Supabase Auth logs."
            ),
        )

    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="Supabase rejected the invitation request. Check the email and Auth configuration.",
    )


class InviteMemberRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=120)
    role: Literal["admin", "technician"]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("@") != 1 or "." not in normalized.rsplit("@", 1)[1]:
            raise ValueError("Enter a valid email address.")
        return normalized

    @field_validator("display_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Enter a display name.")
        return normalized


class MemberResponse(BaseModel):
    user_id: str
    display_name: str
    email: str | None
    role: Literal["admin", "technician"]
    status: Literal["active", "invited"]


class InviteMemberResponse(BaseModel):
    message: str
    member: MemberResponse


@router.get("/{workspace_id}/members", response_model=list[MemberResponse])
async def list_members(
    workspace_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> list[MemberResponse]:
    gateway, _ = await authorized_admin(workspace_id, token, settings)
    try:
        memberships = await gateway.list_workspace_memberships(str(workspace_id))
        user_ids = [membership["user_id"] for membership in memberships]
        profiles = await gateway.list_profiles(user_ids)
        auth_users = await asyncio.gather(
            *(gateway.get_auth_user(user_id) for user_id in user_ids),
        )
    except (httpx.HTTPError, SupabaseRequestError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Team access could not be loaded.",
        ) from None

    profile_by_id = {profile["id"]: profile for profile in profiles}
    auth_by_id = {user["id"]: user for user in auth_users}
    members: list[MemberResponse] = []
    for membership in memberships:
        user_id = membership["user_id"]
        profile = profile_by_id.get(user_id, {})
        auth_user = auth_by_id.get(user_id, {})
        is_active = bool(auth_user.get("email_confirmed_at") or auth_user.get("confirmed_at"))
        if is_active:
            await gateway.mark_invitation_accepted(str(workspace_id), user_id)
        members.append(
            MemberResponse(
                user_id=user_id,
                display_name=profile.get("display_name") or "Workspace member",
                email=auth_user.get("email"),
                role=membership["role"],
                status="active" if is_active else "invited",
            )
        )
    return members


@router.post(
    "/{workspace_id}/invitations",
    response_model=InviteMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    workspace_id: UUID,
    payload: InviteMemberRequest,
    token: TokenDependency,
    settings: SettingsDependency,
) -> InviteMemberResponse:
    gateway, caller = await authorized_admin(workspace_id, token, settings)
    invitation_record = {
        "workspace_id": str(workspace_id),
        "email": payload.email,
        "display_name": payload.display_name,
        "role": payload.role,
        "invited_by": caller["id"],
    }

    try:
        workspace_access_exists = await gateway.workspace_access_exists(
            str(workspace_id),
            payload.email,
        )
    except (httpx.HTTPError, SupabaseRequestError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Existing workspace access could not be verified.",
        ) from None

    if workspace_access_exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=WORKSPACE_DUPLICATE_DETAIL,
        )

    try:
        invitation = await gateway.reserve_invitation(invitation_record)
    except SupabaseRequestError as error:
        if error.status_code == status.HTTP_409_CONFLICT:
            try:
                workspace_access_exists = await gateway.workspace_access_exists(
                    str(workspace_id),
                    payload.email,
                )
            except (httpx.HTTPError, SupabaseRequestError):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Existing workspace access could not be verified.",
                ) from None
            if workspace_access_exists:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=WORKSPACE_DUPLICATE_DETAIL,
                ) from None

            try:
                invitation = await gateway.reclaim_failed_invitation(invitation_record)
            except (httpx.HTTPError, SupabaseRequestError):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="The failed invitation could not be prepared for retry.",
                ) from None
            if invitation:
                logger.info(
                    "Reclaimed failed invitation reservation workspace_id=%s role=%s",
                    workspace_id,
                    payload.role,
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Supabase reported a conflict while preparing the invitation. Try again.",
                ) from None
        elif error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Supabase rejected the backend invitation credentials. "
                    "Check the API server configuration."
                ),
            ) from None
        elif error.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The Supabase invitation data service is not available.",
            ) from None
        elif error.status_code != status.HTTP_409_CONFLICT:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The invitation could not be prepared.",
            ) from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The invitation service is unavailable.",
        ) from None

    try:
        invited_user = await gateway.send_invitation(payload.email, payload.display_name)
        auth_user_id = invited_user.get("id") or invited_user.get("user", {}).get("id")
        if not auth_user_id:
            logger.warning("Supabase invite response did not include an invited user id")
            raise SupabaseRequestError(
                status.HTTP_502_BAD_GATEWAY,
                "send_invitation",
                "invalid_response",
                "Supabase invite response did not include an invited user id",
            )
        await gateway.finalize_invitation(invitation["id"], auth_user_id)
    except SupabaseRequestError as error:
        await gateway.mark_invitation_failed(invitation["id"])
        raise invitation_http_error(error) from None
    except httpx.HTTPError:
        await gateway.mark_invitation_failed(invitation["id"])
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The invitation service is unavailable.",
        ) from None

    return InviteMemberResponse(
        message=f"Invitation sent to {payload.email}.",
        member=MemberResponse(
            user_id=auth_user_id,
            display_name=payload.display_name,
            email=payload.email,
            role=payload.role,
            status="invited",
        ),
    )
