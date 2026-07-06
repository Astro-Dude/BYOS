"""FastAPI auth dependencies.

A request authenticates as a **session** (JWT access token from the web UI) or
an **API key** (``byosk_...`` bearer). Both resolve to a :class:`Principal`:

- session logins have full access (``scopes is None``);
- API keys are limited to their granted scopes and are barred from account
  administration (issuing keys, provider credentials, webhooks).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import make_transient_to_detached

from byos_api.apikeys import service as apikeys_service
from byos_api.core.cache import cached_json, invalidate
from byos_api.core.config import get_settings
from byos_api.core.db import get_db
from byos_api.core.ratelimit import rate_limit
from byos_api.core.security import decode_access_token
from byos_api.db.models import User

_USER_CACHE_TTL = 60  # seconds


def _user_cache_key(user_id: uuid.UUID | str) -> str:
    return f"user:{user_id}"


async def invalidate_user(user_id: uuid.UUID | str) -> None:
    """Drop a cached user snapshot (call after mutating the user row)."""
    await invalidate(_user_cache_key(user_id))


async def _load_active_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    """Resolve a session user, caching a snapshot in Redis so the common authed
    path skips a DB round-trip. Returns a session-attached instance (via
    merge(load=False)) so downstream mutations still persist."""

    async def snapshot() -> dict[str, Any] | None:
        u = await db.get(User, user_id)
        if u is None or not u.is_active:
            return None
        return {
            "id": str(u.id),
            "telegram_user_id": u.telegram_user_id,
            "username": u.username,
            "email": u.email,
            "display_name": u.display_name,
            "is_active": u.is_active,
            "is_verified": u.is_verified,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }

    data = await cached_json(_user_cache_key(user_id), _USER_CACHE_TTL, snapshot)
    if data is None:
        return None
    ghost = User(
        id=uuid.UUID(data["id"]),
        telegram_user_id=data["telegram_user_id"],
        username=data["username"],
        email=data["email"],
        display_name=data["display_name"],
        is_active=data["is_active"],
        is_verified=data["is_verified"],
        created_at=datetime.fromisoformat(data["created_at"]) if data["created_at"] else None,
    )
    # Present the snapshot as a previously-loaded (detached) row, then merge with
    # load=False so there's no SELECT. The result is session-attached, so a later
    # field change + commit (e.g. set_username) still persists correctly.
    make_transient_to_detached(ghost)
    return await db.merge(ghost, load=False)

_bearer = HTTPBearer(auto_error=False)
_API_KEY_SCHEME = "byosk_"
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_unauthorized = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


@dataclass
class Principal:
    user: User
    auth_type: str  # "session" | "api_key"
    scopes: set[str] | None  # None = full access (session login, or legacy key)
    key_prefix: str | None = None


async def get_principal(
    request: Request,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Principal:
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached

    if creds is None:
        raise _unauthorized

    # Programmatic clients present an API key instead of a JWT access token.
    if creds.credentials.startswith(_API_KEY_SCHEME):
        result = await apikeys_service.authenticate(db, creds.credentials)
        if result is None:
            raise _unauthorized
        user, key = result
        # NULL scopes = legacy key issued before scopes existed → full access.
        scopes = set(key.scopes) if key.scopes else None
        principal = Principal(
            user=user, auth_type="api_key", scopes=scopes, key_prefix=key.prefix
        )
    else:
        try:
            payload = decode_access_token(creds.credentials)
        except jwt.PyJWTError:
            raise _unauthorized from None
        if payload.get("type") != "access":
            raise _unauthorized
        try:
            user_id = uuid.UUID(str(payload.get("sub")))
        except (ValueError, TypeError):
            raise _unauthorized from None
        db_user = await _load_active_user(db, user_id)
        if db_user is None:
            raise _unauthorized
        principal = Principal(user=db_user, auth_type="session", scopes=None)

    request.state.principal = principal
    return principal


async def get_current_user(principal: Annotated[Principal, Depends(get_principal)]) -> User:
    return principal.user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_session_user(principal: Annotated[Principal, Depends(get_principal)]) -> User:
    """Require an interactive login — reject API keys. Used for account admin."""
    if principal.auth_type != "session":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This action requires an interactive login, not an API key.",
        )
    return principal.user


SessionUser = Annotated[User, Depends(get_session_user)]


def require_scope(resource: str):
    """Router dependency: enforce the caller's API-key scope for `resource`.

    Safe methods need `{resource}:read` (write implies read); mutating methods
    need `{resource}:write`. Session logins bypass the check (full access).
    """

    async def dependency(
        request: Request, principal: Annotated[Principal, Depends(get_principal)]
    ) -> None:
        if principal.scopes is None:
            return  # session login or legacy key → full access
        if request.method in _SAFE_METHODS:
            needed = f"{resource}:read"
            ok = needed in principal.scopes or f"{resource}:write" in principal.scopes
        else:
            needed = f"{resource}:write"
            ok = needed in principal.scopes
        if not ok:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"API key is missing the required scope: {needed}",
            )

    return dependency


async def api_key_rate_limit(
    principal: Annotated[Principal, Depends(get_principal)],
) -> None:
    """Throttle API-key traffic per key (session UI is not rate-limited here)."""
    if principal.auth_type != "api_key" or principal.key_prefix is None:
        return
    settings = get_settings()
    key = f"apikey:{principal.key_prefix}"
    if not await rate_limit(key, settings.api_rate_limit, settings.api_rate_window):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many requests — please slow down.",
        )
