"""Folder tree operations on the adjacency-list schema. Ancestor (breadcrumb)
and subtree (cycle-check) queries use recursive CTEs, all owner-scoped."""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.db.models import File, FileVersion, Folder, User
from byos_api.files import service as files_service
from byos_api.storage import StoredObjectRef, get_provider

logger = logging.getLogger("byos")


async def subtree_sizes(db: AsyncSession, user: User) -> dict[uuid.UUID, int]:
    """Total bytes contained in each folder, including all nested subfolders.
    Two queries + an in-memory roll-up (folder/file counts per user are small)."""
    rows = (
        await db.execute(
            select(File.folder_id, func.coalesce(func.sum(File.size), 0))
            .where(File.owner_id == user.id, File.folder_id.is_not(None))
            .group_by(File.folder_id)
        )
    ).all()
    direct = {fid: int(total) for fid, total in rows}

    folder_rows = (
        await db.execute(
            select(Folder.id, Folder.parent_id).where(Folder.owner_id == user.id)
        )
    ).all()
    children: dict[uuid.UUID | None, list[uuid.UUID]] = defaultdict(list)
    for fid, pid in folder_rows:
        children[pid].append(fid)

    sizes: dict[uuid.UUID, int] = {}

    def roll_up(fid: uuid.UUID) -> int:
        total = direct.get(fid, 0)
        for child in children.get(fid, []):
            total += roll_up(child)
        sizes[fid] = total
        return total

    all_ids = {fid for fid, _ in folder_rows}
    for fid, pid in folder_rows:
        if pid is None or pid not in all_ids:  # start from roots
            roll_up(fid)
    return sizes


async def list_children_with_sizes(
    db: AsyncSession, user: User, parent_id: uuid.UUID | None
) -> list[tuple[Folder, int]]:
    """Direct children of a folder + each one's recursive byte total, in TWO
    queries (all folders once + file sums), rolled up in memory. Replaces
    list_children + subtree_sizes (which was 3 queries) for the listing path."""
    all_folders = (
        (await db.execute(select(Folder).where(Folder.owner_id == user.id))).scalars().all()
    )
    sums = (
        await db.execute(
            select(File.folder_id, func.coalesce(func.sum(File.size), 0))
            .where(File.owner_id == user.id, File.folder_id.is_not(None))
            .group_by(File.folder_id)
        )
    ).all()
    direct = {fid: int(total) for fid, total in sums}
    children: dict[uuid.UUID | None, list[uuid.UUID]] = defaultdict(list)
    for f in all_folders:
        children[f.parent_id].append(f.id)

    sizes: dict[uuid.UUID, int] = {}

    def roll_up(fid: uuid.UUID) -> int:
        total = direct.get(fid, 0)
        for child in children.get(fid, []):
            total += roll_up(child)
        sizes[fid] = total
        return total

    ids = {f.id for f in all_folders}
    for f in all_folders:
        if f.parent_id is None or f.parent_id not in ids:
            roll_up(f.id)

    kids = sorted(
        (f for f in all_folders if f.parent_id == parent_id), key=lambda f: f.name.lower()
    )
    return [(f, sizes.get(f.id, 0)) for f in kids]


class FolderNotFound(Exception):
    pass


class InvalidMove(Exception):
    pass


class InvalidColor(Exception):
    pass


# Vibrant, theme-matching palette folders may be tagged with. Keep in sync with
# the web app's allow-list in apps/web/lib/folder-colors.ts.
FOLDER_COLORS = {
    "#6366F1",  # indigo
    "#3B82F6",  # blue
    "#06B6D4",  # cyan
    "#10B981",  # emerald
    "#F59E0B",  # amber
    "#F43F5E",  # rose
    "#8B5CF6",  # violet
    "#64748B",  # slate
}


async def subtree_folder_ids(
    db: AsyncSession, user: User, root_id: uuid.UUID
) -> set[uuid.UUID]:
    """All folder ids in the subtree rooted at root_id (inclusive), owner-scoped."""
    rows = (
        await db.execute(
            select(Folder.id, Folder.parent_id).where(Folder.owner_id == user.id)
        )
    ).all()
    children: dict[uuid.UUID | None, list[uuid.UUID]] = defaultdict(list)
    for fid, pid in rows:
        children[pid].append(fid)
    result: set[uuid.UUID] = set()
    stack = [root_id]
    while stack:
        cur = stack.pop()
        if cur in result:
            continue
        result.add(cur)
        stack.extend(children.get(cur, []))
    return result


async def search_folders(
    db: AsyncSession, user: User, query: str, limit: int = 20
) -> list[Folder]:
    """Case-insensitive substring match on folder names, owner-scoped."""
    q = query.strip()
    if not q:
        return []
    stmt = (
        select(Folder)
        .where(Folder.owner_id == user.id, Folder.name.ilike(f"%{q}%"))
        .order_by(Folder.name)
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars())


async def get_owned_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> Folder:
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise FolderNotFound
    return folder


async def create_folder(
    db: AsyncSession,
    user: User,
    name: str,
    parent_id: uuid.UUID | None,
    color: str | None = None,
) -> Folder:
    if parent_id is not None:
        await get_owned_folder(db, user, parent_id)  # validates ownership + existence
    if color is not None and color not in FOLDER_COLORS:
        raise InvalidColor
    # Idempotency: a folder with the same name in the same parent already exists?
    existing = await db.execute(
        select(Folder).where(
            Folder.owner_id == user.id,
            Folder.parent_id == parent_id,
            Folder.name == name,
        )
    )
    found = existing.scalar_one_or_none()
    if found is not None:
        return found
    folder = Folder(owner_id=user.id, parent_id=parent_id, name=name, color=color)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def update_folder(
    db: AsyncSession, user: User, folder_id: uuid.UUID, updates: dict[str, object]
) -> Folder:
    """Apply only the fields present in `updates` (name and/or color). A color of
    None clears it; any other value must be in FOLDER_COLORS."""
    folder = await get_owned_folder(db, user, folder_id)
    if updates.get("name"):
        folder.name = str(updates["name"])
    if "color" in updates:
        color = updates["color"]
        if color is not None and color not in FOLDER_COLORS:
            raise InvalidColor
        folder.color = color  # type: ignore[assignment]
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


async def _delete_file_bytes(db: AsyncSession, user: User, record: File) -> None:
    """Best-effort removal of a file's stored objects from the provider. Never
    raises — a provider hiccup shouldn't block deleting the metadata."""
    try:
        account = await files_service.account_for_file(db, user, record)
        if account is None:
            return
        provider = get_provider(record.provider)
        versions = (
            await db.execute(select(FileVersion).where(FileVersion.file_id == record.id))
        ).scalars().all()
        for version in versions:
            await provider.delete(
                account,
                StoredObjectRef(
                    provider=record.provider,
                    locator=version.provider_locator,
                    size=version.size,
                ),
            )
    except Exception:
        logger.warning("provider cleanup failed for file %s during folder delete", record.id)


async def delete_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> None:
    folder = await get_owned_folder(db, user, folder_id)
    # Recursive delete: remove every file nested anywhere in this folder's
    # subtree (bytes + metadata), then delete the folder — its subfolders cascade
    # via the parent_id FK. Files are NOT orphaned to the root.
    ids = await subtree_folder_ids(db, user, folder_id)
    files = (
        await db.execute(select(File).where(File.owner_id == user.id, File.folder_id.in_(ids)))
    ).scalars().all()
    for record in files:
        await _delete_file_bytes(db, user, record)
        record.current_version_id = None
        await db.flush()
        await db.delete(record)  # cascades to file_versions
    await db.delete(folder)  # cascades to subfolders
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
