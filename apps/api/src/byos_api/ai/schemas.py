from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AiConfigOut(BaseModel):
    """BYOM config as returned to the client — never includes the API key."""

    configured: bool
    base_url: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None


class AiConfigIn(BaseModel):
    base_url: str = Field(min_length=1, max_length=500)
    model: str = Field(min_length=1, max_length=200)
    # Required on first setup; omit on later edits to keep the stored key.
    api_key: str | None = Field(default=None, max_length=500)
    system_prompt: str | None = Field(default=None, max_length=8000)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=32000)
    top_p: float | None = Field(default=None, ge=0, le=1)


class SummarizeRequest(BaseModel):
    file_id: uuid.UUID


class ChatSendRequest(BaseModel):
    file_id: uuid.UUID
    message: str = Field(min_length=1, max_length=16000)


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    created_at: datetime
