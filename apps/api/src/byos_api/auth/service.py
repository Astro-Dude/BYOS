"""Refresh-token issuance, rotation, and revocation for the BYOS app session.

Login itself is handled by byos_api.auth.telegram (Telegram-as-identity); this
module only manages the JWT refresh lifecycle once a user is authenticated.
Refresh tokens are opaque and stored only as SHA-256 hashes.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core.config import get_settings
from byos_api.core.security import generate_refresh_token, hash_refresh_token
from byos_api.db.models import RefreshToken, User

_settings = get_settings()


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
