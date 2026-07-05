from __future__ import annotations

from pydantic import BaseModel


class AnalyticsOverview(BaseModel):
    storage_bytes: int
    file_count: int
    alias_count: int
