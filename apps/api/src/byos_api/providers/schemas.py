from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ConnectRequest(BaseModel):
    phone: str


class CodeRequest(BaseModel):
    code: str


class PasswordRequest(BaseModel):
    password: str


class ConnectResult(BaseModel):
    status: str  # "code_sent" | "password_needed" | "connected"


class ProviderStatus(BaseModel):
    provider: str
    status: str
    label: str | None = None


# ── Storage accounts (any provider) ──────────────────────────────────────────
import uuid  # noqa: E402

from pydantic import Field, field_validator  # noqa: E402


class StorageAccountOut(BaseModel):
    """A connected storage, with what's on it. Never carries credentials."""

    id: uuid.UUID
    provider: str
    label: str | None = None
    status: str
    is_default: bool
    files: int = 0
    bytes: int = 0
    # GitHub
    repo_url: str | None = None
    # When the token stops working; None if it never expires (or isn't known).
    token_expires_at: datetime | None = None
    private: bool | None = None
    # S3
    bucket: str | None = None
    endpoint: str | None = None
    region: str | None = None
    prefix: str | None = None


class GitHubConnect(BaseModel):
    token: str = Field(min_length=10, max_length=255)
    # GitHub's own rule for repository names.
    repo: str = Field(default="byos-storage", pattern=r"^[A-Za-z0-9._-]{1,100}$")
    private: bool = True


class S3Connect(BaseModel):
    endpoint: str | None = Field(default=None, max_length=300)
    region: str | None = Field(default=None, max_length=64)
    bucket: str = Field(min_length=3, max_length=63)
    prefix: str | None = Field(default=None, max_length=200)
    access_key_id: str = Field(min_length=3, max_length=200)
    secret_access_key: str = Field(min_length=3, max_length=200)

    @field_validator("endpoint")
    @classmethod
    def _endpoint_url(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if not value:
            return None
        if not value.startswith(("https://", "http://")):
            raise ValueError("The endpoint must be a full URL, like https://s3.example.com")
        return value.rstrip("/")


class StorageAccountUpdate(BaseModel):
    is_default: bool | None = None
    # GitHub only: make the repository private or public.
    private: bool | None = None
