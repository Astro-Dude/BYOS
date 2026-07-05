from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AliasCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=128)
    file_id: uuid.UUID
    description: str | None = Field(default=None, max_length=255)


class AliasUpdate(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=128)
    file_id: uuid.UUID | None = None
    description: str | None = None


class AliasOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    file_id: uuid.UUID
    description: str | None = None
    created_at: datetime
    folder_id: uuid.UUID | None = None  # where the linked file lives (null = root)
    file_name: str | None = None
