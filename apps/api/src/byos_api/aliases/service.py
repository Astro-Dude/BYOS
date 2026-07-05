"""Dynamic aliases: a permanent, globally-unique slug that points at a logical
target — EITHER a file or a folder.

- File aliases resolve to the file's CURRENT version, so replacing the file
  updates every shared /{username}/{slug} link without the URL changing.
- Folder aliases resolve to a browsable public listing of the folder's subtree.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.aliases.schemas import PublicCrumb, PublicEntry, PublicFolderView
from byos_api.db.models import Alias, File, FileVersion, Folder, User

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")


class InvalidSlug(Exception):
    pass


class SlugTaken(Exception):
    pass


class FileAlreadyLinked(Exception):
    pass


class FolderAlreadyLinked(Exception):
    pass


class AliasNotFound(Exception):
    pass


class FileNotFound(Exception):
    pass


class FolderNotFound(Exception):
    pass


class NotAFolderAlias(Exception):
    pass


def target_type(alias: Alias) -> str:
    return "folder" if alias.folder_id is not None else "file"


async def _owned_file(db: AsyncSession, user: User, file_id: uuid.UUID) -> File:
    file = await db.get(File, file_id)
    if file is None or file.owner_id != user.id:
        raise FileNotFound
    return file


async def _owned_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> Folder:
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise FolderNotFound
    return folder


async def _slug_free(db: AsyncSession, user: User, slug: str) -> bool:
    existing = (
        await db.execute(select(Alias).where(Alias.owner_id == user.id, Alias.slug == slug))
    ).scalar_one_or_none()
    return existing is None


async def create_alias(
    db: AsyncSession,
    user: User,
    slug: str,
    file_id: uuid.UUID | None,
    description: str | None,
    folder_id: uuid.UUID | None = None,
) -> Alias:
    if not SLUG_RE.match(slug):
        raise InvalidSlug
    if (file_id is None) == (folder_id is None):
        raise InvalidSlug  # exactly one target required (also guarded in schema)

    if file_id is not None:
        await _owned_file(db, user, file_id)
        existing = (
            await db.execute(
                select(Alias).where(Alias.owner_id == user.id, Alias.file_id == file_id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.slug == slug:
                return existing  # idempotent re-create of the same link
            raise FileAlreadyLinked
    else:
        assert folder_id is not None
        await _owned_folder(db, user, folder_id)
        existing = (
            await db.execute(
                select(Alias).where(Alias.owner_id == user.id, Alias.folder_id == folder_id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.slug == slug:
                return existing
            raise FolderAlreadyLinked

    if not await _slug_free(db, user, slug):
        raise SlugTaken
    alias = Alias(
        owner_id=user.id,
        slug=slug,
        file_id=file_id,
        folder_id=folder_id,
        description=description,
    )
    db.add(alias)
    await db.commit()
    await db.refresh(alias)
    return alias


async def list_aliases(
    db: AsyncSession, user: User
) -> list[tuple[Alias, str, uuid.UUID | None, str | None]]:
    """Each alias with (target_type, parent_folder_id, target_name).

    For file aliases: parent_folder_id is where the file lives (go-to-file);
    target_name is the file name. For folder aliases: parent_folder_id is the
    shared folder's own id; target_name is the folder name.
    """
    aliases = (
        (
            await db.execute(
                select(Alias)
                .where(Alias.owner_id == user.id)
                .order_by(Alias.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    file_ids = [a.file_id for a in aliases if a.file_id is not None]
    folder_ids = [a.folder_id for a in aliases if a.folder_id is not None]
    files: dict[uuid.UUID, File] = {}
    folders: dict[uuid.UUID, Folder] = {}
    if file_ids:
        for f in (await db.execute(select(File).where(File.id.in_(file_ids)))).scalars():
            files[f.id] = f
    if folder_ids:
        for fo in (
            await db.execute(select(Folder).where(Folder.id.in_(folder_ids)))
        ).scalars():
            folders[fo.id] = fo

    out: list[tuple[Alias, str, uuid.UUID | None, str | None]] = []
    for a in aliases:
        if a.folder_id is not None:
            folder = folders.get(a.folder_id)
            out.append((a, "folder", a.folder_id, folder.name if folder else None))
        else:
            file = files.get(a.file_id) if a.file_id else None
            out.append((a, "file", file.folder_id if file else None, file.name if file else None))
    return out


async def update_alias(
    db: AsyncSession,
    user: User,
    alias_id: uuid.UUID,
    slug: str | None,
    file_id: uuid.UUID | None,
    description: str | None,
) -> Alias:
    alias = await db.get(Alias, alias_id)
    if alias is None or alias.owner_id != user.id:
        raise AliasNotFound
    if slug is not None and slug != alias.slug:
        if not SLUG_RE.match(slug):
            raise InvalidSlug
        clash = (
            await db.execute(
                select(Alias).where(Alias.owner_id == user.id, Alias.slug == slug)
            )
        ).scalar_one_or_none()
        if clash is not None and clash.id != alias.id:
            raise SlugTaken
        alias.slug = slug
    if file_id is not None and alias.file_id is not None:
        await _owned_file(db, user, file_id)  # repoint only file aliases, to a file you own
        alias.file_id = file_id
    if description is not None:
        alias.description = description
    await db.commit()
    await db.refresh(alias)
    return alias


async def delete_alias(db: AsyncSession, user: User, alias_id: uuid.UUID) -> None:
    alias = await db.get(Alias, alias_id)
    if alias is None or alias.owner_id != user.id:
        raise AliasNotFound
    await db.delete(alias)
    await db.commit()


async def _resolve_alias(db: AsyncSession, username: str, slug: str) -> tuple[Alias, User]:
    owner = (
        await db.execute(select(User).where(User.username == username.lower()))
    ).scalar_one_or_none()
    if owner is None:
        raise AliasNotFound
    alias = (
        await db.execute(
            select(Alias).where(Alias.owner_id == owner.id, Alias.slug == slug)
        )
    ).scalar_one_or_none()
    if alias is None:
        raise AliasNotFound
    return alias, owner


async def resolve_meta(db: AsyncSession, username: str, slug: str) -> tuple[Alias, User]:
    """Resolve a slug to its alias + owner without loading the target bytes."""
    return await _resolve_alias(db, username, slug)


async def resolve(db: AsyncSession, username: str, slug: str) -> tuple[Alias, File, FileVersion]:
    """Public resolution of a FILE alias → file → CURRENT version."""
    alias, _ = await _resolve_alias(db, username, slug)
    if alias.file_id is None:
        raise NotAFolderAlias  # this slug is a folder, not a streamable file
    file = await db.get(File, alias.file_id)
    if file is None or file.current_version_id is None:
        raise AliasNotFound
    version = await db.get(FileVersion, file.current_version_id)
    if version is None:
        raise AliasNotFound
    return alias, file, version


# ---- Public folder browsing ----


async def _subtree_folder_ids(
    db: AsyncSession, owner_id: uuid.UUID, root_id: uuid.UUID
) -> set[uuid.UUID]:
    """All folder ids in the subtree rooted at root_id (inclusive). Folder counts
    per user are small, so we load the owner's folders once and walk in memory."""
    rows = (
        await db.execute(
            select(Folder.id, Folder.parent_id).where(Folder.owner_id == owner_id)
        )
    ).all()
    children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for fid, pid in rows:
        children.setdefault(pid, []).append(fid)
    result: set[uuid.UUID] = set()
    stack = [root_id]
    while stack:
        cur = stack.pop()
        if cur in result:
            continue
        result.add(cur)
        stack.extend(children.get(cur, []))
    return result


async def public_folder_view(
    db: AsyncSession, username: str, slug: str, folder_id: uuid.UUID | None
) -> PublicFolderView:
    """List one level of a shared folder. folder_id defaults to the shared root;
    any requested folder must lie within the shared subtree."""
    alias, owner = await _resolve_alias(db, username, slug)
    if alias.folder_id is None:
        raise NotAFolderAlias
    root_id = alias.folder_id
    root = await db.get(Folder, root_id)
    if root is None:
        raise AliasNotFound
    subtree = await _subtree_folder_ids(db, owner.id, root_id)

    current_id = folder_id or root_id
    if current_id not in subtree:
        raise AliasNotFound  # outside the share — do not leak

    subfolders = (
        (
            await db.execute(
                select(Folder)
                .where(Folder.owner_id == owner.id, Folder.parent_id == current_id)
                .order_by(Folder.name)
            )
        )
        .scalars()
        .all()
    )
    files = (
        (
            await db.execute(
                select(File)
                .where(File.owner_id == owner.id, File.folder_id == current_id)
                .order_by(File.name)
            )
        )
        .scalars()
        .all()
    )

    # Breadcrumb: root → … → current (stops at the shared root).
    crumbs: list[PublicCrumb] = []
    walk: uuid.UUID | None = current_id
    seen: set[uuid.UUID] = set()
    while walk is not None and walk not in seen:
        seen.add(walk)
        fo = await db.get(Folder, walk)
        if fo is None:
            break
        crumbs.append(PublicCrumb(id=fo.id, name=root.name if fo.id == root_id else fo.name))
        if fo.id == root_id:
            break
        walk = fo.parent_id
    crumbs.reverse()

    return PublicFolderView(
        slug=slug,
        owner_username=owner.username or username,
        root_name=root.name,
        breadcrumb=crumbs,
        folders=[PublicEntry(id=f.id, name=f.name, type="folder") for f in subfolders],
        files=[
            PublicEntry(id=f.id, name=f.name, type="file", size=f.size, mime=f.mime, ext=f.ext)
            for f in files
        ],
    )


async def public_file_in_share(
    db: AsyncSession, username: str, slug: str, file_id: uuid.UUID
) -> tuple[File, FileVersion]:
    """Resolve a file for download within a shared folder, verifying it lives in
    the shared subtree so the link can't be used to read arbitrary files."""
    alias, owner = await _resolve_alias(db, username, slug)
    if alias.folder_id is None:
        raise NotAFolderAlias
    file = await db.get(File, file_id)
    if file is None or file.owner_id != owner.id or file.folder_id is None:
        raise AliasNotFound
    subtree = await _subtree_folder_ids(db, owner.id, alias.folder_id)
    if file.folder_id not in subtree:
        raise AliasNotFound
    if file.current_version_id is None:
        raise AliasNotFound
    version = await db.get(FileVersion, file.current_version_id)
    if version is None:
        raise AliasNotFound
    return file, version
