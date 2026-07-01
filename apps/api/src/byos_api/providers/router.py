from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import FloodWaitError

from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db
from byos_api.providers import service
from byos_api.providers.schemas import (
    CodeRequest,
    ConnectRequest,
    ConnectResult,
    PasswordRequest,
    ProviderStatus,
)

router = APIRouter(prefix="/providers", tags=["providers"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


def _flood(exc: FloodWaitError) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Telegram rate limit — retry in {exc.seconds}s",
    )


@router.get("", response_model=list[ProviderStatus])
async def list_providers(user: CurrentUser, db: DbDep) -> list[ProviderStatus]:
    accounts = await service.list_accounts(db, user)
    return [
        ProviderStatus(provider=a.provider, status=a.status, label=a.label) for a in accounts
    ]


@router.post("/telegram/connect", response_model=ConnectResult)
async def connect(payload: ConnectRequest, user: CurrentUser, db: DbDep) -> ConnectResult:
    try:
        result = await service.start_login(db, user, payload.phone)
    except service.TelegramNotConfigured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Telegram is not configured"
        ) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    return ConnectResult(status=result)


@router.post("/telegram/verify", response_model=ConnectResult)
async def verify(payload: CodeRequest, user: CurrentUser, db: DbDep) -> ConnectResult:
    try:
        result = await service.verify_code(db, user, payload.code)
    except service.NoPendingLogin:
        raise HTTPException(status.HTTP_409_CONFLICT, "No pending Telegram login") from None
    except service.InvalidLoginCode as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    return ConnectResult(status=result)


@router.post("/telegram/password", response_model=ConnectResult)
async def verify_password(
    payload: PasswordRequest, user: CurrentUser, db: DbDep
) -> ConnectResult:
    try:
        result = await service.verify_password(db, user, payload.password)
    except service.NoPendingLogin:
        raise HTTPException(status.HTTP_409_CONFLICT, "No pending Telegram login") from None
    except service.InvalidLoginCode as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    return ConnectResult(status=result)


@router.delete("/telegram", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(user: CurrentUser, db: DbDep) -> None:
    await service.disconnect(db, user)
