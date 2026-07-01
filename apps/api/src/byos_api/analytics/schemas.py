from __future__ import annotations

from pydantic import BaseModel


class AnalyticsOverview(BaseModel):
    storage_bytes: int
    file_count: int
    alias_count: int
    share_count: int
    views_total: int
    views_30d: int
    downloads_total: int
    downloads_30d: int


class DayPoint(BaseModel):
    day: str  # ISO date (YYYY-MM-DD)
    views: int
    downloads: int


class TopItem(BaseModel):
    target_type: str  # file | alias | share
    target_id: str
    label: str
    hits: int
