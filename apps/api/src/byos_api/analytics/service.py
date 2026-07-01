"""Read-side rollups over analytics_events.

Aggregates are computed on-read with grouped SQL — fast at this scale thanks to
the ``(owner_id, created_at)`` / ``(owner_id, event_type)`` indexes. If volume
ever outgrows this, Phase 13 can precompute daily rollups with an arq worker;
the query surface here stays the same.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.analytics.schemas import AnalyticsOverview, DayPoint, TopItem
from byos_api.db.models import Alias, AnalyticsEvent, File, Share, User


async def overview(db: AsyncSession, user: User) -> AnalyticsOverview:
    since = datetime.now(UTC) - timedelta(days=30)

    counts = await db.execute(
        select(
            func.coalesce(func.sum(File.size), 0),
            func.count(File.id.distinct()),
        ).where(File.owner_id == user.id)
    )
    storage_bytes_raw, file_count = counts.one()
    storage_bytes = int(storage_bytes_raw or 0)

    alias_count = (
        await db.execute(
            select(func.count()).select_from(Alias).where(Alias.owner_id == user.id)
        )
    ).scalar_one()
    share_count = (
        await db.execute(
            select(func.count()).select_from(Share).where(Share.owner_id == user.id)
        )
    ).scalar_one()

    tally = (
        await db.execute(
            select(
                AnalyticsEvent.event_type,
                func.count().label("all_time"),
                func.count().filter(AnalyticsEvent.created_at >= since).label("recent"),
            )
            .where(AnalyticsEvent.owner_id == user.id)
            .group_by(AnalyticsEvent.event_type)
        )
    ).all()
    by_type = {row.event_type: (int(row.all_time), int(row.recent)) for row in tally}
    views = by_type.get("view", (0, 0))
    downloads = by_type.get("download", (0, 0))

    return AnalyticsOverview(
        storage_bytes=storage_bytes,
        file_count=int(file_count),
        alias_count=int(alias_count),
        share_count=int(share_count),
        views_total=views[0],
        views_30d=views[1],
        downloads_total=downloads[0],
        downloads_30d=downloads[1],
    )


async def timeseries(db: AsyncSession, user: User, days: int) -> list[DayPoint]:
    since = datetime.now(UTC) - timedelta(days=days)
    day = func.date_trunc("day", AnalyticsEvent.created_at).label("day")
    rows = (
        await db.execute(
            select(
                day,
                func.count().filter(AnalyticsEvent.event_type == "view").label("views"),
                func.count().filter(AnalyticsEvent.event_type == "download").label("downloads"),
            )
            .where(AnalyticsEvent.owner_id == user.id, AnalyticsEvent.created_at >= since)
            .group_by(day)
            .order_by(day)
        )
    ).all()
    return [
        DayPoint(day=row.day.date().isoformat(), views=int(row.views), downloads=int(row.downloads))
        for row in rows
    ]


async def _label(db: AsyncSession, target_type: str, target_id: uuid.UUID) -> str:
    if target_type == "file":
        record = await db.get(File, target_id)
        return record.name if record else "(deleted file)"
    if target_type == "alias":
        alias = await db.get(Alias, target_id)
        return f"/a/{alias.slug}" if alias else "(deleted alias)"
    if target_type == "share":
        share = await db.get(Share, target_id)
        return f"/s/{share.token}" if share else "(revoked share)"
    return "unknown"


async def top_content(db: AsyncSession, user: User, limit: int) -> list[TopItem]:
    hits = func.count().label("hits")
    rows = (
        await db.execute(
            select(AnalyticsEvent.target_type, AnalyticsEvent.target_id, hits)
            .where(AnalyticsEvent.owner_id == user.id)
            .group_by(AnalyticsEvent.target_type, AnalyticsEvent.target_id)
            .order_by(hits.desc())
            .limit(limit)
        )
    ).all()
    return [
        TopItem(
            target_type=row.target_type,
            target_id=str(row.target_id),
            label=await _label(db, row.target_type, row.target_id),
            hits=int(row.hits),
        )
        for row in rows
    ]
