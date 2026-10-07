from __future__ import annotations

import logging
from collections.abc import Awaitable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import FloodWaitError
from telethon.errors.rpcerrorlist import (
    PhoneNumberBannedError,
    PhoneNumberFloodError,
    PhoneNumberInvalidError,
)

from byos_api.admin import service as admin_service
from byos_api.audit import recorder as audit
from byos_api.auth import service, telegram
from byos_api.auth.dependencies import CurrentUser, SessionUser
from byos_api.auth.schemas import (
    DisplayNameRequest,
    PasswordLoginRequest,
    PasswordResetStartRequest,
    PhoneRequest,
    SetPasswordRequest,
    SignupStartRequest,
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
from byos_api.providers import service as providers_service

logger = logging.getLogger("byos")
_settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


def _telegram_unavailable(op: str, exc: Exception) -> HTTPException:
    """Log the real error and return a clean, retryable message instead of a 500
    for any non-FloodWait Telegram/connection failure."""
    logger.error("telegram %s failed: %s", op, type(exc).__name__, exc_info=True)
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY,
        "Telegram is having trouble right now. Try again in a moment.",
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
        status.HTTP_429_TOO_MANY_REQUESTS,
        f"Telegram is limiting requests. Try again in {exc.seconds}s.",
    )


_INVALID_PHONE = (
    "That phone number looks invalid. Use full international format, "
    "e.g. +919812345678 (country code, no spaces or leading zeros)."
)


async def _send_code(op: str, call: Awaitable[str], *, invalid_phone: str = _INVALID_PHONE) -> str:
    """Await a Telegram send-code call, mapping its failure modes onto clean
    HTTP errors. Shared by every entry point that kicks off an OTP."""
    try:
        return await call
    except telegram.TelegramNotConfigured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Telegram login is not configured"
        ) from None
    except PhoneNumberInvalidError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, invalid_phone) from None
    except PhoneNumberBannedError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Telegram has banned this phone number."
        ) from None
    except PhoneNumberFloodError:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many codes sent to this number. Wait a while and try again.",
        ) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    except Exception as exc:
        raise _telegram_unavailable(op, exc) from exc


@router.post(
    "/telegram/start", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def telegram_start(payload: PhoneRequest, db: DbDep) -> TelegramLoginResult:
    ticket = await _send_code("start", telegram.start_login(payload.phone))
    return TelegramLoginResult(status="code_sent", ticket=ticket)


@router.post(
    "/telegram/signup", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def telegram_signup(payload: SignupStartRequest, db: DbDep) -> TelegramLoginResult:
    """Begin sign-up: reserve the username + carry the hashed password in the
    OTP ticket. The account is created only once the OTP verifies (via the
    existing /telegram/verify + /telegram/password endpoints)."""
    try:
        await service.ensure_username_available(db, payload.username)
    except service.InvalidUsername:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "3–30 chars: letters, numbers, - or _, starting with a letter/number; not reserved",
        ) from None
    except service.UsernameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken") from None
    ticket = await _send_code(
        "signup",
        telegram.start_signup(db, payload.phone, payload.username, payload.password),
    )
    return TelegramLoginResult(status="code_sent", ticket=ticket)


@router.post(
    "/password/reset", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def start_password_reset(payload: PasswordResetStartRequest) -> TelegramLoginResult:
    """Forgot password: send a Telegram code to the account's phone. Telegram is
    the only channel — BYOS has no email — and control of the Telegram account
    is what the password is protecting anyway. The new password is applied only
    once the code verifies, so this endpoint reveals nothing about whether an
    account exists."""
    ticket = await _send_code(
        "password-reset", telegram.start_password_reset(payload.phone, payload.password)
    )
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
            status.HTTP_400_BAD_REQUEST, "Login session expired. Please start again."
        ) from None
    except telegram.InvalidCode as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    except telegram.NoAccount:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No BYOS account uses this Telegram account yet. Create one instead.",
        ) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    except Exception as exc:
        raise _telegram_unavailable("verify", exc) from exc
    if result == "password_needed":
        return TelegramLoginResult(status="password_needed", ticket=ticket)
    assert user is not None
    if result == "password_reset":
        await audit.record(user.id, "password_reset", request=request)
    return await _issue_session(db, user, response, request)


@router.post(
    "/telegram/password", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def telegram_password(
    payload: TicketPasswordRequest, request: Request, response: Response, db: DbDep
) -> TelegramLoginResult:
    try:
        result, _, user = await telegram.verify_password(db, payload.ticket, payload.password)
    except (telegram.ExpiredTicket, telegram.LoginStateError):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Login session expired. Please start again."
        ) from None
    except telegram.InvalidCode as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    except telegram.NoAccount:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No BYOS account uses this Telegram account yet. Create one instead.",
        ) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    except Exception as exc:
        raise _telegram_unavailable("password", exc) from exc
    assert user is not None
    if result == "password_reset":
        await audit.record(user.id, "password_reset", request=request)
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


def _with_admin(user: User) -> UserResponse:
    """UserResponse with the computed `is_admin` filled in.

    Every endpoint that returns a user goes through this: admin status is derived
    from config rather than stored, so `model_validate` alone would leave it
    False and the client would hide the admin entry after a profile edit.
    """
    out = UserResponse.model_validate(user)
    out.is_admin = admin_service.is_admin(user)
    return out


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return _with_admin(user)


@router.post("/username", response_model=UserResponse)
async def set_username(payload: UsernameRequest, user: SessionUser, db: DbDep) -> UserResponse:
    try:
        updated = await service.set_username(db, user, payload.username)
    except service.InvalidUsername:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "3–30 chars: letters, numbers, - or _, starting with a letter/number; not reserved",
        ) from None
    except service.UsernameTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken") from None
    return _with_admin(updated)


@router.post("/display-name", response_model=UserResponse)
async def set_display_name(
    payload: DisplayNameRequest, user: SessionUser, db: DbDep
) -> UserResponse:
    updated = await service.set_display_name(db, user, payload.display_name)
    return _with_admin(updated)


@router.post("/password", response_model=UserResponse)
async def set_password(payload: SetPasswordRequest, user: SessionUser, db: DbDep) -> UserResponse:
    """Set or change the account password. Requires an interactive login."""
    try:
        updated = await service.set_password(db, user, payload.password, payload.current_password)
    except service.InvalidCurrentPassword:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect") from None
    return _with_admin(updated)


@router.post(
    "/login/password", response_model=TelegramLoginResult, dependencies=[Depends(_auth_limit)]
)
async def login_password(
    payload: PasswordLoginRequest, request: Request, response: Response, db: DbDep
) -> TelegramLoginResult:
    """Log in with username-or-phone + password (skips Telegram OTP).

    Password login never touches Telegram, so if the user terminated their
    Telegram sessions the stored storage session is dead. Detect that here and
    force OTP re-auth instead of letting them into a logged-in-but-broken state.
    """
    user = await service.authenticate_password(db, payload.identifier, payload.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    if not await providers_service.telegram_session_alive(db, user):
        await providers_service.mark_telegram_expired(db, user)
        if not user.phone:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Your Telegram access was logged out. Sign in with a Telegram code to reconnect.",
            )
        ticket = await _send_code(
            "password-reauth",
            telegram.start_login(user.phone),
            invalid_phone="Your saved phone number looks wrong. Sign in with a Telegram code.",
        )
        # Not a normal login result: the client must complete the OTP step
        # (/telegram/verify), which repairs the session and issues the session.
        return TelegramLoginResult(status="code_sent", ticket=ticket)

    return await _issue_session(db, user, response, request)
