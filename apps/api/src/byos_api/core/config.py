"""Application settings, loaded from environment (and an optional .env)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    environment: str = "development"

    # Data stores
    database_url: str = "postgresql+asyncpg://byos:byos@localhost:5432/byos"
    redis_url: str = "redis://localhost:6379/0"

    # App auth (JWT)
    jwt_secret_key: str = "change-me-dev-only"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    refresh_cookie_name: str = "byos_refresh"
    refresh_cookie_secure: bool = False

    # Provider-credential encryption (Fernet key)
    byos_encryption_key: str = ""

    # Telegram (Phase 2)
    telegram_api_id: int | None = None
    telegram_api_hash: str | None = None

    # CORS
    cors_origins: str = "http://localhost:3000"

    # Security / upload validation. Defaults are permissive (this is your own
    # storage); tighten via env for shared or hardened deployments.
    max_upload_bytes: int = 5 * 1024 * 1024 * 1024  # 5 GiB
    blocked_extensions: str = ""  # comma-separated, e.g. "exe,bat,scr" (empty = allow all)
    # Rate limits (requests per window, seconds). Fail open if Redis is down.
    auth_rate_limit: int = 20
    auth_rate_window: int = 60
    public_rate_limit: int = 120
    public_rate_window: int = 60

    # AI: heuristic auto-tagging of uploads by type (Phase 15).
    auto_tagging: bool = True

    @property
    def blocked_extensions_set(self) -> set[str]:
        return {
            e.strip().lower().lstrip(".")
            for e in self.blocked_extensions.split(",")
            if e.strip()
        }

    @field_validator("telegram_api_id", "telegram_api_hash", mode="before")
    @classmethod
    def _blank_to_none(cls, value: object) -> object:
        """Treat empty env vars (e.g. `TELEGRAM_API_ID=`) as unset rather than
        failing validation."""
        if isinstance(value, str) and value.strip() == "":
            return None
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
