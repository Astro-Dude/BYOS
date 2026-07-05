from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ShareCreate(BaseModel):
    file_id: uuid.UUID
    password: str | None = Field(default=None, max_length=128)
    expires_in_days: int | None = Field(default=None, ge=1, le=365)
    max_downloads: int | None = Field(default=None, ge=1)
    view_only: bool = False


class ShareOut(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    token: str
    visibility: str
    has_password: bool
    expires_at: datetime | None = None
    max_downloads: int | None = None
    download_count: int
    view_only: bool
    created_at: datetime


class ShareInfo(BaseModel):
    """Public metadata for a share, used by the viewer page to decide how to
    render and whether to offer a download. No content, no ownership info."""

    file_name: str
    mime: str | None = None
    size: int
    view_only: bool
    has_password: bool
    expired: bool
    limit_reached: bool
