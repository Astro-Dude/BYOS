from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: uuid.UUID | None = None
    color: str | None = None  # hex "#RRGGBB" from the palette, or null


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    color: str | None = None  # hex "#RRGGBB" or null to clear


class FolderMove(BaseModel):
    parent_id: uuid.UUID | None = None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None = None
    color: str | None = None
    created_at: datetime


class BreadcrumbItem(BaseModel):
    id: uuid.UUID
    name: str
