"""Equipment authorization, scoping, validation, and error tests."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi import HTTPException
from pydantic import SecretStr, ValidationError

from app.authorization import authorized_workspace_admin, authorized_workspace_member
from app.routers.equipment import (
    EquipmentInput,
    archive_equipment,
    create_equipment,
    list_equipment,
    update_equipment,
)
from app.settings import Settings
from app.supabase import SupabaseRequestError


WORKSPACE_ID = UUID("11111111-1111-1111-1111-111111111111")
EQUIPMENT_ID = UUID("22222222-2222-2222-2222-222222222222")


def test_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example_key_1234567890",
        supabase_secret_key=SecretStr("sb_secret_example_key_1234567890"),
        cors_origins="http://localhost:3000",
    )


def equipment_record(**overrides: object) -> dict[str, object]:
    record: dict[str, object] = {
        "id": str(EQUIPMENT_ID),
        "name": "ACS580 Drive",
        "asset_tag": "FT-DRV-001",
        "manufacturer": "ABB",
        "model": "ACS580-01",
        "location": "Line 1 Pump Room",
        "status": "active",
        "created_at": "2026-09-21T12:00:00Z",
        "updated_at": "2026-09-21T12:00:00Z",
    }
    record.update(overrides)
    return record


class FakeEquipmentGateway:
    def __init__(self) -> None:
        self.include_archived: bool | None = None
        self.created_payload: dict[str, object] | None = None
        self.updated_scope: tuple[str, str] | None = None
        self.archived_scope: tuple[str, str] | None = None
        self.create_error: SupabaseRequestError | None = None

    async def list_equipment(
        self,
        _workspace_id: str,
        *,
        include_archived: bool,
    ) -> list[dict[str, object]]:
        self.include_archived = include_archived
        return [equipment_record()]

    async def create_equipment(self, payload: dict[str, object]) -> dict[str, object]:
        if self.create_error:
            raise self.create_error
        self.created_payload = payload
        return equipment_record()

    async def update_equipment(
        self,
        workspace_id: str,
        equipment_id: str,
        _payload: dict[str, object],
    ) -> dict[str, object]:
        self.updated_scope = (workspace_id, equipment_id)
        return equipment_record(name="Updated drive")

    async def archive_equipment(
        self,
        workspace_id: str,
        equipment_id: str,
    ) -> dict[str, object]:
        self.archived_scope = (workspace_id, equipment_id)
        return equipment_record(status="archived")


class FakeAuthorizationGateway:
    def __init__(self, role: str | None) -> None:
        self.role = role

    @property
    def is_configured(self) -> bool:
        return True

    async def verify_user(self, _token: str) -> dict[str, str]:
        return {"id": "caller-id"}

    async def get_workspace_role(
        self,
        _token: str,
        _user_id: str,
        _workspace_id: str,
    ) -> str | None:
        return self.role


class EquipmentValidationTests(unittest.TestCase):
    def test_required_values_are_trimmed_and_optional_blanks_become_none(self) -> None:
        payload = EquipmentInput(
            name="  ACS580   Drive  ",
            asset_tag="  FT-DRV-001 ",
            manufacturer="  ",
            model=" ACS580-01 ",
            location=" Line 1   Pump Room ",
        )

        self.assertEqual(payload.name, "ACS580 Drive")
        self.assertEqual(payload.asset_tag, "FT-DRV-001")
        self.assertIsNone(payload.manufacturer)
        self.assertEqual(payload.location, "Line 1 Pump Room")

    def test_blank_asset_tag_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            EquipmentInput(name="Drive", asset_tag="   ")


class EquipmentAuthorizationTests(unittest.TestCase):
    def test_non_member_cannot_access_workspace_equipment(self) -> None:
        gateway = FakeAuthorizationGateway(None)
        with patch("app.authorization.SupabaseGateway", return_value=gateway):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    authorized_workspace_member(WORKSPACE_ID, "token", test_settings())
                )

        self.assertEqual(context.exception.status_code, 403)

    def test_technician_cannot_use_admin_equipment_routes(self) -> None:
        gateway = FakeAuthorizationGateway("technician")
        with patch("app.authorization.SupabaseGateway", return_value=gateway):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    authorized_workspace_admin(WORKSPACE_ID, "token", test_settings())
                )

        self.assertEqual(context.exception.status_code, 403)


class EquipmentEndpointTests(unittest.TestCase):
    def test_technician_list_excludes_archived_equipment(self) -> None:
        gateway = FakeEquipmentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}, "technician"))
        with patch("app.routers.equipment.authorized_workspace_member", authorization):
            records = asyncio.run(
                list_equipment(WORKSPACE_ID, "token", test_settings())
            )

        self.assertEqual(len(records), 1)
        self.assertFalse(gateway.include_archived)

    def test_admin_list_includes_archived_equipment(self) -> None:
        gateway = FakeEquipmentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}, "admin"))
        with patch("app.routers.equipment.authorized_workspace_member", authorization):
            asyncio.run(list_equipment(WORKSPACE_ID, "token", test_settings()))

        self.assertTrue(gateway.include_archived)

    def test_create_uses_path_workspace_and_authenticated_creator(self) -> None:
        gateway = FakeEquipmentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        payload = EquipmentInput(name="Drive", asset_tag="FT-001")
        with patch("app.routers.equipment.authorized_workspace_admin", authorization):
            asyncio.run(
                create_equipment(WORKSPACE_ID, payload, "token", test_settings())
            )

        self.assertEqual(gateway.created_payload["workspace_id"], str(WORKSPACE_ID))
        self.assertEqual(gateway.created_payload["created_by"], "caller-id")

    def test_duplicate_asset_tag_returns_specific_conflict(self) -> None:
        gateway = FakeEquipmentGateway()
        gateway.create_error = SupabaseRequestError(
            409,
            "create_equipment",
            "23505",
            "duplicate key value violates unique constraint",
        )
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        with patch("app.routers.equipment.authorized_workspace_admin", authorization):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(
                    create_equipment(
                        WORKSPACE_ID,
                        EquipmentInput(name="Drive", asset_tag="FT-001"),
                        "token",
                        test_settings(),
                    )
                )

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(
            context.exception.detail,
            "Asset ID already exists in this workspace.",
        )

    def test_update_and_archive_are_scoped_to_path_workspace(self) -> None:
        gateway = FakeEquipmentGateway()
        authorization = AsyncMock(return_value=(gateway, {"id": "caller-id"}))
        payload = EquipmentInput(name="Updated drive", asset_tag="FT-001")
        with patch("app.routers.equipment.authorized_workspace_admin", authorization):
            asyncio.run(
                update_equipment(
                    WORKSPACE_ID,
                    EQUIPMENT_ID,
                    payload,
                    "token",
                    test_settings(),
                )
            )
            asyncio.run(
                archive_equipment(
                    WORKSPACE_ID,
                    EQUIPMENT_ID,
                    "token",
                    test_settings(),
                )
            )

        expected_scope = (str(WORKSPACE_ID), str(EQUIPMENT_ID))
        self.assertEqual(gateway.updated_scope, expected_scope)
        self.assertEqual(gateway.archived_scope, expected_scope)


if __name__ == "__main__":
    unittest.main()
