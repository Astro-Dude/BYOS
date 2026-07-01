"""API-key issuance and verification.

Keys look like ``byosk_<prefix>_<secret>``. Only ``sha256(full_key)`` is stored
(SHA-256 is sufficient for high-entropy random secrets — same rationale as
refresh tokens). ``prefix`` is public and indexed, so verification is a single
indexed lookup plus a constant-time hash compare.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.db.models import ApiKey, User

_SCHEME = "byosk"
_PREFIX_BYTES = 4  # 8 hex chars
_SECRET_BYTES = 32
_TOUCH_INTERVAL = timedelta(minutes=5)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def create_key(db: AsyncSession, user: User, name: str) -> tuple[ApiKey, str]:
    prefix = secrets.token_hex(_PREFIX_BYTES)
    secret = secrets.token_urlsafe(_SECRET_BYTES)
    full = f"{_SCHEME}_{prefix}_{secret}"
    key = ApiKey(
        owner_id=user.id,
        name=name.strip() or "API key",
        prefix=prefix,
        key_hash=_hash(full),
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return key, full


async def list_keys(db: AsyncSession, user: User) -> list[ApiKey]:
    result = await db.execute(
        select(ApiKey).where(ApiKey.owner_id == user.id).order_by(ApiKey.created_at.desc())
    )
    return list(result.scalars())


async def revoke_key(db: AsyncSession, user: User, key_id: uuid.UUID) -> None:
    key = await db.get(ApiKey, key_id)
    if key is not None and key.owner_id == user.id and key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
        await db.commit()
    # absent / already-revoked → idempotent no-op


async def authenticate(db: AsyncSession, raw_key: str) -> User | None:
    """Resolve the owning, active user for a raw key, or None if invalid."""
    parts = raw_key.split("_")
    if len(parts) < 3 or parts[0] != _SCHEME:
        return None
    prefix = parts[1]
    key = (
        await db.execute(select(ApiKey).where(ApiKey.prefix == prefix))
    ).scalar_one_or_none()
    if key is None or key.revoked_at is not None:
        return None
    if not secrets.compare_digest(key.key_hash, _hash(raw_key)):
        return None
    user = await db.get(User, key.owner_id)
    if user is None or not user.is_active:
        return None
    now = datetime.now(UTC)
    if key.last_used_at is None or (now - key.last_used_at) > _TOUCH_INTERVAL:
        key.last_used_at = now
        await db.commit()
    return user
