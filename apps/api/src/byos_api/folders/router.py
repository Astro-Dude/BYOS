from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import nl_search
from byos_api.auth.dependencies import CurrentUser, api_key_rate_limit, require_scope
from byos_api.core.db import get_db
from byos_api.db.models import Folder
from byos_api.folders import service
from byos_api.folders.schemas import (
    BreadcrumbItem,
    FolderCreate,
    FolderMove,
    FolderOut,
    FolderUpdate,
)

router = APIRouter(
    prefix="/folders",
    tags=["folders"],
    dependencies=[Depends(require_scope("folders")), Depends(api_key_rate_limit)],
)

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.post("", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(payload: FolderCreate, user: CurrentUser, db: DbDep) -> FolderOut:
    try:
        folder = await service.create_folder(
            db, user, payload.name, payload.parent_id, payload.color
        )
    except service.FolderNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Parent folder not found") from None
    except service.InvalidColor:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid folder color") from None
    return FolderOut.model_validate(folder)


@router.get("/search", response_model=list[FolderOut])
async def search_folders(
    user: CurrentUser,
    db: DbDep,
    q: str,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[FolderOut]:
    """Find folders by name. Operator tokens (type:, size:, …) are stripped;
    only the free-text part matches folder names."""
    query_text = nl_search.parse(q).text
    folders = await service.search_folders(db, user, query_text, limit)
    sizes = await service.subtree_sizes(db, user)
    return [_folder_out(f, sizes) for f in folders]


def _folder_out(folder: Folder, sizes: dict[uuid.UUID, int]) -> FolderOut:
    return FolderOut(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        color=folder.color,
        created_at=folder.created_at,
        size=sizes.get(folder.id, 0),
    )


@router.get("", response_model=list[FolderOut])
async def list_folders(
    user: CurrentUser, db: DbDep, parent_id: uuid.UUID | None = None
) -> list[FolderOut]:
    folders = await service.list_children(db, user, parent_id)
    sizes = await service.subtree_sizes(db, user)
    return [_folder_out(f, sizes) for f in folders]


@router.get("/{folder_id}/breadcrumb", response_model=list[BreadcrumbItem])
async def folder_breadcrumb(
    folder_id: uuid.UUID, user: CurrentUser, db: DbDep
) -> list[BreadcrumbItem]:
    try:
        await service.get_owned_folder(db, user, folder_id)
    except service.FolderNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found") from None
    return [BreadcrumbItem(**item) for item in await service.breadcrumb(db, user, folder_id)]


@router.patch("/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: uuid.UUID, payload: FolderUpdate, user: CurrentUser, db: DbDep
) -> FolderOut:
    try:
        folder = await service.update_folder(
            db, user, folder_id, payload.model_dump(exclude_unset=True)
        )
    except service.FolderNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found") from None
    except service.InvalidColor:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported folder color") from None
    return FolderOut.model_validate(folder)


@router.post("/{folder_id}/move", response_model=FolderOut)
async def move_folder(
    folder_id: uuid.UUID, payload: FolderMove, user: CurrentUser, db: DbDep
) -> FolderOut:
    try:
        folder = await service.move_folder(db, user, folder_id, payload.parent_id)
    except service.FolderNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found") from None
    except service.InvalidMove:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot move a folder into itself or a descendant"
        ) from None
    return FolderOut.model_validate(folder)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(folder_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    try:
        await service.delete_folder(db, user, folder_id)
    except service.FolderNotFound:
        return  # idempotent: nothing to delete for this user
