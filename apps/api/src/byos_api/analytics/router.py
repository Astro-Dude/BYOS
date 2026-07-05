from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.analytics import service
from byos_api.analytics.schemas import AnalyticsOverview
from byos_api.auth.dependencies import CurrentUser
from byos_api.core.cache import cached_json
from byos_api.core.db import get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

_OVERVIEW_TTL = 30  # seconds; tolerate brief staleness


@router.get("/overview", response_model=AnalyticsOverview)
async def get_overview(user: CurrentUser, db: DbDep) -> AnalyticsOverview:
    async def produce() -> dict[str, int]:
        return (await service.overview(db, user)).model_dump(mode="json")

    data = await cached_json(f"analytics:overview:{user.id}", _OVERVIEW_TTL, produce)
    return AnalyticsOverview(**data)
