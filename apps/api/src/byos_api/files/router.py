from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import FloodWaitError

from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db
from byos_api.db.models import File, FileVersion, Folder
from byos_api.files import service
from byos_api.files.schemas import FileOut
from byos_api.storage import StoredObjectRef, get_provider

logger = logging.getLogger("byos")
router = APIRouter(prefix="/files", tags=["files"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
_UPLOAD_CHUNK = 1024 * 1024


def _flood(exc: FloodWaitError) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS, f"Telegram rate limit — retry in {exc.seconds}s"
    )


async def _aclose(stream: AsyncIterator[bytes]) -> None:
    aclose = getattr(stream, "aclose", None)
    if aclose is not None:
        await aclose()


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

    provider_name, account, storage_account_id = await service.resolve_upload_target(db, user)
    provider = get_provider(provider_name)
    filename = file.filename or "upload.bin"

    async def _stream():
        while chunk := await file.read(_UPLOAD_CHUNK):
            yield chunk

    try:
        ref = await provider.upload(
            account, _stream(), filename=filename, size=file.size or 0, mime=file.content_type
        )
    except FloodWaitError as exc:
        raise _flood(exc) from exc

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


@router.get("", response_model=list[FileOut])
async def list_files(
    user: CurrentUser, db: DbDep, folder_id: uuid.UUID | None = None
) -> list[FileOut]:
    stmt = select(File).where(File.owner_id == user.id)
    # Scope to a folder; absence means the root (files with no folder).
    stmt = (
        stmt.where(File.folder_id == folder_id)
        if folder_id is not None
        else stmt.where(File.folder_id.is_(None))
    )
    result = await db.execute(stmt.order_by(File.created_at.desc()))
    return [FileOut.model_validate(f) for f in result.scalars()]


@router.get("/{file_id}/content")
async def download_file(file_id: uuid.UUID, user: CurrentUser, db: DbDep) -> StreamingResponse:
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

    provider = get_provider(record.provider)
    ref = StoredObjectRef(
        provider=record.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    stream = provider.download(account, ref)

    # Pull the first chunk now so provider errors surface as a real status code
    # instead of a truncated body under an already-sent 200.
    try:
        first_chunk = await stream.__anext__()
        exhausted = False
    except StopAsyncIteration:
        first_chunk, exhausted = b"", True
    except FileNotFoundError:
        await _aclose(stream)
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "File content no longer exists in the provider"
        ) from None
    except FloodWaitError as exc:
        await _aclose(stream)
        raise _flood(exc) from exc

    async def body():
        if not exhausted:
            yield first_chunk
        async for chunk in stream:
            yield chunk

    headers = {"Content-Disposition": f'attachment; filename="{record.name}"'}
    return StreamingResponse(
        body(), media_type=record.mime or "application/octet-stream", headers=headers
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(file_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    record = await db.get(File, file_id)
    if record is None or record.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")

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

    record.current_version_id = None
    await db.flush()
    await db.delete(record)  # cascades to file_versions
    await db.commit()
