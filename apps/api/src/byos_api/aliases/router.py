from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.aliases import service
from byos_api.aliases.schemas import (
    AliasCreate,
    AliasOut,
    AliasUpdate,
    PublicFolderView,
    PublicMeta,
)
from byos_api.auth.dependencies import CurrentUser, api_key_rate_limit, require_scope
from byos_api.core.config import get_settings
from byos_api.core.db import get_db
from byos_api.core.ratelimit import limit
from byos_api.db.models import Alias
from byos_api.files import service as files_service
from byos_api.storage import StoredObjectRef, get_provider
from byos_api.streaming import stream_object

router = APIRouter(
    prefix="/aliases",
    tags=["aliases"],
    dependencies=[Depends(require_scope("aliases")), Depends(api_key_rate_limit)],
)
public_api_router = APIRouter(prefix="/public", tags=["public"])
public_router = APIRouter(tags=["aliases"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

_settings = get_settings()
_public_limit = limit("alias", _settings.public_rate_limit, _settings.public_rate_window)


def _alias_out(alias: Alias) -> AliasOut:
    return AliasOut(
        id=alias.id,
        slug=alias.slug,
        target_type=service.target_type(alias),
        file_id=alias.file_id,
        folder_id=alias.folder_id,
        description=alias.description,
        created_at=alias.created_at,
    )


@router.post("", response_model=AliasOut, status_code=status.HTTP_201_CREATED)
async def create_alias(payload: AliasCreate, user: CurrentUser, db: DbDep) -> AliasOut:
    try:
        alias = await service.create_alias(
            db,
            user,
            payload.slug,
            payload.file_id,
            payload.description,
            folder_id=payload.folder_id,
        )
    except service.InvalidSlug:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Slug must be lowercase letters, digits, and hyphens",
        ) from None
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    except service.FolderNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found") from None
    except service.SlugTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That alias is already taken") from None
    except service.FileAlreadyLinked:
        raise HTTPException(status.HTTP_409_CONFLICT, "This file already has a link") from None
    except service.FolderAlreadyLinked:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This folder already has a link"
        ) from None
    return _alias_out(alias)


@router.get("", response_model=list[AliasOut])
async def list_aliases(user: CurrentUser, db: DbDep) -> list[AliasOut]:
    return [
        AliasOut(
            id=a.id,
            slug=a.slug,
            target_type=ttype,
            file_id=a.file_id,
            folder_id=a.folder_id,
            description=a.description,
            created_at=a.created_at,
            parent_folder_id=parent_folder_id,
            target_name=target_name,
        )
        for (a, ttype, parent_folder_id, target_name) in await service.list_aliases(db, user)
    ]


@router.patch("/{alias_id}", response_model=AliasOut)
async def update_alias(
    alias_id: uuid.UUID, payload: AliasUpdate, user: CurrentUser, db: DbDep
) -> AliasOut:
    try:
        alias = await service.update_alias(
            db, user, alias_id, payload.slug, payload.file_id, payload.description
        )
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alias not found") from None
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    except service.InvalidSlug:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Slug must be lowercase letters, digits, and hyphens"
        ) from None
    except service.SlugTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That alias is already taken") from None
    return _alias_out(alias)


@router.delete("/{alias_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alias(alias_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    try:
        await service.delete_alias(db, user, alias_id)
    except service.AliasNotFound:
        return  # idempotent


# ---- Public folder browsing (JSON) ----


@public_api_router.get(
    "/{username}/{slug}", response_model=PublicMeta, dependencies=[Depends(_public_limit)]
)
async def public_meta(username: str, slug: str, db: DbDep) -> PublicMeta:
    try:
        alias, owner = await service.resolve_meta(db, username, slug)
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found") from None
    ttype = service.target_type(alias)
    name = ""
    if ttype == "folder" and alias.folder_id is not None:
        from byos_api.db.models import Folder

        folder = await db.get(Folder, alias.folder_id)
        name = folder.name if folder else slug
    return PublicMeta(type=ttype, name=name, owner_username=owner.username or username)


@public_api_router.get(
    "/{username}/{slug}/list",
    response_model=PublicFolderView,
    dependencies=[Depends(_public_limit)],
)
async def public_list(
    username: str, slug: str, db: DbDep, folder_id: uuid.UUID | None = None
) -> PublicFolderView:
    try:
        return await service.public_folder_view(db, username, slug, folder_id)
    except service.NotAFolderAlias:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a folder link") from None
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found") from None


@public_api_router.get("/{username}/{slug}/file/{file_id}", dependencies=[Depends(_public_limit)])
async def public_folder_file(
    username: str,
    slug: str,
    file_id: uuid.UUID,
    request: Request,
    db: DbDep,
    dl: bool = False,
) -> Response:
    """PUBLIC: stream a single file that lives inside a shared folder."""
    try:
        file, version = await service.public_file_in_share(db, username, slug, file_id)
    except service.NotAFolderAlias:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a folder link") from None
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found") from None

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

    async def _mark_missing() -> None:
        file.missing_at = datetime.now(UTC)
        await db.commit()

    return await stream_object(
        get_provider(file.provider),
        account,
        ref,
        filename=file.name,
        mime=file.mime,
        disposition="attachment" if dl else "inline",
        etag=version.hash,
        request=request,
        on_missing=_mark_missing,
    )


# ---- Public alias resolution (catch-all; MUST be included last) ----


@public_router.get("/{username}/{slug}", dependencies=[Depends(_public_limit)])
async def resolve_alias(username: str, slug: str, request: Request, db: DbDep) -> Response:
    """PUBLIC (unauthenticated): file aliases stream inline; folder aliases
    redirect to the browsable page on the web app."""
    try:
        alias, file, version = await service.resolve(db, username, slug)
    except service.NotAFolderAlias:
        # Folder link — send the visitor to the browsable web page.
        base = _settings.web_base_url.rstrip("/")
        return RedirectResponse(url=f"{base}/{username}/{slug}", status_code=302)
    except service.AliasNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alias not found") from None

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

    async def _mark_missing() -> None:
        file.missing_at = datetime.now(UTC)
        await db.commit()

    return await stream_object(
        get_provider(file.provider),
        account,
        ref,
        filename=file.name,
        mime=file.mime,
        disposition="inline",
        etag=version.hash,
        request=request,
        on_missing=_mark_missing,
    )
