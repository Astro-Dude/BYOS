from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    ext: str | None = None
    mime: str | None = None
    size: int
    provider: str
    folder_id: uuid.UUID | None = None
    is_favorite: bool = False
    tags: list[str] = []
    created_at: datetime
    modified_at: datetime

    @field_validator("tags", mode="before")
    @classmethod
    def _tag_names(cls, value: Any) -> list[str]:
        if not value:
            return []
        return [getattr(t, "name", t) for t in value]  # ORM Tag objects → names


class VersionOut(BaseModel):
    id: uuid.UUID
    version_no: int
    size: int
    hash: str | None = None
    created_at: datetime
    is_current: bool = False


class DuplicateGroup(BaseModel):
    hash: str
    files: list[FileOut]


class RenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class MoveRequest(BaseModel):
    folder_id: uuid.UUID | None = None  # null = move to root


class FavoriteRequest(BaseModel):
    favorite: bool


class TagRequest(BaseModel):
    name: str
