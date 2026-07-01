"""Folder tree operations on the adjacency-list schema. Ancestor (breadcrumb)
and subtree (cycle-check) queries use recursive CTEs, all owner-scoped."""

from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.db.models import Folder, User


class FolderNotFound(Exception):
    pass


class InvalidMove(Exception):
    pass


async def get_owned_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> Folder:
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise FolderNotFound
    return folder


async def create_folder(
    db: AsyncSession, user: User, name: str, parent_id: uuid.UUID | None
) -> Folder:
    if parent_id is not None:
        await get_owned_folder(db, user, parent_id)  # validates ownership + existence
    folder = Folder(owner_id=user.id, parent_id=parent_id, name=name)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def list_children(
    db: AsyncSession, user: User, parent_id: uuid.UUID | None
) -> list[Folder]:
    stmt = select(Folder).where(Folder.owner_id == user.id)
    stmt = (
        stmt.where(Folder.parent_id == parent_id)
        if parent_id is not None
        else stmt.where(Folder.parent_id.is_(None))
    )
    result = await db.execute(stmt.order_by(Folder.name))
    return list(result.scalars())


async def rename_folder(
    db: AsyncSession, user: User, folder_id: uuid.UUID, name: str
) -> Folder:
    folder = await get_owned_folder(db, user, folder_id)
    folder.name = name
    await db.commit()
    await db.refresh(folder)
    return folder


async def _in_subtree(
    db: AsyncSession, user: User, root_id: uuid.UUID, candidate_id: uuid.UUID
) -> bool:
    """True if candidate_id is root_id itself or any descendant of root_id."""
    result = await db.execute(
        text(
            """
            WITH RECURSIVE sub AS (
                SELECT id FROM folders WHERE id = :root AND owner_id = :owner
                UNION ALL
                SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
                WHERE f.owner_id = :owner
            )
            SELECT 1 FROM sub WHERE id = :cand LIMIT 1
            """
        ),
        {"root": root_id, "cand": candidate_id, "owner": user.id},
    )
    return result.first() is not None


async def move_folder(
    db: AsyncSession, user: User, folder_id: uuid.UUID, new_parent_id: uuid.UUID | None
) -> Folder:
    folder = await get_owned_folder(db, user, folder_id)
    if new_parent_id is not None:
        await get_owned_folder(db, user, new_parent_id)  # validate target ownership
        # Reject moving a folder into itself or one of its own descendants.
        if await _in_subtree(db, user, folder_id, new_parent_id):
            raise InvalidMove
    folder.parent_id = new_parent_id
    await db.commit()
    await db.refresh(folder)
    return folder


async def delete_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> None:
    folder = await get_owned_folder(db, user, folder_id)
    # Subfolders cascade (FK); files under this folder become root (folder_id → NULL).
    await db.delete(folder)
    await db.commit()


async def breadcrumb(
    db: AsyncSession, user: User, folder_id: uuid.UUID
) -> list[dict[str, object]]:
    result = await db.execute(
        text(
            """
            WITH RECURSIVE anc AS (
                SELECT id, name, parent_id, 0 AS depth
                FROM folders WHERE id = :fid AND owner_id = :owner
                UNION ALL
                SELECT f.id, f.name, f.parent_id, anc.depth + 1
                FROM folders f JOIN anc ON f.id = anc.parent_id
                WHERE f.owner_id = :owner
            )
            SELECT id, name FROM anc ORDER BY depth DESC
            """
        ),
        {"fid": folder_id, "owner": user.id},
    )
    return [{"id": row.id, "name": row.name} for row in result]
