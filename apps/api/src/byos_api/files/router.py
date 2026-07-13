from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import FloodWaitError, RPCError

from byos_api.ai import nl_search
from byos_api.ai.tagging import suggest_tags
from byos_api.audit import recorder as audit
from byos_api.auth.dependencies import (
    CurrentUser,
    api_key_rate_limit,
    require_scope,
)
from byos_api.core.config import get_settings
from byos_api.core.db import get_db
from byos_api.db.models import File, FileVersion, Folder, Tag
from byos_api.files import service
from byos_api.files.schemas import (
    DuplicateGroup,
    FavoriteRequest,
    FileOut,
    MoveRequest,
    RenameRequest,
    TagRequest,
    VersionOut,
)
from byos_api.security.scanning import scan_upload
from byos_api.storage import StoredObjectRef, get_provider
from byos_api.streaming import stream_object
from byos_api.webhooks import dispatcher

logger = logging.getLogger("byos")
router = APIRouter(
    prefix="/files",
    tags=["files"],
    dependencies=[Depends(require_scope("files")), Depends(api_key_rate_limit)],
)

DbDep = Annotated[AsyncSession, Depends(get_db)]
_UPLOAD_CHUNK = 1024 * 1024


async def _validate_upload(file: UploadFile, filename: str) -> None:
    """Enforce size / extension policy and run the scan hook BEFORE storing
    bytes, so rejected uploads never touch the provider."""
    settings = get_settings()
    if file.size is not None and file.size > settings.max_upload_bytes:
        limit_gb = settings.max_upload_bytes / (1024**3)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File is too large — the maximum upload size is {limit_gb:.0f} GB.",
        )
    _, ext = service.split_filename(filename)
    if ext and ext.lower() in settings.blocked_extensions_set:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f".{ext} files are not allowed")
    result = await scan_upload(filename=filename, size=file.size or 0, mime=file.content_type)
    if not result.clean:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, result.reason or "File failed a security scan"
        )


def _file_event_payload(record: File) -> dict[str, object]:
    return {
        "file_id": str(record.id),
        "name": record.name,
        "size": record.size,
        "mime": record.mime,
        "folder_id": str(record.folder_id) if record.folder_id else None,
    }


def _flood(exc: FloodWaitError) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS, f"Telegram rate limit — retry in {exc.seconds}s"
    )


@router.post("", response_model=FileOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    user: CurrentUser,
    db: DbDep,
    file: UploadFile,
    folder_id: Annotated[uuid.UUID | None, Form()] = None,
) -> FileOut:
    # Validate the target folder BEFORE touching storage (prevents cross-user
    # attach and avoids uploading bytes we'd then fail to record).
    if folder_id is not None:
        folder = await db.get(Folder, folder_id)
        if folder is None or folder.owner_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")

    filename = file.filename or "upload.bin"
    await _validate_upload(file, filename)

    try:
        provider_name, account, storage_account_id = await service.resolve_upload_target(db, user)
    except service.NoStorageConnected:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Connect your Telegram storage before uploading"
        ) from None
    provider = get_provider(provider_name)

    async def _stream():
        while chunk := await file.read(_UPLOAD_CHUNK):
            yield chunk

    try:
        ref = await provider.upload(
            account, _stream(), filename=filename, size=file.size or 0, mime=file.content_type
        )
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    except RPCError as exc:
        # Telegram rejected the transfer (e.g. FilePartsInvalidError for a file
        # over the account's per-file ceiling). Fail cleanly instead of 500.
        logger.warning("telegram upload rejected: %s", exc)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Telegram rejected this file — it may exceed your account's size limit "
            "(2 GB, or 4 GB with Telegram Premium).",
        ) from exc

    # Idempotency: if an identical file (same name + content hash) already exists
    # in this folder, drop the redundant upload and return the existing record —
    # so retries never pile up duplicates.
    existing = (
        await db.execute(
            select(File).where(
                File.owner_id == user.id,
                File.folder_id == folder_id,
                File.name == filename,
                File.hash == ref.checksum,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        try:
            await provider.delete(
                account,
                StoredObjectRef(provider=provider_name, locator=ref.locator, size=ref.size),
            )
        except Exception:
            logger.warning("Failed to clean up redundant duplicate upload", exc_info=True)
        return FileOut.model_validate(existing)

    # Persist metadata; if it fails, delete the just-stored object so we never
    # leave an orphan in the provider.
    try:
        _, ext = service.split_filename(filename)
        record = File(
            owner_id=user.id,
            folder_id=folder_id,
            storage_account_id=storage_account_id,
            name=filename,
            ext=ext,
            mime=file.content_type,
            size=ref.size,
            hash=ref.checksum,
            provider=provider_name,
        )
        db.add(record)
        await db.flush()
        version = FileVersion(
            file_id=record.id,
            version_no=1,
            provider=provider_name,
            provider_locator=ref.locator,
            size=ref.size,
            hash=ref.checksum,
        )
        db.add(version)
        await db.flush()
        record.current_version_id = version.id
        await db.commit()
        await db.refresh(record)
    except Exception:
        await db.rollback()
        try:
            await provider.delete(
                account,
                StoredObjectRef(provider=provider_name, locator=ref.locator, size=ref.size),
            )
        except Exception:
            logger.warning("Failed to clean up orphaned object after upload failure", exc_info=True)
        raise

    dispatcher.emit(record.owner_id, "file.created", _file_event_payload(record))

    # Auto-tag by type (heuristic by default; pluggable). Best-effort — a tagging
    # failure must not fail an otherwise-successful upload.
    if get_settings().auto_tagging:
        for tag in suggest_tags(filename=filename, mime=record.mime, ext=record.ext):
            try:
                # add_tag mutates and refreshes this same identity-mapped record.
                await service.add_tag(db, user, record.id, tag)
            except Exception:
                logger.debug("auto-tag %s failed", tag, exc_info=True)

    return FileOut.model_validate(record)


@router.get("/search", response_model=list[FileOut])
async def search_files(
    user: CurrentUser,
    db: DbDep,
    q: str,
    ext: str | None = None,
    mime: str | None = None,
    folder_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[FileOut]:
    query = q.strip()
    if not query:
        return []
    files = await service.search_files(
        db, user, query, ext=ext, mime=mime, folder_id=folder_id, limit=min(max(limit, 1), 100)
    )
    return [FileOut.model_validate(f) for f in files]


@router.get("/tags", response_model=list[str])
async def list_tags(user: CurrentUser, db: DbDep) -> list[str]:
    return await service.list_tags(db, user)


@router.get("/duplicates", response_model=list[DuplicateGroup])
async def list_duplicates(user: CurrentUser, db: DbDep) -> list[DuplicateGroup]:
    groups = await service.find_duplicates(db, user)
    return [
        DuplicateGroup(hash=digest, files=[FileOut.model_validate(f) for f in files])
        for digest, files in groups
    ]


@router.get("/missing", response_model=list[FileOut])
async def list_missing(user: CurrentUser, db: DbDep) -> list[FileOut]:
    """Files whose bytes are gone from the provider (deleted in Telegram)."""
    return [FileOut.model_validate(f) for f in await service.find_missing(db, user)]


@router.post("/verify")
async def verify_files(user: CurrentUser, db: DbDep) -> dict[str, int]:
    """Scan the user's files against the provider and flag/unflag missing ones.
    Returns {checked, missing}."""
    return await service.verify_missing(db, user)


@router.get("/nl-search", response_model=list[FileOut])
async def natural_language_search(
    user: CurrentUser,
    db: DbDep,
    q: str,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[FileOut]:
    """Natural-language file search: "pdfs from last week larger than 2mb"."""
    if not q.strip():
        return []
    parsed = nl_search.parse(q)
    files = await service.nl_search(db, user, parsed, limit)
    return [FileOut.model_validate(f) for f in files]


@router.get("", response_model=list[FileOut])
async def list_files(
    user: CurrentUser,
    db: DbDep,
    folder_id: uuid.UUID | None = None,
    favorite: bool = False,
    tag: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[FileOut]:
    stmt = select(File).where(File.owner_id == user.id)
    if favorite:
        stmt = stmt.where(File.is_favorite.is_(True))
    elif tag:
        stmt = stmt.join(File.tags).where(Tag.name == tag.strip().lower())
    elif folder_id is not None:
        stmt = stmt.where(File.folder_id == folder_id)
    else:
        # Root: files with no folder.
        stmt = stmt.where(File.folder_id.is_(None))
    # Paginated for infinite scroll; the client requests the next page by offset.
    stmt = stmt.order_by(File.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return [FileOut.model_validate(f) for f in result.scalars()]


@router.get("/{file_id}/content")
async def download_file(
    file_id: uuid.UUID, request: Request, user: CurrentUser, db: DbDep
) -> Response:
    record = await db.get(File, file_id)
    if record is None or record.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    if record.current_version_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File has no content")
    version = await db.get(FileVersion, record.current_version_id)
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File version not found")

    account = await service.account_for_file(db, user, record)
    if account is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Storage provider is not connected")

    ref = StoredObjectRef(
        provider=record.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    async def _mark_missing() -> None:
        record.missing_at = datetime.now(UTC)
        await db.commit()

    return await stream_object(
        get_provider(record.provider),
        account,
        ref,
        filename=record.name,
        mime=record.mime,
        etag=version.hash,
        request=request,
        on_missing=_mark_missing,
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: uuid.UUID, request: Request, user: CurrentUser, db: DbDep
) -> None:
    record = await db.get(File, file_id)
    if record is None or record.owner_id != user.id:
        return  # idempotent: nothing to delete for this user

    account = await service.account_for_file(db, user, record)
    versions = list(
        (await db.execute(select(FileVersion).where(FileVersion.file_id == record.id))).scalars()
    )
    if account is not None:
        provider = get_provider(record.provider)
        try:
            for version in versions:
                await provider.delete(
                    account,
                    StoredObjectRef(
                        provider=record.provider,
                        locator=version.provider_locator,
                        size=version.size,
                    ),
                )
        except FloodWaitError as exc:
            raise _flood(exc) from exc
        # Any other provider error propagates (500): we do NOT drop the metadata
        # while the remote object may still exist, so the delete can be retried.
        # (Deleting an already-gone message is a no-op, so this path is safe.)

    payload = _file_event_payload(record)
    record.current_version_id = None
    await db.flush()
    await db.delete(record)  # cascades to file_versions
    await db.commit()
    dispatcher.emit(user.id, "file.deleted", payload)
    await audit.record(
        user.id, "file.delete", request=request, target_type="file", target_id=str(file_id)
    )


@router.post("/{file_id}/replace", response_model=FileOut)
async def replace_file(
    file_id: uuid.UUID, user: CurrentUser, db: DbDep, file: UploadFile
) -> FileOut:
    try:
        record = await service.get_owned_file(db, user, file_id)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None

    account = await service.account_for_file(db, user, record)
    if account is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Storage provider is not connected")
    provider = get_provider(record.provider)
    filename = file.filename or record.name
    await _validate_upload(file, filename)

    async def _stream():
        while chunk := await file.read(_UPLOAD_CHUNK):
            yield chunk

    try:
        ref = await provider.upload(
            account, _stream(), filename=filename, size=file.size or 0, mime=file.content_type
        )
    except FloodWaitError as exc:
        raise _flood(exc) from exc
    except RPCError as exc:
        # Telegram rejected the transfer (e.g. FilePartsInvalidError for a file
        # over the account's per-file ceiling). Fail cleanly instead of 500.
        logger.warning("telegram upload rejected: %s", exc)
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Telegram rejected this file — it may exceed your account's size limit "
            "(2 GB, or 4 GB with Telegram Premium).",
        ) from exc

    # Idempotent replace: identical content creates no new version.
    current = (
        await db.get(FileVersion, record.current_version_id)
        if record.current_version_id
        else None
    )
    if current is not None and current.hash == ref.checksum:
        try:
            await provider.delete(
                account,
                StoredObjectRef(provider=record.provider, locator=ref.locator, size=ref.size),
            )
        except Exception:
            logger.warning("Failed to clean up redundant identical replace", exc_info=True)
        return FileOut.model_validate(record)

    try:
        version = FileVersion(
            file_id=record.id,
            version_no=await service.next_version_no(db, record.id),
            provider=record.provider,
            provider_locator=ref.locator,
            size=ref.size,
            hash=ref.checksum,
        )
        db.add(version)
        await db.flush()
        record.current_version_id = version.id
        record.size = ref.size
        record.hash = ref.checksum
        if file.content_type:
            record.mime = file.content_type
        await db.commit()
        await db.refresh(record)
    except Exception:
        await db.rollback()
        try:
            await provider.delete(
                account,
                StoredObjectRef(provider=record.provider, locator=ref.locator, size=ref.size),
            )
        except Exception:
            logger.warning(
                "Failed to clean up orphaned object after replace failure", exc_info=True
            )
        raise

    dispatcher.emit(record.owner_id, "file.replaced", _file_event_payload(record))
    return FileOut.model_validate(record)


@router.get("/{file_id}/versions", response_model=list[VersionOut])
async def list_versions(file_id: uuid.UUID, user: CurrentUser, db: DbDep) -> list[VersionOut]:
    try:
        record = await service.get_owned_file(db, user, file_id)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    versions = await service.list_versions(db, record.id)
    return [
        VersionOut(
            id=v.id,
            version_no=v.version_no,
            size=v.size,
            hash=v.hash,
            created_at=v.created_at,
            is_current=v.id == record.current_version_id,
        )
        for v in versions
    ]


@router.post("/{file_id}/versions/{version_id}/restore", response_model=FileOut)
async def restore_version(
    file_id: uuid.UUID, version_id: uuid.UUID, user: CurrentUser, db: DbDep
) -> FileOut:
    try:
        record = await service.restore_version(db, user, file_id, version_id)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    except service.FileVersionNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found") from None
    return FileOut.model_validate(record)


@router.delete("/{file_id}/versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_version(
    file_id: uuid.UUID, version_id: uuid.UUID, user: CurrentUser, db: DbDep
) -> None:
    try:
        await service.delete_version(db, user, file_id, version_id)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    except service.CannotDeleteCurrentVersion:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Cannot delete the current version — restore another first"
        ) from None
    except FloodWaitError as exc:
        raise _flood(exc) from exc


@router.get("/{file_id}/versions/{version_id}/content")
async def download_version(
    file_id: uuid.UUID, version_id: uuid.UUID, request: Request, user: CurrentUser, db: DbDep
) -> Response:
    try:
        record = await service.get_owned_file(db, user, file_id)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    version = await db.get(FileVersion, version_id)
    if version is None or version.file_id != record.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    account = await service.account_for_file(db, user, record)
    if account is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Storage provider is not connected")
    ref = StoredObjectRef(
        provider=record.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    return await stream_object(
        get_provider(record.provider),
        account,
        ref,
        filename=record.name,
        mime=record.mime,
        etag=version.hash,
        request=request,
    )


@router.patch("/{file_id}", response_model=FileOut)
async def rename_file(
    file_id: uuid.UUID, payload: RenameRequest, user: CurrentUser, db: DbDep
) -> FileOut:
    record = await db.get(File, file_id)
    if record is None or record.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name cannot be empty")
    record.name = name
    # Keep ext in sync with the (possibly new) extension in the display name.
    if "." in name:
        record.ext = name.rpartition(".")[2].lower()
    await db.commit()
    await db.refresh(record)
    return FileOut.model_validate(record)


@router.post("/{file_id}/move", response_model=FileOut)
async def move_file(
    file_id: uuid.UUID, payload: MoveRequest, user: CurrentUser, db: DbDep
) -> FileOut:
    record = await db.get(File, file_id)
    if record is None or record.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    if payload.folder_id is not None:
        folder = await db.get(Folder, payload.folder_id)
        if folder is None or folder.owner_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    record.folder_id = payload.folder_id
    await db.commit()
    await db.refresh(record)
    return FileOut.model_validate(record)


@router.put("/{file_id}/favorite", response_model=FileOut)
async def set_favorite(
    file_id: uuid.UUID, payload: FavoriteRequest, user: CurrentUser, db: DbDep
) -> FileOut:
    try:
        record = await service.set_favorite(db, user, file_id, payload.favorite)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    return FileOut.model_validate(record)


@router.post("/{file_id}/tags", response_model=FileOut)
async def add_tag(
    file_id: uuid.UUID, payload: TagRequest, user: CurrentUser, db: DbDep
) -> FileOut:
    try:
        record = await service.add_tag(db, user, file_id, payload.name)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    return FileOut.model_validate(record)


@router.delete("/{file_id}/tags/{name}", response_model=FileOut)
async def remove_tag(file_id: uuid.UUID, name: str, user: CurrentUser, db: DbDep) -> FileOut:
    try:
        record = await service.remove_tag(db, user, file_id, name)
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    return FileOut.model_validate(record)
