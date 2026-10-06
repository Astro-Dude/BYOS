from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ShareCreate(BaseModel):
    file_id: uuid.UUID
    expires_in_days: int | None = Field(default=None, ge=1, le=365)


class ShareOut(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    token: str
    expires_at: datetime | None = None
    download_count: int
    created_at: datetime
