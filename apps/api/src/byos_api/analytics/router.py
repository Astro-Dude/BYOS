from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.analytics import service
from byos_api.analytics.schemas import AnalyticsOverview, DayPoint, TopItem
from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/overview", response_model=AnalyticsOverview)
async def get_overview(user: CurrentUser, db: DbDep) -> AnalyticsOverview:
    return await service.overview(db, user)


@router.get("/timeseries", response_model=list[DayPoint])
async def get_timeseries(
    user: CurrentUser,
    db: DbDep,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> list[DayPoint]:
    return await service.timeseries(db, user, days)


@router.get("/top", response_model=list[TopItem])
async def get_top(
    user: CurrentUser,
    db: DbDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 8,
) -> list[TopItem]:
    return await service.top_content(db, user, limit)
