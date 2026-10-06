"""Organizing the drive: the /organize command, and any request that reads
like one ("tidy up my downloads", "sort my files by year").

The settings become instructions for the agent, and the ones that forbid
something (no renaming, no tags) are also enforced by withholding those tools:
a model can't call a tool it was never offered, whatever it decides. Deleting
and sharing are never offered here at all; organizing only creates folders and
moves things.

A plan that reshapes the drive also gets a `preview`: the folder tree as it
will look once applied, so the user approves a structure rather than reading
a list of moves.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai.schemas import OrganizeOptions
from byos_api.ai.tools import NEW_REF_PREFIX, _folder_paths, is_new_ref
from byos_api.db.models import File, Folder, User

# More room than an ordinary turn: listing a whole drive and proposing a move
# for every file takes several rounds of tool calls.
MAX_STEPS = 30

# Never part of organizing, whatever the settings.
_NEVER = frozenset(
    {"delete_file", "delete_folder", "create_share_link", "create_alias", "set_favorite"}
)

_GROUPING = {
    "auto": (
        "whatever fits each set of files best. Usually that's what they're about "
        "(Payslips, Rental, Travel), with a folder per year inside when there are "
        "many of one kind."
    ),
    "topic": "what they're about (Payslips, Rental, Travel, Medical).",
    "type": "kind of file (Documents, Images, Videos, Spreadsheets).",
    "year": (
        "the year they belong to: a date in the name or the contents if there is "
        "one, else when the file was last changed."
    ),
}


def excluded_tools(opts: OrganizeOptions) -> frozenset[str]:
    """Tools this run may not use."""
    out = set(_NEVER)
    if not opts.rename:
        out.add("rename_file")
    if opts.keep_existing:
        out |= {"rename_folder", "move_folder"}
    if not opts.tags:
        out |= {"add_tag", "remove_tag"}
    if not opts.read_contents:
        out |= {"read_file_text", "search_content"}
    return frozenset(out)


# Files listed in the brief itself. Past this the agent pages list_files.
INVENTORY_MAX = 600


async def inventory(db: AsyncSession, user: User) -> str:
    """Every file and folder in the drive, one line each, for the brief.

    Listing the drive up front means coverage doesn't depend on the agent
    paging through list_files: a file uploaded long ago (an old PAN card scan)
    is in front of it just like this week's payslip."""
    paths = await _folder_paths(db, user)
    total = (
        await db.execute(select(func.count()).select_from(File).where(File.owner_id == user.id))
    ).scalar_one()
    rows = (
        await db.execute(
            select(File.id, File.name, File.folder_id, File.mime)
            .where(File.owner_id == user.id)
            .order_by(File.folder_id.is_not(None), File.name)
            .limit(INVENTORY_MAX)
        )
    ).all()
    lines = [f"The drive has {total} files and {len(paths)} folders."]
    if paths:
        lines.append("Folders (id: path):")
        lines += [f"- {fid}: {path}" for fid, path in sorted(paths.items(), key=lambda x: x[1])]
    lines.append("Files (id | name | folder | type):")
    for fid, name, folder_id, mime in rows:
        where = paths.get(folder_id, "/") if folder_id else "/"
        lines.append(f"- {fid} | {name} | {where} | {mime or '?'}")
    if total > len(rows):
        lines.append(
            f"({total - len(rows)} more files aren't listed here: page through list_files "
            f"with offset {len(rows)} onward to see them.)"
        )
    return "\n".join(lines)


async def folders_listing(db: AsyncSession, user: User) -> str:
    """The drive's folders with their ids: what a fix turn aims changes at."""
    paths = await _folder_paths(db, user)
    if not paths:
        return "The drive has no folders yet."
    lines = ["The drive's folders now (id: path):"]
    lines += [f"- {fid}: {path}" for fid, path in sorted(paths.items(), key=lambda x: x[1])]
    return "\n".join(lines)


def brief(opts: OrganizeOptions, drive: str = "") -> str:
    """The instructions for one organizing run, with the drive's inventory."""
    lines = [
        "Organize the user's drive as their message above asks: the whole drive "
        "unless it names a part. Settings for this run (where the message is more "
        "specific, follow the message):",
        f"- Group files by {_GROUPING[opts.group_by]}",
        (
            "- Folders as deep as suits the files: one level where there are few, "
            "another inside a group only when it's large. Never more than 3 levels."
            if opts.depth is None
            else f"- Folders at most {opts.depth} level{'s' if opts.depth > 1 else ''} "
            "deep, counting from the top of the drive."
        ),
        (
            "- Keep the existing folders. Reuse them, put files into them where they "
            "fit, and leave files that already sit in a sensible folder where they are."
            if opts.keep_existing
            else "- Existing folders may be reshaped: move or rename them when it gives "
            "a clearer structure. Don't delete any."
        ),
        (
            "- Rename files whose names don't say what they are (scan_0032.pdf to "
            "Passport scan.pdf), and keep the extension. Files of the same kind (a "
            "run of payslips, bank statements, invoices, bills, ID scans) all get ONE "
            "naming pattern, so the set reads as a set: pick it from the clearest "
            "names already there (e.g. 'Payslip 2026-04.pdf': kind, then the date or "
            "other detail that tells them apart, written the same way each time), and "
            "rename every member that doesn't follow it, even one whose current name "
            "is already clear. A file unlike any other keeps a good name as it is."
            if opts.rename
            else "- Do not rename any file. Keep every name exactly as it is."
        ),
        (
            "- When a name doesn't say what a file is, read it before deciding."
            if opts.read_contents
            else "- Decide from names, file types and dates only. Don't read files."
        ),
        (
            "- Add one or two useful tags to each file you move (its topic, its year)."
            if opts.tags
            else "- Don't add or remove tags."
        ),
        "",
        "How to work: the drive's full inventory is below, with the ids you need. "
        "Account for EVERY file in it: each one either moves somewhere that fits or "
        "stays put because it already sits in a sensible place. A file loose at the "
        "top of the drive or in a catch-all folder (Downloads, Misc, New folder) is "
        "almost never in a sensible place. Then call create_folder for the folders "
        "you need and move_file for every file that should move: all of them, not a "
        "sample. Never delete or share anything.",
        (
            "- A name that doesn't say what a file is (IMG_0042.jpg, scan.pdf, a long "
            "number, a document id) is not a reason to skip it: read it with "
            "read_file_text first, then place it by what it actually is (an ID card, "
            "a bill, a certificate)."
            if opts.read_contents
            else "- A name that doesn't say what a file is goes by its type and date."
        ),
        "Finish with a short summary: the folders you chose, how many files go into "
        "each, and anything you left alone. Mention files that look like duplicates, "
        "but don't remove them.",
        "If the message asks to change an earlier plan, that plan was discarded: make "
        "a complete new plan with the change, keeping whatever else still fits.",
    ]
    if drive:
        lines += ["", drive]
    return "\n".join(lines)


# ── Revising a plan ──────────────────────────────────────────────────────────
_PREVIOUS_MAX = 300  # actions carried into a revision


def previous_plan(actions: list[dict[str, Any]]) -> str:
    """The plan being revised, as the starting point for the new one.

    With it the agent changes what the note asks and re-proposes the rest as it
    was, instead of re-reading the drive and rebuilding from nothing: a revision
    of a 60-change plan then takes one or two rounds, not twenty."""
    if not actions:
        return ""
    lines = [
        "You're revising the plan below. Its changes are ALREADY in this plan, under "
        "these numbers (as op(args), with $new:N meaning the folder made by change N):",
    ]
    for i, a in enumerate(actions[:_PREVIOUS_MAX]):
        args = ", ".join(f"{k}={v}" for k, v in (a.get("args") or {}).items())
        lines.append(f"{i}. {a.get('op')}({args})  # {a.get('label', '')}")
    if len(actions) > _PREVIOUS_MAX:
        lines.append(f"(and {len(actions) - _PREVIOUS_MAX} more)")
    lines.append(
        "Do NOT propose these again. Make only the user's change: call remove_change "
        "with a number to drop a change, and propose new changes for anything to add "
        "or put somewhere else. Create a folder before putting anything in it, and "
        "use exactly the folder_id that create_folder gives back (every change takes "
        f"a number, from {len(actions)} up, so don't guess one). Don't re-read files "
        "unless the note is about them. When the note is handled, stop and say in a "
        "line or two what you changed."
    )
    return "\n".join(lines)


# What Bao says when asked to organize in Read only, where he can't propose
# changes. The chat shows a one-tap switch to Ask first under it.
READ_ONLY_REPLY = (
    "I'm in Read only, so I can look through your files and answer questions, but "
    "I can't propose changes. Switch to Ask first and I'll draft a plan for you to "
    "approve: nothing moves until you say so."
)


# ── Fixing the changes that failed ───────────────────────────────────────────
def fix_settings(failed: list[dict[str, Any]]) -> OrganizeOptions:
    """Organizing limits that allow exactly the kinds of change that failed."""
    ops = {a.get("op") for a in failed}
    return OrganizeOptions(
        rename="rename_file" in ops,
        tags=bool(ops & {"add_tag", "remove_tag"}),
        keep_existing=not (ops & {"rename_folder", "move_folder"}),
        group_by="auto",
        depth=None,
    )


def with_real_folders(
    args: dict[str, Any], actions: list[dict[str, Any]], made: dict[int, uuid.UUID]
) -> dict[str, Any]:
    """`args` with each `$new:N` that names a folder the plan really made swapped
    for that folder's id. A ref to anything else (a miscount) is left as it is."""

    def real(value: Any) -> Any:
        if not is_new_ref(value):
            return value
        tail = str(value)[len(NEW_REF_PREFIX) :]
        if not tail.isdigit():
            return value
        n = int(tail)
        if n in made and n < len(actions) and actions[n].get("op") == "create_folder":
            return str(made[n])
        return value

    return {k: real(v) for k, v in args.items()}


def fix_brief(failed: list[tuple[dict[str, Any], str]]) -> str:
    """The changes that failed last time, with why, for the agent to redo.

    Folder references are already resolved to the real folders that plan made
    (they exist now), so the agent works with real ids, not numbers to count."""
    lines = [
        "These changes from the plan you applied failed, each with the reason:",
    ]
    for action, reason in failed[:_PREVIOUS_MAX]:
        args = ", ".join(f"{k}={v}" for k, v in (action.get("args") or {}).items())
        lines.append(f"- {action.get('op')}({args})  # {action.get('label', '')}: {reason}")
    lines.append(
        "Everything else in that plan worked and is done: leave it alone. Look at the "
        "drive as it is now (list_folders shows the folders that plan made, with their "
        "real ids) and propose these changes again so they work: the same intent, with "
        "real folder ids. A $new:N still left above pointed at the wrong change; work "
        "out from the label which folder was meant. Skip any that no longer make sense, "
        "and say which."
    )
    return "\n".join(lines)


# ── Requests that read like organizing ───────────────────────────────────────
_VERB = re.compile(
    r"\b(re-?organi[sz]e|organi[sz]e|tidy|clean ?up|sort out|sort (?:my|the|all|these)|"
    r"arrange|rearrange|restructure|declutter|group (?:my|the|all|these))\b"
)
_THING = re.compile(
    r"\b(files?|folders?|drive|documents?|docs|stuff|everything|downloads|photos|"
    r"pictures|images|pdfs?|videos|receipts|invoices|payslips)\b"
)


def looks_like_organizing(text: str) -> OrganizeOptions | None:
    """Settings for a plain-language request to reorganize files, or None when
    it isn't one. Cautious like /organize (no renames or tags unless the
    message mentions them); grouping and depth are left to the agent, which
    follows anything the message says about them."""
    low = text.lower()
    if not (_VERB.search(low) and _THING.search(low)):
        return None
    return OrganizeOptions(
        rename=bool(re.search(r"\brenam", low)),
        tags=bool(re.search(r"\btag", low)),
        group_by="auto",
        depth=None,
    )


# ── Preview: the drive's shape after the plan ────────────────────────────────
# Ops worth drawing: anything that reshapes folders or changes how a file
# shows up (its name, tags, star).
_SHAPING = {
    "create_folder",
    "move_file",
    "move_folder",
    "rename_folder",
    "rename_file",
    "add_tag",
    "remove_tag",
    "set_favorite",
}
_FILE_OPS = {"move_file", "rename_file", "add_tag", "remove_tag", "set_favorite"}
_FILES_SHOWN = 12  # per folder; the rest are counted


def _key(value: Any) -> str | None:
    """A folder reference in plan args or a row, as a node key; None is the root."""
    return None if value is None else str(value)


def _node(name: str, parent: str | None, *, new: bool = False) -> dict[str, Any]:
    return {"name": name, "parent": parent, "new": new, "was": None, "moved": False, "files": []}


async def preview(
    db: AsyncSession, user: User, actions: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """The part of the folder tree a plan touches, as it will look once applied:
    new folders, files under their destination (with where they came from),
    renames, tags and stars, and the folders above them. None for a plan with
    nothing to draw (a share link, a delete)."""
    if not any(a.get("op") in _SHAPING for a in actions):
        return None

    rows = (await db.execute(select(Folder).where(Folder.owner_id == user.id))).scalars()
    nodes = {str(f.id): _node(f.name, _key(f.parent_id)) for f in rows}
    root = _node("My drive", None)

    def path(key: str | None) -> str:
        parts: list[str] = []
        seen: set[str] = set()
        while key is not None and key in nodes and key not in seen:
            seen.add(key)
            parts.append(nodes[key]["was"] or nodes[key]["name"])
            key = nodes[key]["parent"]
        return "/" + "/".join(reversed(parts))

    def arg(a: dict[str, Any], name: str) -> Any:
        return (a.get("args") or {}).get(name)

    file_ids: set[uuid.UUID] = set()
    for a in actions:
        if a.get("op") in _FILE_OPS:
            try:
                file_ids.add(uuid.UUID(str(arg(a, "file_id"))))
            except ValueError:
                continue
    files: dict[str, File] = {}
    if file_ids:
        found = await db.execute(
            select(File).where(File.owner_id == user.id, File.id.in_(file_ids))
        )
        files = {str(f.id): f for f in found.scalars()}
    origin = {fid: path(_key(f.folder_id)) for fid, f in files.items()}  # before any change

    dest: dict[str, str | None] = {}
    renamed: dict[str, str] = {}
    tagged: dict[str, list[str]] = {}
    untagged: dict[str, list[str]] = {}
    starred: dict[str, bool] = {}
    for i, a in enumerate(actions):
        op = a.get("op")
        if op == "create_folder":
            parent, name = _key(arg(a, "parent_id")), str(arg(a, "name") or "New folder")
            # In auto mode the folder already exists by now: mark that one new
            # rather than drawing it twice.
            same = next(
                (n for n in nodes.values() if n["parent"] == parent and n["name"] == name), None
            )
            if same is not None:
                same["new"] = True
                nodes[f"$new:{i}"] = same
            else:
                nodes[f"$new:{i}"] = _node(name, parent, new=True)
        elif op == "rename_folder" and (node := nodes.get(str(arg(a, "folder_id")))):
            node["was"], node["name"] = node["name"], str(arg(a, "name") or node["name"])
        elif op == "move_folder" and (node := nodes.get(str(arg(a, "folder_id")))):
            node["parent"], node["moved"] = _key(arg(a, "parent_id")), True
        elif op == "move_file" and str(arg(a, "file_id")) in files:
            dest[str(arg(a, "file_id"))] = _key(arg(a, "folder_id"))
        elif op == "rename_file" and str(arg(a, "file_id")) in files:
            renamed[str(arg(a, "file_id"))] = str(arg(a, "name") or "")
        elif op in {"add_tag", "remove_tag"} and str(arg(a, "file_id")) in files:
            tag = str(arg(a, "name") or "").strip().lower()
            if tag:
                (tagged if op == "add_tag" else untagged).setdefault(
                    str(arg(a, "file_id")), []
                ).append(tag)
        elif op == "set_favorite" and str(arg(a, "file_id")) in files:
            starred[str(arg(a, "file_id"))] = bool(arg(a, "favorite"))

    for fid in dest.keys() | renamed.keys() | tagged.keys() | untagged.keys() | starred.keys():
        f = files[fid]
        where = dest[fid] if fid in dest else _key(f.folder_id)
        target = nodes.get(where, root) if where is not None else root
        target["files"].append(
            {
                "name": renamed.get(fid) or f.name,
                "was": f.name if fid in renamed else None,
                "from": origin[fid] if fid in dest else None,
                "tags_added": tagged.get(fid, []),
                "tags_removed": untagged.get(fid, []),
                "star": starred.get(fid),  # True starred, False unstarred, None untouched
            }
        )

    # Each folder once (a created folder can sit under two keys), and the ones
    # worth drawing: anything the plan touches, plus the folders above it.
    unique = list({id(n): n for n in nodes.values()}.values())
    keep: set[int] = set()
    for n in unique:
        if n["new"] or n["was"] or n["moved"] or n["files"]:
            cur: dict[str, Any] | None = n
            while cur is not None and id(cur) not in keep:
                keep.add(id(cur))
                cur = nodes.get(cur["parent"]) if cur["parent"] is not None else None

    def parent_of(n: dict[str, Any]) -> dict[str, Any]:
        return nodes.get(n["parent"], root) if n["parent"] is not None else root

    def out(n: dict[str, Any]) -> dict[str, Any]:
        children = [c for c in unique if id(c) in keep and parent_of(c) is n and c is not n]
        children.sort(key=lambda c: (not c["new"], c["name"].lower()))
        listed = sorted(n["files"], key=lambda f: f["name"].lower())
        return {
            "name": n["name"],
            "new": n["new"],
            "was": n["was"],
            "moved": n["moved"],
            "files": listed[:_FILES_SHOWN],
            "more": max(0, len(listed) - _FILES_SHOWN),
            "children": [out(c) for c in children],
        }

    # Loose files at the top of the drive that the plan leaves there: usually
    # a file the agent missed, so they're shown for the user to catch.
    touched = [uuid.UUID(fid) for fid in files]
    loose_q = select(File.name).where(File.owner_id == user.id, File.folder_id.is_(None))
    if touched:
        loose_q = loose_q.where(File.id.not_in(touched))
    loose = sorted(str(n) for n in (await db.execute(loose_q)).scalars())

    return {
        "untouched": loose[:_FILES_SHOWN],
        "untouched_more": max(0, len(loose) - _FILES_SHOWN),
        "new_folders": sum(1 for n in unique if n["new"]),
        "moved": len(dest),
        "renamed": len(renamed),
        "tagged": len(tagged.keys() | untagged.keys()),
        "starred": sum(1 for v in starred.values() if v),
        "root": out(root),
    }
