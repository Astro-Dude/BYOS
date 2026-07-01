from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.apikeys import service
from byos_api.apikeys.schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyOut
from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db

router = APIRouter(prefix="/api-keys", tags=["api-keys"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.post("", response_model=ApiKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_api_key(payload: ApiKeyCreate, user: CurrentUser, db: DbDep) -> ApiKeyCreated:
    key, full = await service.create_key(db, user, payload.name)
    return ApiKeyCreated(key=full, api_key=ApiKeyOut.model_validate(key))


@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys(user: CurrentUser, db: DbDep) -> list[ApiKeyOut]:
    return [ApiKeyOut.model_validate(k) for k in await service.list_keys(db, user)]


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(key_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    await service.revoke_key(db, user, key_id)
