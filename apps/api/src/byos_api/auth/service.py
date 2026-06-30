"""Auth business logic: user creation, credential checks, and refresh-token
rotation/revocation. Refresh tokens are opaque and stored only as SHA-256
hashes; rotation revokes the presented token and issues a fresh one."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core.config import get_settings
from byos_api.core.security import (
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from byos_api.db.models import RefreshToken, User

_settings = get_settings()


class EmailAlreadyExists(Exception):
    pass


class InvalidCredentials(Exception):
    pass


class InvalidRefreshToken(Exception):
    pass


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _refresh_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(days=_settings.refresh_token_expire_days)


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == _normalize_email(email)))
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession, *, email: str, password: str, display_name: str | None = None
) -> User:
    if await get_user_by_email(db, email) is not None:
        raise EmailAlreadyExists
    user = User(
        email=_normalize_email(email),
        password_hash=hash_password(password),
        display_name=display_name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate(db: AsyncSession, *, email: str, password: str) -> User:
    user = await get_user_by_email(db, email)
    if user is None or not verify_password(password, user.password_hash) or not user.is_active:
        raise InvalidCredentials
    return user


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
