from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.audit import recorder as audit
from byos_api.auth.dependencies import CurrentUser
from byos_api.core.config import get_settings
from byos_api.core.db import get_db
from byos_api.core.ratelimit import limit
from byos_api.files import service as files_service
from byos_api.shares import service
from byos_api.shares.schemas import ShareCreate, ShareOut
from byos_api.storage import StoredObjectRef, get_provider
from byos_api.streaming import stream_object

router = APIRouter(prefix="/shares", tags=["shares"])
public_router = APIRouter(tags=["shares"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

_settings = get_settings()
_public_limit = limit("share", _settings.public_rate_limit, _settings.public_rate_window)


def _out(share) -> ShareOut:
    return ShareOut(
        id=share.id,
        file_id=share.file_id,
        token=share.token,
        expires_at=share.expires_at,
        download_count=share.download_count,
        created_at=share.created_at,
    )


@router.post("", response_model=ShareOut, status_code=status.HTTP_201_CREATED)
async def create_share(
    payload: ShareCreate, request: Request, user: CurrentUser, db: DbDep
) -> ShareOut:
    try:
        share = await service.create_share(
            db,
            user,
            file_id=payload.file_id,
            expires_in_days=payload.expires_in_days,
        )
    except service.FileNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found") from None
    await audit.record(
        user.id, "share.create", request=request, target_type="share", target_id=str(share.id)
    )
    return _out(share)


@router.get("", response_model=list[ShareOut])
async def list_shares(user: CurrentUser, db: DbDep) -> list[ShareOut]:
    return [_out(s) for s in await service.list_shares(db, user)]


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(share_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    await service.revoke_share(db, user, share_id)


@public_router.get("/s/{token}", dependencies=[Depends(_public_limit)])
async def open_share(token: str, request: Request, db: DbDep) -> Response:
    """PUBLIC: stream a shared file's current version, while the link is still good."""
    try:
        share, file, version = await service.resolve_share(db, token)
    except service.ShareNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found") from None
    except service.ShareExpired:
        raise HTTPException(status.HTTP_410_GONE, "This link has expired") from None

    account = await files_service.account_for_file_public(db, file)
    if account is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The owner's storage is not connected")

    ref = StoredObjectRef(
        provider=file.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    await service.register_download(db, share)
    return await stream_object(
        get_provider(file.provider),
        account,
        ref,
        filename=file.name,
        mime=file.mime,
        disposition="attachment",
        etag=version.hash,
        request=request,
        public=True,
    )
