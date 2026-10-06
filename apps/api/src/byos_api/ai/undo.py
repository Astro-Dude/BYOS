"""Undoing an applied plan: every change put back the way it was.

Applying a plan now records what each change replaced (a file's name and folder,
a folder's name and parent) next to its outcome, so undo restores exactly that.
Plans applied before that have no such record; for those the old values come
from what the plan stored anyway: a rename's label carries the old name, and the
preview saved with the chat message says which folder each moved file came from.

Undo runs in reverse of the order the plan was applied in, so files leave the
new folders before those folders go, and a folder the plan created is removed
only once it's empty. Deletes and share links can't be taken back; they're
reported as such rather than skipped silently.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import tools
from byos_api.db.models import File, Folder, User
from byos_api.files import service as files_service
from byos_api.folders import service as folders_service

NOT_UNDOABLE = {
    "delete_file": "a deleted file can't be brought back",
    "delete_folder": "a deleted folder can't be brought back",
    "create_share_link": "revoke the share link from Links instead",
    "create_alias": "remove the alias from Links instead",
}


async def snapshot(db: AsyncSession, user: User, action: dict[str, Any]) -> dict[str, Any] | None:
    """What a change is about to replace, recorded with its outcome at apply time."""
    op, args = action.get("op"), action.get("args") or {}
    try:
        if op in {"rename_file", "move_file", "set_favorite"}:
            record = await files_service.get_owned_file(
                db, user, uuid.UUID(str(args.get("file_id")))
            )
            return {
                "name": record.name,
                "folder_id": str(record.folder_id) if record.folder_id else None,
                "favorite": record.is_favorite,
            }
        if op in {"rename_folder", "move_folder"}:
            folder = await folders_service.get_owned_folder(
                db, user, uuid.UUID(str(args.get("folder_id")))
            )
            return {
                "name": folder.name,
                "parent_id": str(folder.parent_id) if folder.parent_id else None,
            }
    except (ValueError, files_service.FileNotFound, folders_service.FolderNotFound):
        return None
    return None


_RENAMED_FROM = re.compile(r"^Rename (?:folder )?(.+?) → “")


def _old_name_from_label(label: str) -> str | None:
    """ "Rename OLD → “NEW”" (and the folder form): the name before the rename."""
    m = _RENAMED_FROM.match(label or "")
    return m.group(1) if m else None


async def _folder_at(db: AsyncSession, user: User, path: str) -> uuid.UUID | None:
    """The folder at a path like "/Finance/Payslips" (None for the root), by name,
    as the drive is now. Raises LookupError if any part is missing."""
    parent: uuid.UUID | None = None
    for part in [p for p in (path or "/").split("/") if p]:
        found = (
            (
                await db.execute(
                    select(Folder.id).where(
                        Folder.owner_id == user.id,
                        Folder.parent_id.is_(None)
                        if parent is None
                        else Folder.parent_id == parent,
                        func.lower(Folder.name) == part.lower(),
                    )
                )
            )
            .scalars()
            .first()
        )
        if found is None:
            raise LookupError(path)
        parent = found
    return parent


def origins_from_preview(preview: dict[str, Any] | None) -> dict[str, str]:
    """File name (before and after the plan) → the folder path it came from, read
    from a stored plan preview. For plans applied before snapshots existed."""
    out: dict[str, str] = {}

    def walk(node: dict[str, Any]) -> None:
        for f in node.get("files") or []:
            if f.get("from"):
                out[str(f["name"])] = str(f["from"])
                if f.get("was"):
                    out[str(f["was"])] = str(f["from"])
        for child in node.get("children") or []:
            walk(child)

    if preview and isinstance(preview.get("root"), dict):
        walk(preview["root"])
    return out


async def undo_action(
    db: AsyncSession,
    user: User,
    action: dict[str, Any],
    outcome: dict[str, Any],
    origins: dict[str, str],
) -> str:
    """Reverse one applied change. Raises tools.ToolError with a plain reason when
    it can't be."""
    op, args = str(action.get("op")), action.get("args") or {}
    before = outcome.get("before") or {}
    if op in NOT_UNDOABLE:
        raise tools.ToolError(NOT_UNDOABLE[op])
    try:
        if op == "rename_file":
            old = before.get("name") or _old_name_from_label(str(action.get("label", "")))
            if not old:
                raise tools.ToolError("the old name wasn't recorded")
            await files_service.rename_file(db, user, uuid.UUID(str(args["file_id"])), old)
            return f"renamed back to {old}"
        if op == "move_file":
            file_id = uuid.UUID(str(args["file_id"]))
            if "folder_id" in before:
                target = uuid.UUID(before["folder_id"]) if before["folder_id"] else None
            else:
                record = await files_service.get_owned_file(db, user, file_id)
                path = origins.get(record.name)
                if path is None:
                    raise tools.ToolError("where it came from wasn't recorded")
                try:
                    target = await _folder_at(db, user, path)
                except LookupError:
                    raise tools.ToolError(f"its old folder {path} no longer exists") from None
            await files_service.move_file(db, user, file_id, target)
            return "moved back"
        if op == "add_tag":
            await files_service.remove_tag(
                db, user, uuid.UUID(str(args["file_id"])), str(args.get("name") or "")
            )
            return "tag removed"
        if op == "remove_tag":
            await files_service.add_tag(
                db, user, uuid.UUID(str(args["file_id"])), str(args.get("name") or "")
            )
            return "tag put back"
        if op == "set_favorite":
            was = before.get("favorite", not bool(args.get("favorite")))
            await files_service.set_favorite(db, user, uuid.UUID(str(args["file_id"])), bool(was))
            return "star put back"
        if op == "rename_folder":
            old = before.get("name") or _old_name_from_label(str(action.get("label", "")))
            if not old:
                raise tools.ToolError("the old name wasn't recorded")
            # The label carries a path; the folder's own name is its last part.
            old = old.rstrip("/").rsplit("/", 1)[-1]
            await folders_service.update_folder(
                db, user, uuid.UUID(str(args["folder_id"])), {"name": old}
            )
            return f"renamed back to {old}"
        if op == "move_folder":
            if "parent_id" not in before:
                raise tools.ToolError("its old place wasn't recorded")
            parent = uuid.UUID(before["parent_id"]) if before["parent_id"] else None
            await folders_service.move_folder(db, user, uuid.UUID(str(args["folder_id"])), parent)
            return "moved back"
        if op == "create_folder":
            folder_id = outcome.get("folder_id")
            if not folder_id:
                raise tools.ToolError("which folder it made wasn't recorded")
            fid = uuid.UUID(str(folder_id))
            has_files = (
                await db.execute(
                    select(File.id).where(File.owner_id == user.id, File.folder_id == fid).limit(1)
                )
            ).first()
            has_folders = (
                await db.execute(
                    select(Folder.id)
                    .where(Folder.owner_id == user.id, Folder.parent_id == fid)
                    .limit(1)
                )
            ).first()
            if has_files or has_folders:
                raise tools.ToolError("kept: it isn't empty")
            await folders_service.delete_folder(db, user, fid)
            return "removed"
    except (files_service.FileNotFound, folders_service.FolderNotFound):
        raise tools.ToolError("it no longer exists") from None
    except (files_service.TargetFolderNotFound, folders_service.InvalidMove):
        raise tools.ToolError("its old place can't take it back") from None
    raise tools.ToolError(f"can't undo '{op}'")
