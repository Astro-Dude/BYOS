from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr


class PhoneRequest(BaseModel):
    phone: str


class TicketCodeRequest(BaseModel):
    ticket: str
    code: str


class TicketPasswordRequest(BaseModel):
    ticket: str
    password: str


class TelegramLoginResult(BaseModel):
    status: str  # "code_sent" | "password_needed" | "connected"
    ticket: str | None = None
    access_token: str | None = None
    token_type: str | None = None
    expires_in: int | None = None  # seconds


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str | None = None
    email: EmailStr | None = None
    is_verified: bool
