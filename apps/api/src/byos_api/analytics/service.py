"""Account overview: storage used and object counts.

Event-based analytics (views/downloads) were removed — download tracking can't
be made meaningful (a preview hits the same endpoint as a download, and the
download-file flow bypasses it entirely). Only the cheap, accurate rollups the
sidebar needs remain.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.analytics.schemas import AnalyticsOverview
from byos_api.db.models import Alias, File, User


async def overview(db: AsyncSession, user: User) -> AnalyticsOverview:
    owner = user.id
    bytes_sq = (
        select(func.coalesce(func.sum(File.size), 0))
        .where(File.owner_id == owner)
        .scalar_subquery()
    )
    files_sq = (
        select(func.count()).select_from(File).where(File.owner_id == owner).scalar_subquery()
    )
    aliases_sq = (
        select(func.count()).select_from(Alias).where(Alias.owner_id == owner).scalar_subquery()
    )
    row = (await db.execute(select(bytes_sq, files_sq, aliases_sq))).one()
    return AnalyticsOverview(
        storage_bytes=int(row[0] or 0),
        file_count=int(row[1]),
        alias_count=int(row[2]),
    )
