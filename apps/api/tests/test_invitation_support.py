"""Focused tests for invitation configuration and safe error handling."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import SecretStr

from app.routers.team import (
    WORKSPACE_DUPLICATE_DETAIL,
    InviteMemberRequest,
    invitation_http_error,
    invite_member,
)
from app.settings import BackendConfigurationError, Settings
from app.supabase import SupabaseGateway, SupabaseRequestError, _safe_error_details


def test_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "supabase_url": "https://example.supabase.co",
        "supabase_publishable_key": "sb_publishable_example_key_1234567890",
        "supabase_secret_key": SecretStr("sb_secret_example_key_1234567890"),
        "cors_origins": "http://localhost:3000",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class CapturingAsyncClient:
    request_headers: dict[str, str] = {}

    def __init__(self, **_: object) -> None:
        pass

    async def __aenter__(self) -> "CapturingAsyncClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def request(self, *_: object, **kwargs: object) -> httpx.Response:
        CapturingAsyncClient.request_headers = kwargs["headers"]  # type: ignore[assignment]
        return httpx.Response(200, json={"id": "invited-user-id"})


class FakeInvitationGateway:
    def __init__(
        self,
        *,
        workspace_access_exists: bool = False,
        reserve_error: SupabaseRequestError | None = None,
        send_error: SupabaseRequestError | None = None,
    ) -> None:
        self.existing_access = workspace_access_exists
        self.reserve_error = reserve_error
        self.send_error = send_error
        self.reserve_calls = 0
        self.failed_invitation_ids: list[str] = []

    async def workspace_access_exists(self, _workspace_id: str, _email: str) -> bool:
        return self.existing_access

    async def reserve_invitation(self, _invitation: dict[str, object]) -> dict[str, str]:
        self.reserve_calls += 1
        if self.reserve_error:
            raise self.reserve_error
        return {"id": "invitation-id"}

    async def send_invitation(self, _email: str, _display_name: str) -> dict[str, str]:
        if self.send_error:
            raise self.send_error
        return {"id": "invited-user-id"}

    async def finalize_invitation(self, _invitation_id: str, _auth_user_id: str) -> None:
        return None

    async def mark_invitation_failed(self, invitation_id: str) -> None:
        self.failed_invitation_ids.append(invitation_id)


def run_invitation(gateway: FakeInvitationGateway) -> object:
    admin = AsyncMock(return_value=(gateway, {"id": "admin-user-id"}))
    payload = InviteMemberRequest(
        email="new-technician@example.com",
        display_name="New Technician",
        role="technician",
    )
    with patch("app.routers.team.authorized_admin", admin):
        return asyncio.run(
            invite_member(
                UUID("11111111-1111-1111-1111-111111111111"),
                payload,
                "admin-session-token",
                test_settings(),
            )
        )


class SettingsTests(unittest.TestCase):
    def test_valid_backend_configuration(self) -> None:
        test_settings().validate_backend()

    def test_missing_backend_configuration_names_each_variable(self) -> None:
        settings = test_settings(
            supabase_url="",
            supabase_publishable_key="",
            supabase_secret_key=SecretStr(""),
        )

        with self.assertRaises(BackendConfigurationError) as context:
            settings.validate_backend()

        message = str(context.exception)
        self.assertIn("SUPABASE_URL", message)
        self.assertIn("SUPABASE_PUBLISHABLE_KEY", message)
        self.assertIn("SUPABASE_SECRET_KEY", message)

    def test_swapped_secret_is_rejected_without_exposing_it(self) -> None:
        unsafe_value = "sb_publishable_should_never_appear_in_an_error"
        settings = test_settings(supabase_secret_key=SecretStr(unsafe_value))

        with self.assertRaises(BackendConfigurationError) as context:
            settings.validate_backend()

        self.assertIn("SUPABASE_SECRET_KEY", str(context.exception))
        self.assertNotIn(unsafe_value, str(context.exception))


class SupabaseGatewayTests(unittest.TestCase):
    def test_modern_secret_key_is_sent_only_as_apikey(self) -> None:
        settings = test_settings()
        secret = settings.supabase_secret_key.get_secret_value()
        gateway = SupabaseGateway(settings)

        with patch("app.supabase.httpx.AsyncClient", CapturingAsyncClient):
            asyncio.run(gateway.send_invitation("technician@example.com", "Technician"))

        self.assertEqual(CapturingAsyncClient.request_headers["apikey"], secret)
        self.assertNotIn("Authorization", CapturingAsyncClient.request_headers)

    def test_error_details_redact_email_credentials_and_tokens(self) -> None:
        secret = "sb_secret_example_key_1234567890"
        token = "invitation-token-value"
        response = httpx.Response(
            429,
            json={
                "code": "over_email_send_rate_limit",
                "message": (
                    f"Could not send to technician@example.com; apikey={secret}; "
                    f"confirmation_token={token}; "
                    "action_link=https://example.test/auth?token_hash=another-token"
                ),
            },
        )

        code, message = _safe_error_details(response)

        self.assertEqual(code, "over_email_send_rate_limit")
        self.assertNotIn("technician@example.com", message)
        self.assertNotIn(secret, message)
        self.assertNotIn(token, message)
        self.assertNotIn("another-token", message)


class InvitationResponseTests(unittest.TestCase):
    def test_rate_limit_remains_a_rate_limit(self) -> None:
        error = SupabaseRequestError(
            429,
            "send_invitation",
            "over_email_send_rate_limit",
            "Email rate limit exceeded",
        )

        response = invitation_http_error(error)

        self.assertEqual(response.status_code, 429)
        self.assertIn("delivery limit", response.detail)

    def test_unauthorized_recipient_has_specific_message(self) -> None:
        error = SupabaseRequestError(
            403,
            "send_invitation",
            "email_address_not_authorized",
            "Email address not authorized",
        )

        response = invitation_http_error(error)

        self.assertEqual(response.status_code, 422)
        self.assertIn("not authorized", response.detail)

    def test_auth_account_conflict_does_not_claim_workspace_access(self) -> None:
        error = SupabaseRequestError(
            422,
            "send_invitation",
            "user_already_exists",
            "User already registered",
        )

        response = invitation_http_error(error)

        self.assertEqual(response.status_code, 409)
        self.assertNotEqual(response.detail, WORKSPACE_DUPLICATE_DETAIL)
        self.assertIn("found no invitation or membership", response.detail)

    def test_already_registered_message_without_code_is_not_a_workspace_duplicate(self) -> None:
        error = SupabaseRequestError(
            400,
            "send_invitation",
            None,
            "A user with this email address has already been registered",
        )

        response = invitation_http_error(error)

        self.assertEqual(response.status_code, 422)
        self.assertNotEqual(response.detail, WORKSPACE_DUPLICATE_DETAIL)

    def test_finalize_failure_is_distinct_from_delivery_failure(self) -> None:
        error = SupabaseRequestError(
            500,
            "finalize_invitation",
            "unexpected_failure",
            "Database error",
        )

        response = invitation_http_error(error)

        self.assertEqual(response.status_code, 502)
        self.assertIn("finalize workspace access", response.detail)


class InvitationEndpointTests(unittest.TestCase):
    def test_no_workspace_record_and_rate_limit_returns_rate_limit(self) -> None:
        gateway = FakeInvitationGateway(
            send_error=SupabaseRequestError(
                429,
                "send_invitation",
                "over_email_send_rate_limit",
                "Email rate limit exceeded",
            )
        )

        with self.assertRaises(HTTPException) as context:
            run_invitation(gateway)

        self.assertEqual(context.exception.status_code, 429)
        self.assertIn("delivery limit", context.exception.detail)
        self.assertNotEqual(context.exception.detail, WORKSPACE_DUPLICATE_DETAIL)
        self.assertEqual(gateway.failed_invitation_ids, ["invitation-id"])

    def test_no_workspace_record_and_restricted_recipient_is_specific(self) -> None:
        gateway = FakeInvitationGateway(
            send_error=SupabaseRequestError(
                403,
                "send_invitation",
                "email_address_not_authorized",
                "Email address not authorized",
            )
        )

        with self.assertRaises(HTTPException) as context:
            run_invitation(gateway)

        self.assertEqual(context.exception.status_code, 422)
        self.assertIn("built-in email service", context.exception.detail)
        self.assertNotEqual(context.exception.detail, WORKSPACE_DUPLICATE_DETAIL)

    def test_unknown_reservation_conflict_is_not_called_a_duplicate(self) -> None:
        gateway = FakeInvitationGateway(
            reserve_error=SupabaseRequestError(
                409,
                "reserve_invitation",
                "conflict",
                "Database conflict",
            )
        )

        with self.assertRaises(HTTPException) as context:
            run_invitation(gateway)

        self.assertEqual(context.exception.status_code, 409)
        self.assertNotEqual(context.exception.detail, WORKSPACE_DUPLICATE_DETAIL)
        self.assertIn("conflict while preparing", context.exception.detail)

    def test_duplicate_message_requires_confirmed_workspace_access(self) -> None:
        gateway = FakeInvitationGateway(workspace_access_exists=True)

        with self.assertRaises(HTTPException) as context:
            run_invitation(gateway)

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail, WORKSPACE_DUPLICATE_DETAIL)
        self.assertEqual(gateway.reserve_calls, 0)


if __name__ == "__main__":
    unittest.main()
