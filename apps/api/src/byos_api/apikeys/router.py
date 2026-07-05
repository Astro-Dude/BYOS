from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.apikeys import service
from byos_api.apikeys.schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyOut
from byos_api.audit import recorder as audit
from byos_api.auth.dependencies import SessionUser, get_session_user
from byos_api.core.db import get_db

# Account administration — issuing and revoking credentials — requires an
# interactive login, never an API key. That stops a leaked key from minting
# more keys or escalating its own access.
router = APIRouter(
    prefix="/api-keys", tags=["api-keys"], dependencies=[Depends(get_session_user)]
)

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.post("", response_model=ApiKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    payload: ApiKeyCreate, request: Request, user: SessionUser, db: DbDep
) -> ApiKeyCreated:
    try:
        key, full = await service.create_key(
            db, user, payload.name, payload.scopes, payload.expires_in_days
        )
    except service.InvalidScope:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid scope") from None
    except service.InvalidExpiry:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid expiry") from None
    await audit.record(
        user.id, "api_key.create", request=request, target_type="api_key", target_id=str(key.id)
    )
    return ApiKeyCreated(key=full, api_key=ApiKeyOut.model_validate(key))


@router.get("/scopes", response_model=list[str])
async def list_scopes() -> list[str]:
    """The permissions a key can be granted (for the create-key UI)."""
    return list(service.ALL_SCOPES)


@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys(user: SessionUser, db: DbDep) -> list[ApiKeyOut]:
    return [ApiKeyOut.model_validate(k) for k in await service.list_keys(db, user)]


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: uuid.UUID, request: Request, user: SessionUser, db: DbDep
) -> None:
    await service.revoke_key(db, user, key_id)
    await audit.record(
        user.id, "api_key.revoke", request=request, target_type="api_key", target_id=str(key_id)
    )
