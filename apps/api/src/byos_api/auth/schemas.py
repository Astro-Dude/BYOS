from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class PhoneRequest(BaseModel):
    phone: str


class UsernameRequest(BaseModel):
    username: str


class DisplayNameRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Display name cannot be empty")
        return stripped


class SetPasswordRequest(BaseModel):
    # Required only when changing an existing password (verifies ownership).
    current_password: str | None = None
    password: str = Field(min_length=8, max_length=128)


class PasswordLoginRequest(BaseModel):
    identifier: str = Field(min_length=1)  # username or phone
    password: str = Field(min_length=1)


class SignupStartRequest(BaseModel):
    phone: str = Field(min_length=1)
    username: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=128)


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
    username: str | None = None
    display_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    is_verified: bool
    has_password: bool = False
