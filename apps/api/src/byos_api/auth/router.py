from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import FloodWaitError

from byos_api.audit import recorder as audit
from byos_api.auth import service, telegram
from byos_api.auth.dependencies import CurrentUser, invalidate_user
from byos_api.auth.schemas import (
    PhoneRequest,
    TelegramLoginResult,
    TicketCodeRequest,
    TicketPasswordRequest,
    TokenResponse,
    UsernameRequest,
    UserResponse,
)
from byos_api.core.config import get_settings
from byos_api.core.db import get_db
from byos_api.core.ratelimit import limit
from byos_api.core.security import create_access_token
from byos_api.db.models import User

_settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Throttle the login flow per IP to blunt brute-force / code-guessing.
_auth_limit = limit("auth", _settings.auth_rate_limit, _settings.auth_rate_window)


def _set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        key=_settings.refresh_cookie_name,
        value=raw,
        httponly=True,
        secure=_settings.refresh_cookie_secure,
        samesite="lax",
        max_age=_settings.refresh_token_expire_days * 24 * 3600,
        path="/",
    )


def _access_response(user_id: str) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user_id),
        expires_in=_settings.access_token_expire_minutes * 60,
    )


async def _issue_session(
    db: AsyncSession, user: User, response: Response, request: Request
) -> TelegramLoginResult:
    raw = await service.issue_refresh_token(db, user)
    _set_refresh_cookie(response, raw)
    await audit.record(user.id, "login", request=request)
    return TelegramLoginResult(
        status="connected",
        access_token=create_access_token(str(user.id)),
        token_type="bearer",
        expires_in=_settings.access_token_expire_minutes * 60,
    )


def _flood(exc: FloodWaitError) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS, f"Telegram rate limit — retry in {exc.seconds}s"
    )


@router.post(
    "/telegram/start", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def telegram_start(payload: PhoneRequest, db: DbDep) -> TelegramLoginResult:
    try:
        ticket = await telegram.start_login(payload.phone)
    except telegram.TelegramNotConfigured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Telegram login is not configured"
        ) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    return TelegramLoginResult(status="code_sent", ticket=ticket)


@router.post(
    "/telegram/verify", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def telegram_verify(
    payload: TicketCodeRequest, request: Request, response: Response, db: DbDep
) -> TelegramLoginResult:
    try:
        result, ticket, user = await telegram.verify_code(db, payload.ticket, payload.code)
    except (telegram.ExpiredTicket, telegram.LoginStateError):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Login session expired — start again"
        ) from None
    except telegram.InvalidCode as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    if result == "password_needed":
        return TelegramLoginResult(status="password_needed", ticket=ticket)
    assert user is not None
    return await _issue_session(db, user, response, request)


@router.post(
    "/telegram/password", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def telegram_password(
    payload: TicketPasswordRequest, request: Request, response: Response, db: DbDep
) -> TelegramLoginResult:
    try:
        _, _, user = await telegram.verify_password(db, payload.ticket, payload.password)
    except (telegram.ExpiredTicket, telegram.LoginStateError):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Login session expired — start again"
        ) from None
    except telegram.InvalidCode as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    assert user is not None
    return await _issue_session(db, user, response, request)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: DbDep) -> TokenResponse:
    raw = request.cookies.get(_settings.refresh_cookie_name)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    try:
        user, new_raw = await service.rotate_refresh_token(db, raw)
    except service.InvalidRefreshToken:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from None
    _set_refresh_cookie(response, new_raw)
    return _access_response(str(user.id))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: DbDep) -> None:
    raw = request.cookies.get(_settings.refresh_cookie_name)
    if raw:
        await service.revoke_refresh_token(db, raw)
    response.delete_cookie(_settings.refresh_cookie_name, path="/")


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(user)


@router.post("/username", response_model=UserResponse)
async def set_username(payload: UsernameRequest, user: CurrentUser, db: DbDep) -> UserResponse:
    try:
        updated = await service.set_username(db, user, payload.username)
    except service.InvalidUsername:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "3–30 chars: letters, numbers, - or _, starting with a letter/number; not reserved",
        ) from None
    except service.UsernameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken") from None
    await invalidate_user(user.id)
    return UserResponse.model_validate(updated)
