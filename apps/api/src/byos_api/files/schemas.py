from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    ext: str | None = None
    mime: str | None = None
    size: int
    provider: str
    folder_id: uuid.UUID | None = None
    created_at: datetime
    modified_at: datetime
