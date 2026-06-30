"""Application settings, loaded from environment (and an optional .env)."""

from __future__ import annotations

from functools import lru_cache

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

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
