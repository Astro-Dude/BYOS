from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db
from byos_api.providers import service
from byos_api.providers.schemas import ProviderStatus

# Connecting Telegram now happens at login (see /auth/telegram/*). This router
# just reports connected providers and allows disconnecting.
router = APIRouter(prefix="/providers", tags=["providers"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[ProviderStatus])
async def list_providers(user: CurrentUser, db: DbDep) -> list[ProviderStatus]:
    accounts = await service.list_accounts(db, user)
    return [ProviderStatus(provider=a.provider, status=a.status, label=a.label) for a in accounts]


@router.delete("/telegram", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(user: CurrentUser, db: DbDep) -> None:
    await service.disconnect(db, user)
