from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import FloodWaitError

from byos_api.aliases import service
from byos_api.aliases.schemas import AliasCreate, AliasOut, AliasUpdate
from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db
from byos_api.files import service as files_service
from byos_api.storage import StoredObjectRef, get_provider

router = APIRouter(prefix="/aliases", tags=["aliases"])
public_router = APIRouter(tags=["aliases"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def _aclose(stream: AsyncIterator[bytes]) -> None:
    aclose = getattr(stream, "aclose", None)
    if aclose is not None:
        await aclose()


@router.post("", response_model=AliasOut, status_code=status.HTTP_201_CREATED)
async def create_alias(payload: AliasCreate, user: CurrentUser, db: DbDep) -> AliasOut:
    try:
        alias = await service.create_alias(
            db, user, payload.slug, payload.file_id, payload.description
        )
    except service.InvalidSlug:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Slug must be lowercase letters, digits, and hyphens",
        ) from None
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    except service.SlugTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That alias is already taken") from None
    return AliasOut.model_validate(alias)


@router.get("", response_model=list[AliasOut])
async def list_aliases(user: CurrentUser, db: DbDep) -> list[AliasOut]:
    return [AliasOut.model_validate(a) for a in await service.list_aliases(db, user)]


@router.patch("/{alias_id}", response_model=AliasOut)
async def update_alias(
    alias_id: uuid.UUID, payload: AliasUpdate, user: CurrentUser, db: DbDep
) -> AliasOut:
    try:
        alias = await service.update_alias(
            db, user, alias_id, payload.file_id, payload.description
        )
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alias not found") from None
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    return AliasOut.model_validate(alias)


@router.delete("/{alias_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alias(alias_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    try:
        await service.delete_alias(db, user, alias_id)
    except service.AliasNotFound:
        return  # idempotent


@public_router.get("/a/{slug}")
async def resolve_alias(slug: str, db: DbDep) -> StreamingResponse:
    """PUBLIC (unauthenticated): stream the current version of the aliased file."""
    try:
        _, file, version = await service.resolve(db, slug)
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alias not found") from None

    account = await files_service.account_for_file_public(db, file)
    if account is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The file owner's storage provider is not connected"
        )

    provider = get_provider(file.provider)
    ref = StoredObjectRef(
        provider=file.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    stream = provider.download(account, ref)
    try:
        first_chunk = await stream.__anext__()
        exhausted = False
    except StopAsyncIteration:
        first_chunk, exhausted = b"", True
    except FileNotFoundError:
        await _aclose(stream)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content no longer exists") from None
    except FloodWaitError as exc:
        await _aclose(stream)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, f"Rate limited — retry in {exc.seconds}s"
        ) from exc

    async def body():
        if not exhausted:
            yield first_chunk
        async for chunk in stream:
            yield chunk

    headers = {"Content-Disposition": f'inline; filename="{file.name}"'}
    return StreamingResponse(
        body(), media_type=file.mime or "application/octet-stream", headers=headers
    )
