"""Dynamic aliases: a permanent, globally-unique slug that points at a logical
file. Public resolution follows the file's CURRENT version, so replacing the
file updates every shared /a/{slug} link without the URL changing."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.db.models import Alias, File, FileVersion, User

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")


class InvalidSlug(Exception):
    pass


class SlugTaken(Exception):
    pass


class FileAlreadyLinked(Exception):
    pass


class AliasNotFound(Exception):
    pass


class FileNotFound(Exception):
    pass


async def _owned_file(db: AsyncSession, user: User, file_id: uuid.UUID) -> File:
    file = await db.get(File, file_id)
    if file is None or file.owner_id != user.id:
        raise FileNotFound
    return file


async def create_alias(
    db: AsyncSession, user: User, slug: str, file_id: uuid.UUID, description: str | None
) -> Alias:
    if not SLUG_RE.match(slug):
        raise InvalidSlug
    await _owned_file(db, user, file_id)
    # One link per file: if this file already has an alias, don't make another.
    by_file = (
        await db.execute(
            select(Alias).where(Alias.owner_id == user.id, Alias.file_id == file_id)
        )
    ).scalar_one_or_none()
    if by_file is not None:
        if by_file.slug == slug:
            return by_file  # idempotent re-create of the same link
        raise FileAlreadyLinked
    # Slug must be free within this user's namespace.
    by_slug = (
        await db.execute(
            select(Alias).where(Alias.owner_id == user.id, Alias.slug == slug)
        )
    ).scalar_one_or_none()
    if by_slug is not None:
        raise SlugTaken
    alias = Alias(owner_id=user.id, slug=slug, file_id=file_id, description=description)
    db.add(alias)
    await db.commit()
    await db.refresh(alias)
    return alias


async def list_aliases(
    db: AsyncSession, user: User
) -> list[tuple[Alias, uuid.UUID | None, str | None]]:
    """Each alias with its linked file's folder_id + name (for 'go to file')."""
    result = await db.execute(
        select(Alias, File.folder_id, File.name)
        .join(File, File.id == Alias.file_id)
        .where(Alias.owner_id == user.id)
        .order_by(Alias.created_at.desc())
    )
    return [(row[0], row[1], row[2]) for row in result.all()]


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
    if file_id is not None:
        await _owned_file(db, user, file_id)  # repoint only to a file you own
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


async def resolve(db: AsyncSession, username: str, slug: str) -> tuple[Alias, File, FileVersion]:
    """Public resolution: username → owner, then their slug → file → CURRENT version."""
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
    file = await db.get(File, alias.file_id)
    if file is None or file.current_version_id is None:
        raise AliasNotFound
    version = await db.get(FileVersion, file.current_version_id)
    if version is None:
        raise AliasNotFound
    return alias, file, version
