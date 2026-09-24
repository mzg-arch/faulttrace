"""Focused tests for secure self-service company workspace onboarding."""

import asyncio
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import SecretStr, ValidationError
from starlette.requests import Request

from app.routers.onboarding import (
    GENERIC_ACCEPTED_MESSAGE,
    OnboardingRateLimiter,
    WorkspaceOnboardingRequest,
    create_company_workspace,
    onboarding_rate_limiter,
    workspace_slug,
)
from app.settings import Settings
from app.supabase import SupabaseRequestError


def test_settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example_key_1234567890",
        supabase_secret_key=SecretStr("sb_secret_example_key_1234567890"),
        cors_origins="http://localhost:3000",
    )


def test_request(ip: str = "203.0.113.10") -> Request:
    return Request({"type": "http", "client": (ip, 49152), "headers": []})


class FakeOnboardingGateway:
    is_configured = True

    def __init__(
        self,
        *,
        workspace_id: str = "11111111-1111-1111-1111-111111111111",
        invitation_id: str = "22222222-2222-2222-2222-222222222222",
        begin_error: SupabaseRequestError | None = None,
        send_error: SupabaseRequestError | None = None,
    ) -> None:
        self.workspace_id = workspace_id
        self.invitation_id = invitation_id
        self.begin_error = begin_error
        self.send_error = send_error
        self.begin_calls: list[dict[str, str]] = []
        self.send_calls: list[tuple[str, str]] = []
        self.finalize_calls: list[tuple[str, str]] = []
        self.cancel_calls: list[tuple[str, str]] = []

    async def begin_company_workspace_onboarding(self, **values: str) -> dict[str, str]:
        self.begin_calls.append(values)
        if self.begin_error:
            raise self.begin_error
        return {"workspace_id": self.workspace_id, "invitation_id": self.invitation_id}

    async def send_invitation(self, email: str, display_name: str) -> dict[str, str]:
        self.send_calls.append((email, display_name))
        if self.send_error:
            raise self.send_error
        return {"id": "33333333-3333-3333-3333-333333333333"}

    async def finalize_invitation(self, invitation_id: str, auth_user_id: str) -> None:
        self.finalize_calls.append((invitation_id, auth_user_id))

    async def cancel_company_workspace_onboarding(
        self,
        *,
        workspace_id: str,
        invitation_id: str,
    ) -> bool:
        self.cancel_calls.append((workspace_id, invitation_id))
        return True


def run_onboarding(
    gateway: FakeOnboardingGateway,
    *,
    workspace_name: str = "Northstar Manufacturing",
    email: str = "owner@example.com",
    ip: str = "203.0.113.10",
) -> object:
    payload = WorkspaceOnboardingRequest(
        workspace_name=workspace_name,
        administrator_name="  Jordan   Lee  ",
        email=email,
    )
    with patch("app.routers.onboarding.SupabaseGateway", return_value=gateway):
        return asyncio.run(
            create_company_workspace(payload, test_request(ip), test_settings())
        )


class OnboardingValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        onboarding_rate_limiter.reset()

    def test_role_cannot_be_submitted_during_public_onboarding(self) -> None:
        with self.assertRaises(ValidationError):
            WorkspaceOnboardingRequest.model_validate(
                {
                    "workspace_name": "Northstar Manufacturing",
                    "administrator_name": "Jordan Lee",
                    "email": "owner@example.com",
                    "role": "technician",
                }
            )

    def test_normalizes_identity_fields_and_builds_stable_slug(self) -> None:
        payload = WorkspaceOnboardingRequest(
            workspace_name="  Northstar   Manufacturing ",
            administrator_name=" Jordan   Lee ",
            email=" OWNER@Example.COM ",
        )

        self.assertEqual(payload.workspace_name, "Northstar Manufacturing")
        self.assertEqual(payload.administrator_name, "Jordan Lee")
        self.assertEqual(payload.email, "owner@example.com")
        self.assertEqual(
            workspace_slug(payload.workspace_name),
            workspace_slug("northstar manufacturing"),
        )

    def test_rate_limiter_enforces_both_ip_and_email_windows(self) -> None:
        limiter = OnboardingRateLimiter(
            ip_limit=2,
            ip_window_seconds=60,
            email_limit=1,
            email_window_seconds=60,
        )

        self.assertTrue(limiter.allow("203.0.113.1", "one@example.com", now=100))
        self.assertFalse(limiter.allow("203.0.113.2", "one@example.com", now=101))
        self.assertTrue(limiter.allow("203.0.113.1", "two@example.com", now=102))
        self.assertFalse(limiter.allow("203.0.113.1", "three@example.com", now=103))
        self.assertTrue(limiter.allow("203.0.113.1", "three@example.com", now=161))


class OnboardingEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        onboarding_rate_limiter.reset()

    def test_new_workspace_creates_and_finalizes_one_initial_invitation(self) -> None:
        gateway = FakeOnboardingGateway()

        response = run_onboarding(gateway)

        self.assertEqual(response.message, GENERIC_ACCEPTED_MESSAGE)
        self.assertEqual(len(gateway.begin_calls), 1)
        self.assertNotIn("role", gateway.begin_calls[0])
        self.assertEqual(gateway.send_calls, [("owner@example.com", "Jordan Lee")])
        self.assertEqual(
            gateway.finalize_calls,
            [("22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333")],
        )
        self.assertEqual(gateway.cancel_calls, [])

    def test_duplicate_returns_neutral_response_without_sending_email(self) -> None:
        gateway = FakeOnboardingGateway(
            begin_error=SupabaseRequestError(
                409,
                "begin_company_workspace_onboarding",
                "23505",
                "Onboarding request conflicts with existing access",
            )
        )

        response = run_onboarding(gateway)

        self.assertEqual(response.message, GENERIC_ACCEPTED_MESSAGE)
        self.assertEqual(gateway.send_calls, [])

    def test_provider_failure_cleans_up_unfinalized_workspace(self) -> None:
        gateway = FakeOnboardingGateway(
            send_error=SupabaseRequestError(
                503,
                "send_invitation",
                "email_provider_disabled",
                "Email provider unavailable",
            )
        )

        with self.assertRaises(HTTPException) as context:
            run_onboarding(gateway)

        self.assertEqual(context.exception.status_code, 502)
        self.assertEqual(gateway.finalize_calls, [])
        self.assertEqual(
            gateway.cancel_calls,
            [("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222")],
        )

    def test_two_onboardings_keep_their_transaction_ids_isolated(self) -> None:
        first = FakeOnboardingGateway(
            workspace_id="11111111-1111-1111-1111-111111111111",
            invitation_id="22222222-2222-2222-2222-222222222222",
        )
        second = FakeOnboardingGateway(
            workspace_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            invitation_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        )

        run_onboarding(
            first,
            workspace_name="First Company",
            email="first@example.com",
            ip="203.0.113.11",
        )
        run_onboarding(
            second,
            workspace_name="Second Company",
            email="second@example.com",
            ip="203.0.113.12",
        )

        self.assertEqual(first.finalize_calls[0][0], first.invitation_id)
        self.assertEqual(second.finalize_calls[0][0], second.invitation_id)
        self.assertNotEqual(first.begin_calls[0]["workspace_slug"], second.begin_calls[0]["workspace_slug"])

    def test_rate_limited_request_stops_before_backend_writes(self) -> None:
        gateway = FakeOnboardingGateway()
        for index in range(3):
            run_onboarding(gateway, ip=f"203.0.113.{20 + index}")

        with self.assertRaises(HTTPException) as context:
            run_onboarding(gateway, ip="203.0.113.30")

        self.assertEqual(context.exception.status_code, 429)
        self.assertEqual(len(gateway.begin_calls), 3)


class OnboardingMigrationTests(unittest.TestCase):
    def test_migration_fixes_role_to_admin_and_keeps_functions_server_only(self) -> None:
        repository_root = Path(__file__).resolve().parents[3]
        migration = (
            repository_root
            / "supabase"
            / "migrations"
            / "202609240001_company_workspace_onboarding.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("'admin'::public.workspace_role", migration)
        self.assertNotIn("target_role", migration)
        self.assertIn("grant execute on function public.begin_company_workspace_onboarding", migration)
        self.assertIn("to service_role", migration)
        self.assertIn("select 1 from public.workspace_memberships", migration)


if __name__ == "__main__":
    unittest.main()
