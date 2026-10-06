from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class Totals(BaseModel):
    users: int
    files: int
    folders: int
    bytes: int
    aliases: int
    shares: int
    api_keys: int
    webhooks: int
    ai_keys: int
    conversations: int
    indexed_chunks: int


class DayPoint(BaseModel):
    day: str
    value: int


class HourPoint(BaseModel):
    hour: int
    value: int


class TypeSlice(BaseModel):
    ext: str
    count: int
    bytes: int = 0


class SizeBucket(BaseModel):
    bucket: str
    count: int


class ActionCount(BaseModel):
    action: str
    count: int


class UserRow(BaseModel):
    label: str
    bytes: int
    files: int


class ValueRow(BaseModel):
    label: str
    count: int
    bytes: int = 0


class VersionStats(BaseModel):
    total: int
    versioned_files: int
    revisions: int


class DuplicateStats(BaseModel):
    groups: int
    reclaimable_bytes: int


class IndexCoverage(BaseModel):
    indexed: int
    files: int


class Engagement(BaseModel):
    """Distinct people active (an audited action or a chat with Bao) in the last
    day, week and month."""

    dau: int
    wau: int
    mau: int


class FunnelStep(BaseModel):
    label: str
    count: int


class ChangeOutcomes(BaseModel):
    """Every change in an applied plan: worked, failed, or later undone."""

    ok: int
    failed: int
    undone: int


class ModelRow(BaseModel):
    label: str
    count: int
    provider: str


class AssistantStats(BaseModel):
    questions: list[DayPoint]
    plans_applied: list[DayPoint]
    plans_by_status: list[ValueRow]
    changes: ChangeOutcomes
    change_kinds: list[ValueRow]
    providers: list[ValueRow]
    models: list[ModelRow]


class AdminRow(BaseModel):
    """One entry in the admin list."""

    id: uuid.UUID
    username: str | None = None
    phone: str | None = None
    #: Has the database flag.
    granted: bool
    #: Named by ADMIN_IDS — cannot be revoked in-app, by design.
    bootstrap: bool


class GrantRequest(BaseModel):
    #: Username or phone. Phones match digits-only by suffix.
    identifier: str = Field(min_length=1, max_length=120)


class PlatformStats(BaseModel):
    """Platform-wide analytics. Admin only — see admin.service.is_admin."""

    generated_at: datetime
    window_days: int
    totals: Totals
    signups: list[DayPoint]
    uploads: list[DayPoint]
    types: list[TypeSlice]
    sizes: list[SizeBucket]
    hours: list[HourPoint]
    actions: list[ActionCount]
    top_users: list[UserRow]
    growth: list[DayPoint]
    active: list[DayPoint]
    providers: list[ValueRow]
    # Connected storage accounts per provider (count), across all users.
    storage_accounts: list[ValueRow] = []
    versions: VersionStats
    shares_by_kind: list[ValueRow]
    aliases_by_kind: list[ValueRow]
    duplicates: DuplicateStats
    index_coverage: IndexCoverage
    tags: list[ValueRow]
    engagement: Engagement
    funnel: list[FunnelStep]
    assistant: AssistantStats
    # Storage connections by state ("connected", "expired", …), every provider.
    storage_status: list[ValueRow] = []
