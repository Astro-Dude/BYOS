from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AliasCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=128)
    # Exactly one target: a file or a folder.
    file_id: uuid.UUID | None = None
    folder_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _one_target(self) -> AliasCreate:
        if (self.file_id is None) == (self.folder_id is None):
            raise ValueError("provide exactly one of file_id or folder_id")
        return self


class AliasUpdate(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=128)
    file_id: uuid.UUID | None = None
    description: str | None = None


class AliasOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    target_type: str  # "file" | "folder"
    file_id: uuid.UUID | None = None
    folder_id: uuid.UUID | None = None
    description: str | None = None
    created_at: datetime
    # For files: the folder the linked file lives in (null = root) + its name.
    # For folders: the shared folder's own id + name.
    parent_folder_id: uuid.UUID | None = None
    target_name: str | None = None


# ---- Public (unauthenticated) folder browsing ----


class PublicEntry(BaseModel):
    id: uuid.UUID
    name: str
    type: str  # "folder" | "file"
    size: int | None = None
    mime: str | None = None
    ext: str | None = None


class PublicCrumb(BaseModel):
    id: uuid.UUID | None  # null = the shared root
    name: str


class PublicFolderView(BaseModel):
    slug: str
    owner_username: str
    root_name: str
    breadcrumb: list[PublicCrumb]
    folders: list[PublicEntry]
    files: list[PublicEntry]


class PublicMeta(BaseModel):
    type: str  # "file" | "folder"
    name: str
    owner_username: str
