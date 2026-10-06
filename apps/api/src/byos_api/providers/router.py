from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.auth.dependencies import CurrentUser, get_session_user
from byos_api.core.db import get_db
from byos_api.db.models import StorageAccount
from byos_api.providers import accounts, service
from byos_api.providers.schemas import (
    GitHubConnect,
    ProviderStatus,
    S3Connect,
    StorageAccountOut,
    StorageAccountUpdate,
)

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


# ── Storage accounts: every provider ─────────────────────────────────────────
def _out(account: StorageAccount, used: dict[uuid.UUID, tuple[int, int]]) -> StorageAccountOut:
    cfg = account.config or {}
    files, size = used.get(account.id, (0, 0))
    return StorageAccountOut(
        id=account.id,
        provider=account.provider,
        label=account.label,
        status=accounts.status(account),
        is_default=accounts.is_default(account),
        token_expires_at=accounts.token_expires_at(account),
        files=files,
        bytes=size,
        repo_url=cfg.get("url"),
        private=cfg.get("private") if account.provider == "github" else None,
        bucket=cfg.get("bucket"),
        endpoint=cfg.get("endpoint"),
        region=cfg.get("region"),
        prefix=cfg.get("prefix"),
    )


async def _all(db: AsyncSession, user: CurrentUser) -> list[StorageAccountOut]:
    used = await accounts.usage(db, user)
    found = await accounts.list_accounts(db, user)
    default = await accounts.default_account(db, user)
    out = [_out(a, used) for a in found]
    # "Default" is where uploads really go: the marked one while it works, else
    # whichever took over (it gets the mark back once it's reconnected).
    for o in out:
        o.is_default = default is not None and o.id == default.id
    return out


@router.get("/accounts", response_model=list[StorageAccountOut])
async def list_storage(user: CurrentUser, db: DbDep) -> list[StorageAccountOut]:
    return await _all(db, user)


@router.post("/github", response_model=list[StorageAccountOut])
async def connect_github(
    payload: GitHubConnect, user: CurrentUser, db: DbDep
) -> list[StorageAccountOut]:
    await accounts.connect_github(
        db, user, token=payload.token, repo=payload.repo, private=payload.private
    )
    return await _all(db, user)


@router.post("/s3", response_model=list[StorageAccountOut])
async def connect_s3(payload: S3Connect, user: CurrentUser, db: DbDep) -> list[StorageAccountOut]:
    await accounts.connect_s3(
        db,
        user,
        endpoint=payload.endpoint,
        region=payload.region,
        bucket=payload.bucket,
        prefix=payload.prefix,
        access_key_id=payload.access_key_id,
        secret_access_key=payload.secret_access_key,
    )
    return await _all(db, user)


@router.patch("/accounts/{account_id}", response_model=list[StorageAccountOut])
async def update_storage(
    account_id: uuid.UUID, payload: StorageAccountUpdate, user: CurrentUser, db: DbDep
) -> list[StorageAccountOut]:
    try:
        if payload.is_default:
            await accounts.set_default(db, user, account_id)
        if payload.private is not None:
            await accounts.set_github_private(db, user, account_id, payload.private)
    except accounts.AccountNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Storage not found") from None
    return await _all(db, user)


@router.delete("/accounts/{account_id}", response_model=list[StorageAccountOut])
async def disconnect_storage(
    account_id: uuid.UUID, user: CurrentUser, db: DbDep
) -> list[StorageAccountOut]:
    try:
        await accounts.disconnect(db, user, account_id)
    except accounts.AccountNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Storage not found") from None
    return await _all(db, user)
