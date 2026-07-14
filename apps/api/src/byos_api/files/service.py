"""Helpers for the provider-agnostic file pipeline: choosing which provider a
user's uploads go to, and reconstructing a decrypted ProviderAccount for a
stored file."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import false, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai.nl_search import ParsedQuery
from byos_api.core import crypto
from byos_api.db.models import File, FileVersion, Folder, StorageAccount, Tag, User
from byos_api.providers import service as providers_service
from byos_api.storage import ProviderAccount, StoredObjectRef, get_provider
from byos_api.storage.base import ProviderAuthError

logger = logging.getLogger("byos")


class FileNotFound(Exception):
    pass


class FileVersionNotFound(Exception):
    pass


class CannotDeleteCurrentVersion(Exception):
    pass


class NoStorageConnected(Exception):
    """Raised when a user tries to upload without connected Telegram storage."""

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
    """Uploads always go to the user's connected Telegram storage — never local.

    Raises NoStorageConnected if Telegram isn't linked, so we never silently fall
    back to storing bytes on the app's own disk."""
    account = await providers_service.get_telegram_account(db, user)
    if account and account.status == "connected" and account.encrypted_credentials:
        return "telegram", _account_to_provider_account(account), account.id
    raise NoStorageConnected


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


async def nl_search(db: AsyncSession, user: User, parsed: ParsedQuery, limit: int) -> list[File]:
    """Run a parsed natural-language query: structured filters (type/size/
    recency) plus optional full-text on the remaining terms."""
    stmt = select(File).where(File.owner_id == user.id)
    if parsed.text:
        like = parsed.text.replace('"', "").strip()
        stmt = stmt.where(
            text(
                "(search_vector @@ websearch_to_tsquery('english', :q) OR name ILIKE :like)"
            ).bindparams(q=parsed.text, like=f"%{like}%")
        )
    if parsed.ext:
        stmt = stmt.where(File.ext == parsed.ext.lower())
    if parsed.mime_prefix:
        stmt = stmt.where(File.mime.ilike(f"{parsed.mime_prefix}%"))
    for tag in parsed.tags:
        stmt = stmt.where(File.tags.any(Tag.name == tag))
    if parsed.is_favorite:
        stmt = stmt.where(File.is_favorite.is_(True))
    if parsed.folder_name is not None:
        folder_ids = (
            await db.execute(
                select(Folder.id).where(
                    Folder.owner_id == user.id,
                    func.lower(Folder.name) == parsed.folder_name.lower(),
                )
            )
        ).scalars().all()
        stmt = stmt.where(File.folder_id.in_(folder_ids)) if folder_ids else stmt.where(false())
    if parsed.min_size is not None:
        stmt = stmt.where(File.size >= parsed.min_size)
    if parsed.max_size is not None:
        stmt = stmt.where(File.size <= parsed.max_size)
    if parsed.since_days is not None:
        stmt = stmt.where(File.created_at >= datetime.now(UTC) - timedelta(days=parsed.since_days))
    if parsed.after is not None:
        stmt = stmt.where(File.created_at >= datetime.combine(parsed.after, time.min, tzinfo=UTC))
    if parsed.before is not None:
        stmt = stmt.where(File.created_at < datetime.combine(parsed.before, time.min, tzinfo=UTC))

    if parsed.text:
        stmt = stmt.order_by(
            text(
                "ts_rank(search_vector, websearch_to_tsquery('english', :rank_q)) DESC"
            ).bindparams(rank_q=parsed.text),
            File.created_at.desc(),
        )
    else:
        stmt = stmt.order_by(File.created_at.desc())
    result = await db.execute(stmt.limit(limit))
    return list(result.scalars())


async def find_duplicates(db: AsyncSession, user: User) -> list[tuple[str, list[File]]]:
    """Group the user's files by content hash where the same bytes appear more
    than once. Uses the hash already stored at upload — no re-reading needed."""
    dup_hashes = (
        select(File.hash)
        .where(File.owner_id == user.id, File.hash.is_not(None))
        .group_by(File.hash)
        .having(func.count() > 1)
    ).scalar_subquery()
    rows = (
        await db.execute(
            select(File)
            .where(File.owner_id == user.id, File.hash.in_(dup_hashes))
            .order_by(File.hash, File.created_at)
        )
    ).scalars()
    groups: dict[str, list[File]] = {}
    for file in rows:
        if file.hash is not None:
            groups.setdefault(file.hash, []).append(file)
    return list(groups.items())


async def find_missing(db: AsyncSession, user: User) -> list[File]:
    """Files flagged as gone from the provider (deleted directly in Telegram)."""
    return list(
        (
            await db.execute(
                select(File)
                .where(File.owner_id == user.id, File.missing_at.is_not(None))
                .order_by(File.missing_at.desc())
            )
        ).scalars()
    )


async def delete_missing(db: AsyncSession, user: User) -> int:
    """Remove ALL of the user's flagged-missing file records at once. The bytes
    are already gone from the provider (that's why they're missing), so this is a
    records-only cleanup — no provider calls. Returns how many were removed."""
    records = list(
        (
            await db.execute(
                select(File).where(File.owner_id == user.id, File.missing_at.is_not(None))
            )
        ).scalars()
    )
    for record in records:
        record.current_version_id = None
        await db.flush()
        await db.delete(record)  # cascades to file_versions and aliases
    await db.commit()
    return len(records)


async def verify_missing(db: AsyncSession, user: User) -> dict[str, int]:
    """Check each of the user's files against the provider (cheap exists() — no
    download) and set/clear `missing_at`. Stops gracefully on FloodWait and
    returns partial progress."""
    from telethon.errors import FloodWaitError

    files = list(
        (
            await db.execute(
                select(File).where(
                    File.owner_id == user.id, File.current_version_id.is_not(None)
                )
            )
        ).scalars()
    )
    checked = 0
    missing = 0
    for record in files:
        account = await account_for_file(db, user, record)
        if account is None:
            continue
        version = await db.get(FileVersion, record.current_version_id)
        if version is None:
            continue
        ref = StoredObjectRef(
            provider=record.provider,
            locator=version.provider_locator,
            size=version.size,
            checksum=version.hash,
        )
        try:
            exists = await get_provider(record.provider).exists(account, ref)
        except FloodWaitError:
            break  # Telegram rate-limited us — return what we've verified so far
        except ProviderAuthError:
            raise  # dead session → surface "sign in again" instead of scanning
        except Exception:
            logger.warning("verify: exists() failed for file %s", record.id, exc_info=True)
            continue
        checked += 1
        if not exists:
            missing += 1
            if record.missing_at is None:
                record.missing_at = datetime.now(UTC)
        elif record.missing_at is not None:
            record.missing_at = None  # came back
    await db.commit()
    return {"checked": checked, "missing": missing}


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
