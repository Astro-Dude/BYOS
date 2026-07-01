"""Helpers for the provider-agnostic file pipeline: choosing which provider a
user's uploads go to, and reconstructing a decrypted ProviderAccount for a
stored file."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core import crypto
from byos_api.db.models import File, FileVersion, StorageAccount, Tag, User
from byos_api.providers import service as providers_service
from byos_api.storage import ProviderAccount, StoredObjectRef, get_provider

logger = logging.getLogger("byos")


class FileNotFound(Exception):
    pass


class FileVersionNotFound(Exception):
    pass


class CannotDeleteCurrentVersion(Exception):
    pass


async def get_owned_file(db: AsyncSession, user: User, file_id: uuid.UUID) -> File:
    record = await db.get(File, file_id)
    if record is None or record.owner_id != user.id:
        raise FileNotFound
    return record


async def next_version_no(db: AsyncSession, file_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.max(FileVersion.version_no)).where(FileVersion.file_id == file_id)
    )
    return (result.scalar() or 0) + 1


async def list_versions(db: AsyncSession, file_id: uuid.UUID) -> list[FileVersion]:
    result = await db.execute(
        select(FileVersion)
        .where(FileVersion.file_id == file_id)
        .order_by(FileVersion.version_no.desc())
    )
    return list(result.scalars())


async def restore_version(
    db: AsyncSession, user: User, file_id: uuid.UUID, version_id: uuid.UUID
) -> File:
    record = await get_owned_file(db, user, file_id)
    version = await db.get(FileVersion, version_id)
    if version is None or version.file_id != record.id:
        raise FileVersionNotFound
    record.current_version_id = version.id
    record.size = version.size
    record.hash = version.hash
    await db.commit()
    await db.refresh(record)
    return record


async def delete_version(
    db: AsyncSession, user: User, file_id: uuid.UUID, version_id: uuid.UUID
) -> None:
    record = await get_owned_file(db, user, file_id)
    version = await db.get(FileVersion, version_id)
    if version is None or version.file_id != record.id:
        return  # idempotent
    if record.current_version_id == version.id:
        raise CannotDeleteCurrentVersion
    account = await account_for_file(db, user, record)
    if account is not None:
        # Provider errors propagate (incl. FloodWait) so we don't drop the row
        # while the remote object still exists.
        await get_provider(record.provider).delete(
            account,
            StoredObjectRef(
                provider=record.provider, locator=version.provider_locator, size=version.size
            ),
        )
    await db.delete(version)
    await db.commit()


def split_filename(filename: str) -> tuple[str, str | None]:
    """Return (name, extension). Extension is lowercased, or None if absent."""
    if "." in filename.strip("."):
        ext = filename.rpartition(".")[2].lower()
        return filename, ext or None
    return filename, None


def _account_to_provider_account(account: StorageAccount) -> ProviderAccount:
    return ProviderAccount(
        provider=account.provider,
        id=str(account.id),
        credentials={"session": crypto.decrypt(account.encrypted_credentials or "")},
        config=account.config,
    )


async def resolve_upload_target(
    db: AsyncSession, user: User
) -> tuple[str, ProviderAccount, uuid.UUID | None]:
    """Route uploads to Telegram when connected, otherwise the Local provider."""
    account = await providers_service.get_telegram_account(db, user)
    if account and account.status == "connected" and account.encrypted_credentials:
        return "telegram", _account_to_provider_account(account), account.id
    return "local", ProviderAccount(provider="local"), None


async def search_files(
    db: AsyncSession,
    user: User,
    query: str,
    *,
    ext: str | None = None,
    mime: str | None = None,
    folder_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[File]:
    """Full-text (search_vector) OR substring (pg_trgm-backed ILIKE) match on a
    user's files, ranked by ts_rank then recency, with optional filters."""
    stmt = select(File).where(File.owner_id == user.id)
    stmt = stmt.where(
        text(
            "(search_vector @@ websearch_to_tsquery('english', :q) OR name ILIKE :like)"
        ).bindparams(q=query, like=f"%{query}%")
    )
    if ext:
        stmt = stmt.where(File.ext == ext.lower())
    if mime:
        stmt = stmt.where(File.mime.ilike(f"{mime}%"))
    if folder_id is not None:
        stmt = stmt.where(File.folder_id == folder_id)
    stmt = stmt.order_by(
        text(
            "ts_rank(search_vector, websearch_to_tsquery('english', :rank_q)) DESC"
        ).bindparams(rank_q=query),
        File.created_at.desc(),
    ).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars())


async def set_favorite(db: AsyncSession, user: User, file_id: uuid.UUID, favorite: bool) -> File:
    file = await get_owned_file(db, user, file_id)
    file.is_favorite = favorite
    await db.commit()
    await db.refresh(file)
    return file


async def add_tag(db: AsyncSession, user: User, file_id: uuid.UUID, name: str) -> File:
    file = await get_owned_file(db, user, file_id)
    clean = name.strip().lower()
    if not clean:
        return file
    tag = (
        await db.execute(select(Tag).where(Tag.owner_id == user.id, Tag.name == clean))
    ).scalar_one_or_none()
    if tag is None:
        tag = Tag(owner_id=user.id, name=clean)
        db.add(tag)
        await db.flush()
    if all(t.id != tag.id for t in file.tags):
        file.tags.append(tag)
    await db.commit()
    await db.refresh(file)
    return file


async def remove_tag(db: AsyncSession, user: User, file_id: uuid.UUID, name: str) -> File:
    file = await get_owned_file(db, user, file_id)
    clean = name.strip().lower()
    file.tags = [t for t in file.tags if t.name != clean]
    await db.commit()
    await db.refresh(file)
    return file


async def list_tags(db: AsyncSession, user: User) -> list[str]:
    result = await db.execute(
        select(Tag.name).where(Tag.owner_id == user.id).order_by(Tag.name)
    )
    return list(result.scalars())


async def account_for_file(db: AsyncSession, user: User, record: File) -> ProviderAccount | None:
    """Build the ProviderAccount needed to read/delete a stored file, or None if
    its provider account is no longer available."""
    if record.provider != "telegram":
        return ProviderAccount(provider="local")

    account: StorageAccount | None = None
    if record.storage_account_id is not None:
        account = await db.get(StorageAccount, record.storage_account_id)
    if account is None:
        account = await providers_service.get_telegram_account(db, user)
    if account is None or not account.encrypted_credentials:
        return None
    return _account_to_provider_account(account)


async def account_for_file_public(db: AsyncSession, record: File) -> ProviderAccount | None:
    """Resolve the storage account for a file by its OWNER (no request user) —
    used by public alias resolution."""
    if record.provider != "telegram":
        return ProviderAccount(provider="local")

    account: StorageAccount | None = None
    if record.storage_account_id is not None:
        account = await db.get(StorageAccount, record.storage_account_id)
    if account is None:
        result = await db.execute(
            select(StorageAccount).where(
                StorageAccount.user_id == record.owner_id, StorageAccount.provider == "telegram"
            )
        )
        account = result.scalar_one_or_none()
    if account is None or not account.encrypted_credentials:
        return None
    return _account_to_provider_account(account)
