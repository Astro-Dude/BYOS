from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.audit.schemas import AuditOut
from byos_api.auth.dependencies import CurrentUser, get_session_user
from byos_api.core.db import get_db
from byos_api.db.models import AuditLog

router = APIRouter(
    prefix="/audit", tags=["audit"], dependencies=[Depends(get_session_user)]
)

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[AuditOut])
async def list_activity(
    user: CurrentUser,
    db: DbDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AuditOut]:
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.user_id == user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [AuditOut.model_validate(entry) for entry in result.scalars()]
