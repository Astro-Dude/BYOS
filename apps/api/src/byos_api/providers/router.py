from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.auth.dependencies import CurrentUser, get_session_user
from byos_api.core.db import get_db
from byos_api.providers import service
from byos_api.providers.schemas import ProviderStatus

# Connecting Telegram now happens at login (see /auth/telegram/*). This router
# just reports connected providers and allows disconnecting.
router = APIRouter(
    prefix="/providers", tags=["providers"], dependencies=[Depends(get_session_user)]
)

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=list[ProviderStatus])
async def list_providers(user: CurrentUser, db: DbDep) -> list[ProviderStatus]:
    accounts = await service.list_accounts(db, user)
    return [ProviderStatus(provider=a.provider, status=a.status, label=a.label) for a in accounts]


@router.get("/telegram/session")
async def telegram_session_status(user: CurrentUser, db: DbDep) -> dict[str, bool]:
    """Lightweight liveness probe used on app load: reports whether the stored
    Telegram session was revoked (e.g. the user terminated their sessions) and
    the account needs re-auth. A user who never connected storage is NOT flagged
    — that's a separate "connect storage" state, not a terminated session."""
    account = await service.get_telegram_account(db, user)
    if account is None:
        return {"connected": False, "needs_reauth": False}
    alive = await service.telegram_session_alive(db, user)
    return {"connected": True, "needs_reauth": not alive}


@router.delete("/telegram", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(user: CurrentUser, db: DbDep) -> None:
    await service.disconnect(db, user)
