from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.analytics.recorder import record_event
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
        visibility=share.visibility,
        has_password=share.password_hash is not None,
        expires_at=share.expires_at,
        max_downloads=share.max_downloads,
        download_count=share.download_count,
        view_only=share.view_only,
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
            password=payload.password,
            expires_in_days=payload.expires_in_days,
            max_downloads=payload.max_downloads,
            view_only=payload.view_only,
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
async def open_share(
    token: str, request: Request, db: DbDep, pw: str | None = None
) -> Response:
    """PUBLIC: stream a shared file's current version, enforcing access controls."""
    try:
        share, file, version = await service.resolve_share(db, token, pw)
    except service.ShareNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found") from None
    except service.ShareExpired:
        raise HTTPException(status.HTTP_410_GONE, "This link has expired") from None
    except service.ShareLimitReached:
        raise HTTPException(status.HTTP_410_GONE, "This link's download limit is reached") from None
    except service.SharePasswordRequired:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Password required (append ?pw=...)"
        ) from None

    account = await files_service.account_for_file_public(db, file)
    if account is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The owner's storage is not connected")

    ref = StoredObjectRef(
        provider=file.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    await record_event(
        request,
        owner_id=share.owner_id,
        target_type="share",
        target_id=share.id,
        event_type="view" if share.view_only else "download",
    )
    if not share.view_only:
        await service.register_download(db, share)
    return await stream_object(
        get_provider(file.provider),
        account,
        ref,
        filename=file.name,
        mime=file.mime,
        disposition="inline" if share.view_only else "attachment",
        etag=version.hash,
        request=request,
    )
