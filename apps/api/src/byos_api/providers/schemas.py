from __future__ import annotations

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
