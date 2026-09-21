"""Workspace-scoped equipment management endpoints."""

from datetime import datetime
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.authorization import (
    SettingsDependency,
    TokenDependency,
    authorized_workspace_admin,
    authorized_workspace_member,
)
from app.supabase import SupabaseRequestError


router = APIRouter(prefix="/workspaces", tags=["equipment"])
EquipmentStatus = Literal["active", "archived"]


class EquipmentInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    asset_tag: str = Field(min_length=1, max_length=80)
    manufacturer: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=160)
    status: EquipmentStatus = "active"

    @field_validator("name", "asset_tag")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("This field is required.")
        return normalized

    @field_validator("manufacturer", "model", "location")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class EquipmentResponse(BaseModel):
    id: UUID
    name: str
    asset_tag: str | None
    manufacturer: str | None
    model: str | None
    location: str | None
    status: EquipmentStatus
    created_at: datetime
    updated_at: datetime


def equipment_http_error(error: SupabaseRequestError, action: str) -> HTTPException:
    code = (error.code or "").lower()
    if code == "23505":
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Asset ID already exists in this workspace.",
        )
    if error.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase rejected the backend equipment credentials.",
        )
    if code in {"42703", "pgrst204"}:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Equipment setup is incomplete. Apply the pending equipment migration.",
        )
    if error.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase could not {action} equipment. Try again later.",
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The equipment service rejected the request to {action} equipment.",
    )


@router.get("/{workspace_id}/equipment", response_model=list[EquipmentResponse])
async def list_equipment(
    workspace_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> list[EquipmentResponse]:
    gateway, _, role = await authorized_workspace_member(workspace_id, token, settings)
    try:
        records = await gateway.list_equipment(
            str(workspace_id),
            include_archived=role == "admin",
        )
    except SupabaseRequestError as error:
        raise equipment_http_error(error, "load") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The equipment service is unavailable.",
        ) from None
    return [EquipmentResponse.model_validate(record) for record in records]


@router.post(
    "/{workspace_id}/equipment",
    response_model=EquipmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_equipment(
    workspace_id: UUID,
    payload: EquipmentInput,
    token: TokenDependency,
    settings: SettingsDependency,
) -> EquipmentResponse:
    gateway, user = await authorized_workspace_admin(workspace_id, token, settings)
    try:
        record = await gateway.create_equipment(
            {
                "workspace_id": str(workspace_id),
                "created_by": user["id"],
                **payload.model_dump(),
            }
        )
    except SupabaseRequestError as error:
        raise equipment_http_error(error, "create") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The equipment service is unavailable.",
        ) from None
    if not record:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Supabase did not return the created equipment record.",
        )
    return EquipmentResponse.model_validate(record)


@router.patch("/{workspace_id}/equipment/{equipment_id}", response_model=EquipmentResponse)
async def update_equipment(
    workspace_id: UUID,
    equipment_id: UUID,
    payload: EquipmentInput,
    token: TokenDependency,
    settings: SettingsDependency,
) -> EquipmentResponse:
    gateway, _ = await authorized_workspace_admin(workspace_id, token, settings)
    try:
        record = await gateway.update_equipment(
            str(workspace_id),
            str(equipment_id),
            payload.model_dump(),
        )
    except SupabaseRequestError as error:
        raise equipment_http_error(error, "update") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The equipment service is unavailable.",
        ) from None
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Equipment was not found in this workspace.",
        )
    return EquipmentResponse.model_validate(record)


@router.post(
    "/{workspace_id}/equipment/{equipment_id}/archive",
    response_model=EquipmentResponse,
)
async def archive_equipment(
    workspace_id: UUID,
    equipment_id: UUID,
    token: TokenDependency,
    settings: SettingsDependency,
) -> EquipmentResponse:
    gateway, _ = await authorized_workspace_admin(workspace_id, token, settings)
    try:
        record = await gateway.archive_equipment(str(workspace_id), str(equipment_id))
    except SupabaseRequestError as error:
        raise equipment_http_error(error, "archive") from None
    except httpx.HTTPError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The equipment service is unavailable.",
        ) from None
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Equipment was not found in this workspace.",
        )
    return EquipmentResponse.model_validate(record)
