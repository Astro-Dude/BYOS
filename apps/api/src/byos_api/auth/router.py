from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import FloodWaitError
from telethon.errors.rpcerrorlist import (
    PhoneNumberBannedError,
    PhoneNumberFloodError,
    PhoneNumberInvalidError,
)

from byos_api.audit import recorder as audit
from byos_api.auth import service, telegram
from byos_api.auth.dependencies import CurrentUser, SessionUser
from byos_api.auth.schemas import (
    PasswordLoginRequest,
    PhoneRequest,
    SetPasswordRequest,
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

logger = logging.getLogger("byos")
_settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


def _telegram_unavailable(op: str, exc: Exception) -> HTTPException:
    """Log the real error and return a clean, retryable message instead of a 500
    for any non-FloodWait Telegram/connection failure."""
    logger.error("telegram %s failed: %s", op, type(exc).__name__, exc_info=True)
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY,
        "Telegram is having trouble right now — please try again in a moment.",
    )

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Throttle the login flow per IP to blunt brute-force / code-guessing.
_auth_limit = limit("auth", _settings.auth_rate_limit, _settings.auth_rate_window)


def _set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        key=_settings.refresh_cookie_name,
        value=raw,
        httponly=True,
        secure=_settings.refresh_cookie_secure,
        samesite=_settings.refresh_cookie_samesite,
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
    except PhoneNumberInvalidError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That phone number looks invalid. Use full international format, "
            "e.g. +919812345678 (country code, no spaces or leading zeros).",
        ) from None
    except PhoneNumberBannedError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Telegram has banned this phone number."
        ) from None
    except PhoneNumberFloodError:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many code requests for this number — wait a while before trying again.",
        ) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    except Exception as exc:
        raise _telegram_unavailable("start", exc) from exc
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
    except Exception as exc:
        raise _telegram_unavailable("verify", exc) from exc
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
    except Exception as exc:
        raise _telegram_unavailable("password", exc) from exc
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
    response.delete_cookie(
        _settings.refresh_cookie_name,
        path="/",
        samesite=_settings.refresh_cookie_samesite,
        secure=_settings.refresh_cookie_secure,
    )


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
    return UserResponse.model_validate(updated)


@router.post("/password", response_model=UserResponse)
async def set_password(
    payload: SetPasswordRequest, user: SessionUser, db: DbDep
) -> UserResponse:
    """Set or change the account password. Requires an interactive login."""
    try:
        updated = await service.set_password(
            db, user, payload.password, payload.current_password
        )
    except service.InvalidCurrentPassword:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Current password is incorrect"
        ) from None
    return UserResponse.model_validate(updated)


@router.post(
    "/login/password", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def login_password(
    payload: PasswordLoginRequest, request: Request, response: Response, db: DbDep
) -> TelegramLoginResult:
    """Log in with username-or-phone + password (skips Telegram OTP)."""
    user = await service.authenticate_password(db, payload.identifier, payload.password)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid credentials"
        )
    return await _issue_session(db, user, response, request)
