"""Backend-only configuration loaded from environment variables or local files."""

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class BackendConfigurationError(RuntimeError):
    """Backend configuration is missing or unsafe; values are never included."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            Path(__file__).resolve().parents[1] / ".env",
            Path(__file__).resolve().parents[1] / ".env.local",
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: SecretStr = SecretStr("")
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = "gemini-3.8-flash"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def invite_redirect_url(self) -> str:
        """Use the first configured web origin; clients cannot choose a redirect."""
        return f"{self.allowed_origins[0].rstrip('/')}/auth/confirm" if self.allowed_origins else ""

    @property
    def gemini_is_configured(self) -> bool:
        return bool(
            self.gemini_api_key.get_secret_value().strip()
            and self.gemini_model.strip()
        )

    def validate_backend(self) -> None:
        """Fail startup with variable names only, never configuration values."""
        problems: list[str] = []
        supabase_url = self.supabase_url.strip()
        publishable_key = self.supabase_publishable_key.strip()
        secret_key = self.supabase_secret_key.get_secret_value().strip()

        parsed_url = urlparse(supabase_url)
        if not supabase_url:
            problems.append("SUPABASE_URL is missing")
        elif parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            problems.append("SUPABASE_URL must be an absolute HTTP(S) URL")
        elif parsed_url.username or parsed_url.password:
            problems.append("SUPABASE_URL must not contain credentials")

        if not publishable_key:
            problems.append("SUPABASE_PUBLISHABLE_KEY is missing")
        elif publishable_key.startswith("sb_secret_"):
            problems.append("SUPABASE_PUBLISHABLE_KEY contains a secret key")
        elif len(publishable_key) < 20:
            problems.append("SUPABASE_PUBLISHABLE_KEY has an invalid format")

        if not secret_key:
            problems.append("SUPABASE_SECRET_KEY is missing")
        elif secret_key.startswith("sb_publishable_"):
            problems.append("SUPABASE_SECRET_KEY contains a publishable key")
        elif len(secret_key) < 20:
            problems.append("SUPABASE_SECRET_KEY has an invalid format")

        if not self.allowed_origins:
            problems.append("CORS_ORIGINS must include the FaultTrace web origin")
        else:
            for origin in self.allowed_origins:
                parsed_origin = urlparse(origin)
                if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc:
                    problems.append("CORS_ORIGINS contains an invalid origin")
                    break

        if problems:
            raise BackendConfigurationError("Invalid backend configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
