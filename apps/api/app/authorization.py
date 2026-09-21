"""Shared FastAPI authorization helpers for workspace-scoped routes."""

from typing import Annotated, Literal
from uuid import UUID

import httpx
from fastapi import Depends, Header, HTTPException, status

from app.settings import Settings, get_settings
from app.supabase import SupabaseGateway, SupabaseRequestError


WorkspaceRole = Literal["admin", "technician"]


def bearer_token(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in is required.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in is required.")
    return token


async def authorized_workspace_member(
    workspace_id: UUID,
    token: str,
    settings: Settings,
) -> tuple[SupabaseGateway, dict, WorkspaceRole]:
    gateway = SupabaseGateway(settings)
    if not gateway.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Workspace service is not configured.",
        )

    try:
        user = await gateway.verify_user(token)
    except (httpx.HTTPError, SupabaseRequestError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is invalid or expired. Sign in again.",
        ) from None

    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in is required.")

    try:
        role = await gateway.get_workspace_role(token, user_id, str(workspace_id))
    except (httpx.HTTPError, SupabaseRequestError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Workspace access could not be verified.",
        ) from None

    if role not in ("admin", "technician"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this workspace.",
        )
    return gateway, user, role


async def authorized_workspace_admin(
    workspace_id: UUID,
    token: str,
    settings: Settings,
) -> tuple[SupabaseGateway, dict]:
    gateway, user, role = await authorized_workspace_member(workspace_id, token, settings)
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Workspace administrator access is required.",
        )
    return gateway, user


TokenDependency = Annotated[str, Depends(bearer_token)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]
