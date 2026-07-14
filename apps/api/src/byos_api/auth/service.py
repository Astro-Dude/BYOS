"""Refresh-token issuance, rotation, and revocation for the BYOS app session.

Login itself is handled by byos_api.auth.telegram (Telegram-as-identity); this
module only manages the JWT refresh lifecycle once a user is authenticated.
Refresh tokens are opaque and stored only as SHA-256 hashes.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core.config import get_settings
from byos_api.core.security import (
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    needs_rehash,
    verify_password,
)
from byos_api.db.models import RefreshToken, User

_settings = get_settings()

# 3–30 chars, starts alphanumeric, then letters/digits/-/_.
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,29}$")
# Names that would collide with (or shadow) top-level API paths.
RESERVED_USERNAMES = {
    "a", "s", "auth", "providers", "folders", "files", "aliases", "shares",
    "analytics", "api-keys", "webhooks", "audit", "health", "docs", "redoc",
    "openapi.json", "admin", "api", "www", "dashboard", "login", "register",
    "settings", "help", "support", "static", "public",
}


class InvalidUsername(Exception):
    pass


class UsernameTaken(Exception):
    pass


async def set_username(db: AsyncSession, user: User, raw: str) -> User:
    username = raw.strip().lower()
    if not USERNAME_RE.match(username) or username in RESERVED_USERNAMES:
        raise InvalidUsername
    clash = (
        await db.execute(select(User).where(User.username == username))
    ).scalar_one_or_none()
    if clash is not None and clash.id != user.id:
        raise UsernameTaken
    user.username = username
    await db.commit()
    await db.refresh(user)
    return user


class InvalidCurrentPassword(Exception):
    pass


async def set_password(
    db: AsyncSession, user: User, raw: str, current: str | None = None
) -> User:
    """Set/replace the account password (hashed with Argon2). Changing an
    existing password requires the correct current one."""
    if user.password_hash is not None and (
        not current or not verify_password(current, user.password_hash)
    ):
        raise InvalidCurrentPassword
    user.password_hash = hash_password(raw)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_password(
    db: AsyncSession, identifier: str, password: str
) -> User | None:
    """Resolve a user by username OR phone and verify the password. Returns None
    for any miss (generic — never reveal which part failed)."""
    ident = identifier.strip()
    user = (
        await db.execute(
            select(User).where(or_(User.username == ident.lower(), User.phone == ident))
        )
    ).scalar_one_or_none()
    if user is None or not user.is_active or user.password_hash is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    if needs_rehash(user.password_hash):  # opportunistic upgrade
        user.password_hash = hash_password(password)
        await db.commit()
    return user


class InvalidRefreshToken(Exception):
    pass


def _refresh_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(days=_settings.refresh_token_expire_days)


async def issue_refresh_token(db: AsyncSession, user: User) -> str:
    raw = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id, token_hash=hash_refresh_token(raw), expires_at=_refresh_expiry()
        )
    )
    await db.commit()
    return raw


async def rotate_refresh_token(db: AsyncSession, raw: str) -> tuple[User, str]:
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw))
    )
    record = result.scalar_one_or_none()
    now = datetime.now(UTC)
    if record is None or record.revoked_at is not None or record.expires_at <= now:
        raise InvalidRefreshToken

    record.revoked_at = now  # one-time use: revoke on rotation
    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise InvalidRefreshToken

    new_raw = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id, token_hash=hash_refresh_token(new_raw), expires_at=_refresh_expiry()
        )
    )
    await db.commit()
    return user, new_raw


async def revoke_refresh_token(db: AsyncSession, raw: str) -> None:
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw))
    )
    record = result.scalar_one_or_none()
    if record is not None and record.revoked_at is None:
        record.revoked_at = datetime.now(UTC)
        await db.commit()
