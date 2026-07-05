"""Shareable links with access controls (password, expiry, download limit,
view-only). A share points at a file and always serves its current version."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core.security import hash_password, verify_password
from byos_api.db.models import File, FileVersion, Share, User


class FileNotFound(Exception):
    pass


class ShareNotFound(Exception):
    pass


class SharePasswordRequired(Exception):
    pass


class ShareExpired(Exception):
    pass


class ShareLimitReached(Exception):
    pass


async def create_share(
    db: AsyncSession,
    user: User,
    *,
    file_id: uuid.UUID,
    password: str | None,
    expires_in_days: int | None,
    max_downloads: int | None,
    view_only: bool,
) -> Share:
    file = await db.get(File, file_id)
    if file is None or file.owner_id != user.id:
        raise FileNotFound
    expires_at = datetime.now(UTC) + timedelta(days=expires_in_days) if expires_in_days else None
    share = Share(
        owner_id=user.id,
        file_id=file_id,
        token=secrets.token_urlsafe(12),
        visibility="password" if password else "public",
        password_hash=hash_password(password) if password else None,
        expires_at=expires_at,
        max_downloads=max_downloads,
        view_only=view_only,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return share


async def list_shares(db: AsyncSession, user: User) -> list[Share]:
    result = await db.execute(
        select(Share).where(Share.owner_id == user.id).order_by(Share.created_at.desc())
    )
    return list(result.scalars())


async def revoke_share(db: AsyncSession, user: User, share_id: uuid.UUID) -> None:
    share = await db.get(Share, share_id)
    if share is not None and share.owner_id == user.id:
        await db.delete(share)
        await db.commit()  # absent share → no-op (idempotent)


async def resolve_share(
    db: AsyncSession, token: str, password: str | None
) -> tuple[Share, File, FileVersion]:
    share = (await db.execute(select(Share).where(Share.token == token))).scalar_one_or_none()
    if share is None:
        raise ShareNotFound
    if share.expires_at is not None and share.expires_at <= datetime.now(UTC):
        raise ShareExpired
    if share.password_hash is not None and (
        not password or not verify_password(password, share.password_hash)
    ):
        raise SharePasswordRequired
    if (
        not share.view_only
        and share.max_downloads is not None
        and share.download_count >= share.max_downloads
    ):
        raise ShareLimitReached

    file = await db.get(File, share.file_id)
    if file is None or file.current_version_id is None:
        raise ShareNotFound
    version = await db.get(FileVersion, file.current_version_id)
    if version is None:
        raise ShareNotFound
    return share, file, version


async def register_download(db: AsyncSession, share: Share) -> None:
    share.download_count += 1
    await db.commit()
