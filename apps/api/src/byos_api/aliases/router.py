from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.aliases import service
from byos_api.aliases.schemas import AliasCreate, AliasOut, AliasUpdate
from byos_api.analytics.recorder import record_event
from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db
from byos_api.files import service as files_service
from byos_api.storage import StoredObjectRef, get_provider
from byos_api.streaming import stream_object

router = APIRouter(prefix="/aliases", tags=["aliases"])
public_router = APIRouter(tags=["aliases"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


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
async def resolve_alias(slug: str, request: Request, db: DbDep) -> Response:
    """PUBLIC (unauthenticated): stream the current version of the aliased file."""
    try:
        alias, file, version = await service.resolve(db, slug)
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alias not found") from None

    await record_event(
        request,
        owner_id=alias.owner_id,
        target_type="alias",
        target_id=alias.id,
        event_type="view",
    )
    account = await files_service.account_for_file_public(db, file)
    if account is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The file owner's storage provider is not connected"
        )

    ref = StoredObjectRef(
        provider=file.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    return await stream_object(
        get_provider(file.provider),
        account,
        ref,
        filename=file.name,
        mime=file.mime,
        disposition="inline",
        etag=version.hash,
        request=request,
    )
