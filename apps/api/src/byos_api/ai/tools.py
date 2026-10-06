"""Drive tools the agent can call, and how a proposed change gets applied.

Two kinds of tool:

* **READ** tools run immediately during planning — they only look at the drive,
  so there's nothing to confirm and the model needs their answers to think.
* **WRITE** tools do *not* run when the model calls them. The call is recorded
  into an action plan and the model gets back an acknowledgement, so it can keep
  planning as if the change had happened. Nothing touches the drive until the
  user applies the plan (see ``ai.agent`` and ``AiActionPlan``).

Every write op is a thin wrapper over the same service function the REST API
uses, so an agent can't reach a code path the dashboard couldn't — ownership
checks, folder-cycle rejection and tag normalisation all still apply.

Because a plan is built before any of it runs, a folder created in step 1 has no
id yet when step 3 wants to move files into it. Write tools that create something
return a placeholder (``$new:0``, indexed by position in the plan) which
``apply_action`` resolves to the real UUID at apply time.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import rag, semantic
from byos_api.aliases import service as aliases_service
from byos_api.db.models import AiFileChunk, AiKey, File, Folder, User
from byos_api.files import service as files_service
from byos_api.folders import service as folders_service
from byos_api.shares import service as shares_service

READ = "read"
WRITE = "write"
# Ends the turn with a question for the user; offered in every mode.
ASK = "ask"
# Edits the plan being revised; offered only when there is one.
PLAN = "plan"

# A single tool result is fed straight back into the prompt, so keep listings
# small enough that a wide sweep can't blow the context window.
MAX_ROWS = 200
MAX_FILE_CHARS = 6_000

NEW_REF_PREFIX = "$new:"


@dataclass(frozen=True)
class Tool:
    name: str
    kind: str
    description: str
    params: dict[str, Any]
    # Marks changes that are destructive or publish data outside the drive. The
    # UI highlights these in the confirmation list; they are not treated
    # differently at apply time (the user already confirmed the whole plan).
    danger: bool = False


def _obj(props: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or []}


_FILE_ID = {"type": "string", "description": "File id from a read tool."}
_FOLDER_ID = {
    "type": "string",
    "description": (
        "Folder id, or a $new:N placeholder returned by an earlier create_folder "
        "in this same plan. Omit or pass null for the drive root."
    ),
}

SPEC: list[Tool] = [
    # ── plan editing (revisions only) ───────────────────────────────────────
    Tool(
        "remove_change",
        PLAN,
        "Drop one change from the plan you're revising, by its number. Use it for "
        "a change the user's note doesn't want; to change where something goes, "
        "drop the old change and propose the new one. Changes you don't drop stay "
        "in the plan as they are.",
        _obj({"number": {"type": "integer", "description": "The change's number."}}, ["number"]),
    ),
    # ── ask ─────────────────────────────────────────────────────────────────
    Tool(
        "ask_user",
        ASK,
        "Ask the user one short clarifying question and stop until they answer. "
        "Use it when the request could mean different things that would change "
        "the answer (two years of June payslips, ID cards for several people). "
        "Look first, so the options are what you actually found.",
        _obj(
            {
                "question": {"type": "string", "description": "One short question."},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "2 to 5 short answers to pick from, taken from what you "
                        'found (e.g. "June 2026", "June 2025"). The user can '
                        "also type their own."
                    ),
                },
            },
            ["question", "options"],
        ),
    ),
    # ── read ────────────────────────────────────────────────────────────────
    Tool(
        "list_files",
        READ,
        "List or search the user's files. Omit `query` to list everything "
        "matching the filters. Returns id, name, size, folder path, tags and "
        "star state — start here to find the ids other tools need. Results come "
        "in pages: while `next_offset` is set there are more, so call again with "
        "that offset to see them.",
        _obj(
            {
                "query": {"type": "string", "description": "Full-text search terms."},
                "ext": {"type": "string", "description": "Extension filter, e.g. 'pdf'."},
                "tag": {"type": "string"},
                "favorite": {"type": "boolean"},
                "folder_id": {"type": "string", "description": "Restrict to one folder."},
                "limit": {"type": "integer", "description": f"Default 50, max {MAX_ROWS}."},
                "offset": {"type": "integer", "description": "Skip this many (paging)."},
            }
        ),
    ),
    Tool(
        "search_content",
        READ,
        "Search INSIDE your files by meaning, over the indexed text. Use this for "
        'questions about what documents say ("what was my June salary") — '
        "list_files only matches names and tags. Returns excerpts with the file "
        "they came from.",
        _obj(
            {
                "query": {"type": "string", "description": "What you want to find."},
                "limit": {"type": "integer", "description": "Excerpts to return, default 8."},
            },
            ["query"],
        ),
    ),
    Tool(
        "list_folders",
        READ,
        "List every folder with its full path. Use this before moving files so "
        "you reuse an existing folder instead of creating a duplicate.",
        _obj({}),
    ),
    Tool("list_tags", READ, "List every tag name already in use on this drive.", _obj({})),
    Tool(
        "find_duplicates",
        READ,
        "Groups of files with identical content, by checksum.",
        _obj({}),
    ),
    Tool(
        "read_file_text",
        READ,
        "Read a file's text so you can categorise it by content rather than by "
        "filename. Prefers already-indexed text (free) and falls back to "
        "extracting the file. Returns empty for un-indexed images and scans.",
        _obj({"file_id": _FILE_ID}, ["file_id"]),
    ),
    # ── write: organise ─────────────────────────────────────────────────────
    Tool(
        "create_folder",
        WRITE,
        "Create a folder. Returns a $new:N id usable as folder_id/parent_id in "
        "later steps of this plan.",
        _obj({"name": {"type": "string"}, "parent_id": _FOLDER_ID}, ["name"]),
    ),
    Tool(
        "rename_file",
        WRITE,
        "Rename a file. Keep the extension in the new name.",
        _obj({"file_id": _FILE_ID, "name": {"type": "string"}}, ["file_id", "name"]),
    ),
    Tool(
        "move_file",
        WRITE,
        "Move a file into a folder (null = drive root).",
        _obj({"file_id": _FILE_ID, "folder_id": _FOLDER_ID}, ["file_id"]),
    ),
    Tool(
        "set_favorite",
        WRITE,
        "Star or unstar a file.",
        _obj({"file_id": _FILE_ID, "favorite": {"type": "boolean"}}, ["file_id", "favorite"]),
    ),
    Tool(
        "add_tag",
        WRITE,
        "Add a tag to a file. Tags are lowercased. Reuse existing tag names.",
        _obj({"file_id": _FILE_ID, "name": {"type": "string"}}, ["file_id", "name"]),
    ),
    Tool(
        "remove_tag",
        WRITE,
        "Remove a tag from a file.",
        _obj({"file_id": _FILE_ID, "name": {"type": "string"}}, ["file_id", "name"]),
    ),
    Tool(
        "rename_folder",
        WRITE,
        "Rename a folder.",
        _obj({"folder_id": _FOLDER_ID, "name": {"type": "string"}}, ["folder_id", "name"]),
    ),
    Tool(
        "move_folder",
        WRITE,
        "Move a folder under another folder (null = drive root).",
        _obj({"folder_id": _FOLDER_ID, "parent_id": _FOLDER_ID}, ["folder_id"]),
    ),
    # ── write: destructive / outward-facing ─────────────────────────────────
    Tool(
        "delete_file",
        WRITE,
        "Permanently delete a file, including its bytes in the user's storage. "
        "This cannot be undone — only propose it when the user clearly asked.",
        _obj({"file_id": _FILE_ID}, ["file_id"]),
        danger=True,
    ),
    Tool(
        "delete_folder",
        WRITE,
        "Permanently delete a folder AND every file nested anywhere inside it. "
        "Cannot be undone — only propose it when the user clearly asked.",
        _obj({"folder_id": _FOLDER_ID}, ["folder_id"]),
        danger=True,
    ),
    Tool(
        "create_share_link",
        WRITE,
        "Create a public share link for a file. Anyone with the URL can reach it.",
        _obj(
            {
                "file_id": _FILE_ID,
                "expires_in_days": {"type": "integer"},
            },
            ["file_id"],
        ),
        danger=True,
    ),
    Tool(
        "create_alias",
        WRITE,
        "Create a permanent public alias (/a/{slug}) pointing at a file. The slug "
        "outlives the file it points to.",
        _obj(
            {
                "file_id": _FILE_ID,
                "slug": {"type": "string", "description": "Lowercase, dashes allowed."},
                "description": {"type": "string"},
            },
            ["file_id", "slug"],
        ),
        danger=True,
    ),
]

BY_NAME: dict[str, Tool] = {t.name: t for t in SPEC}


def schemas(*, writes: bool = True, exclude: frozenset[str] = frozenset()) -> list[dict[str, Any]]:
    """The tool list in OpenAI function-calling form. With `writes=False` only
    read tools are offered at all, so a read-only turn can't even be asked to
    propose a change (the model can't call what it never sees). `exclude`
    withholds named tools the same way (/organize without renaming)."""
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.params},
        }
        for t in SPEC
        if (writes or t.kind != WRITE) and t.name not in exclude
    ]


# ── helpers ─────────────────────────────────────────────────────────────────
class ToolError(Exception):
    """A tool call that can't be satisfied — reported back to the model as the
    tool's result so it can correct itself, never raised at the user."""


def _uuid(value: Any, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ToolError(f"'{value}' is not a valid {what} id") from None


def is_new_ref(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(NEW_REF_PREFIX)


async def _folder_paths(db: AsyncSession, user: User) -> dict[uuid.UUID, str]:
    """Every folder's full path, in one query (labels and listings both need it)."""
    rows = list((await db.execute(select(Folder).where(Folder.owner_id == user.id))).scalars())
    parent = {f.id: f.parent_id for f in rows}
    name = {f.id: f.name for f in rows}

    def path(fid: uuid.UUID) -> str:
        parts: list[str] = []
        seen: set[uuid.UUID] = set()
        cur: uuid.UUID | None = fid
        while cur is not None and cur in name and cur not in seen:
            seen.add(cur)  # defensive: a cycle would otherwise spin forever
            parts.append(name[cur])
            cur = parent.get(cur)
        return "/" + "/".join(reversed(parts))

    return {f.id: path(f.id) for f in rows}


def _file_row(record: File, paths: dict[uuid.UUID, str]) -> dict[str, Any]:
    return {
        "id": str(record.id),
        "name": record.name,
        "ext": record.ext,
        "size": record.size,
        "folder": paths.get(record.folder_id, "/") if record.folder_id else "/",
        "folder_id": str(record.folder_id) if record.folder_id else None,
        "tags": [t.name for t in record.tags],
        "starred": record.is_favorite,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


async def _indexed_text(db: AsyncSession, user: User, file_id: uuid.UUID) -> str:
    """Already-embedded chunks for this file, in reading order. Free to read and
    — since indexing transcribes scans with vision — often the only text there
    is for an image-only document."""
    rows = list(
        (
            await db.execute(
                select(AiFileChunk.content)
                .where(AiFileChunk.user_id == user.id, AiFileChunk.file_id == file_id)
                .order_by(AiFileChunk.chunk_index)
            )
        ).scalars()
    )
    return "\n\n".join(rows)


# ── read execution ──────────────────────────────────────────────────────────
async def run_read(
    db: AsyncSession,
    user: User,
    name: str,
    args: dict[str, Any],
    *,
    key: AiKey | None = None,
    strategies: Any = None,
) -> Any:
    """Execute a READ tool and return a JSON-serialisable result. `key` and
    `strategies` are only needed by `search_content`, which embeds the query and
    honours the user's retrieval add-ons."""
    if name == "list_files":
        raw_limit = str(args.get("limit") or "")
        limit = min(int(raw_limit), MAX_ROWS) if raw_limit.isdigit() else 50
        raw_offset = str(args.get("offset") or "")
        offset = int(raw_offset) if raw_offset.isdigit() else 0
        folder_id = args.get("folder_id")
        # One extra row says whether another page exists, without a count query.
        records = await files_service.search_files(
            db,
            user,
            str(args.get("query") or ""),
            ext=(str(args["ext"]) if args.get("ext") else None),
            folder_id=_uuid(folder_id, "folder") if folder_id else None,
            tag=(str(args["tag"]) if args.get("tag") else None),
            favorite=args.get("favorite") if isinstance(args.get("favorite"), bool) else None,
            limit=limit + 1,
            offset=offset,
        )
        more = len(records) > limit
        records = records[:limit]
        paths = await _folder_paths(db, user)
        out: dict[str, Any] = {
            "count": len(records),
            "offset": offset,
            "files": [_file_row(r, paths) for r in records],
        }
        if more:
            out["next_offset"] = offset + limit
            out["note"] = "More files match: call again with next_offset to see them."
        return out

    if name == "search_content":
        if key is None or not key.embedding_model:
            raise ToolError(
                "content search needs an embedding model on this key. "
                "Use list_files instead, or tell the user to add one"
            )
        raw_k = str(args.get("limit") or "")
        k = min(int(raw_k), 20) if raw_k.isdigit() else 8
        query = str(args.get("query") or "").strip()
        if not query:
            raise ToolError("search_content needs a query")
        if strategies is not None:
            # Same pipeline as RAG chat, so query rewriting / HyDE / rerank / CRAG
            # apply here too. Its progress events aren't surfaced — the agent
            # reports the hit count as its own step instead.
            hits: list[tuple[str, str, str]] = []
            async for evt in rag.retrieve(db, user, key, query, strategies, keep=k):
                if evt["kind"] == "hits":
                    hits = evt["hits"]
        else:
            vector = await semantic.embed_query(key, query)
            hits = await semantic.drive_semantic_chunks(db, user, key, vector, k=k)
        if not hits:
            return {"hits": [], "note": "nothing indexed matched. The drive may not be indexed"}
        return {
            "hits": [
                {"file_id": fid, "name": fname, "excerpt": chunk[:1500]}
                for fid, fname, chunk in hits
            ]
        }

    if name == "list_folders":
        paths = await _folder_paths(db, user)
        ordered = sorted(paths.items(), key=lambda kv: kv[1])
        return {"folders": [{"id": str(k), "path": v} for k, v in ordered]}

    if name == "list_tags":
        return {"tags": await files_service.list_tags(db, user)}

    if name == "find_duplicates":
        groups = await files_service.find_duplicates(db, user)
        paths = await _folder_paths(db, user)
        return {
            "groups": [
                {"hash": h, "files": [_file_row(r, paths) for r in records]}
                for h, records in groups
            ]
        }

    if name == "read_file_text":
        file_id = _uuid(args.get("file_id"), "file")
        try:
            record = await files_service.get_owned_file(db, user, file_id)
        except files_service.FileNotFound:
            raise ToolError("No such file") from None
        text = await _indexed_text(db, user, file_id)
        if not text:
            # Not indexed — read the text layer directly. No vision fallback:
            # planning shouldn't quietly run up per-page charges.
            from byos_api.ai import extract

            if not extract.is_extractable(record.mime, record.ext):
                return {"name": record.name, "text": "", "note": "not a readable text format"}
            got = await _download_text(db, user, record)
            text = got
        return {"name": record.name, "text": text[:MAX_FILE_CHARS]}

    raise ToolError(f"Unknown read tool '{name}'")


async def _download_text(db: AsyncSession, user: User, record: File) -> str:
    """Fetch and extract a file's text layer (no vision — see run_read)."""
    from byos_api.ai import extract
    from byos_api.db.models import FileVersion
    from byos_api.storage import StoredObjectRef, get_provider

    if record.current_version_id is None:
        return ""
    version = await db.get(FileVersion, record.current_version_id)
    account = await files_service.account_for_file(db, user, record)
    if version is None or account is None:
        return ""
    ref = StoredObjectRef(
        provider=record.provider,
        locator=version.provider_locator,
        size=version.size,
        checksum=version.hash,
    )
    buffer = bytearray()
    try:
        async for chunk in get_provider(record.provider).download(account, ref):
            buffer.extend(chunk)
    except FileNotFoundError:
        return ""
    return extract.extract_text(bytes(buffer), record.mime, record.ext, limit=MAX_FILE_CHARS)


# ── write: labelling at plan time ───────────────────────────────────────────
async def label(db: AsyncSession, user: User, op: str, args: dict[str, Any]) -> str:
    """A one-line human description of a proposed change, resolved to real names
    so the confirmation list reads as prose rather than UUIDs. Built once at plan
    time so a reloaded conversation needs no extra lookups."""
    paths = await _folder_paths(db, user)

    async def fname(raw: Any) -> str:
        try:
            record = await files_service.get_owned_file(db, user, _uuid(raw, "file"))
        except (files_service.FileNotFound, ToolError):
            return "(missing file)"
        return record.name

    def fpath(raw: Any) -> str:
        if is_root(raw):
            return "/ (root)"
        if is_new_ref(raw):
            return "the new folder"
        try:
            return paths.get(_uuid(raw, "folder"), "(missing folder)")
        except ToolError:
            return "(missing folder)"

    if op == "create_folder":
        parent = args.get("parent_id")
        where = "" if is_root(parent) else f" in {fpath(parent)}"
        return f"Create folder “{args.get('name')}”{where}"
    if op == "rename_file":
        return f"Rename {await fname(args.get('file_id'))} → “{args.get('name')}”"
    if op == "move_file":
        return f"Move {await fname(args.get('file_id'))} → {fpath(args.get('folder_id'))}"
    if op == "set_favorite":
        verb = "Star" if args.get("favorite") else "Unstar"
        return f"{verb} {await fname(args.get('file_id'))}"
    if op == "add_tag":
        return f"Tag {await fname(args.get('file_id'))} +{args.get('name')}"
    if op == "remove_tag":
        return f"Untag {await fname(args.get('file_id'))} −{args.get('name')}"
    if op == "rename_folder":
        return f"Rename folder {fpath(args.get('folder_id'))} → “{args.get('name')}”"
    if op == "move_folder":
        return f"Move folder {fpath(args.get('folder_id'))} → {fpath(args.get('parent_id'))}"
    if op == "delete_file":
        return f"Delete {await fname(args.get('file_id'))} permanently"
    if op == "delete_folder":
        return f"Delete folder {fpath(args.get('folder_id'))} and everything in it"
    if op == "create_share_link":
        return f"Create a public share link for {await fname(args.get('file_id'))}"
    if op == "create_alias":
        return f"Publish {await fname(args.get('file_id'))} at /a/{args.get('slug')}"
    return op


# ── write: execution at apply time ──────────────────────────────────────────
def resolve_folder(value: Any, created: dict[int, uuid.UUID]) -> uuid.UUID | None:
    """Public form of `_resolve`, for finding a plan's folders again on retry."""
    return _resolve(value, created)


# What models write for "the top of the drive" instead of null.
_ROOT_WORDS = {"", "null", "none", "root", "/", "my drive", "drive"}

# Args that name a folder where None (the root) is a valid answer.
ROOTABLE = {
    ("create_folder", "parent_id"),
    ("move_file", "folder_id"),
    ("move_folder", "parent_id"),
}


def is_root(value: Any) -> bool:
    """None, or a string that means the drive's top level ("", "root", "/")."""
    return value is None or (isinstance(value, str) and value.strip().lower() in _ROOT_WORDS)


def normalise_args(op: str, args: dict[str, Any]) -> dict[str, Any]:
    """`args` with any "top of the drive" spelling of a rootable folder turned
    into None, so `parent_id: ""` creates a top-level folder instead of failing."""
    return {k: (None if (op, k) in ROOTABLE and is_root(v) else v) for k, v in args.items()}


def _resolve(value: Any, created: dict[int, uuid.UUID]) -> uuid.UUID | None:
    """Turn a folder argument into a real id: None, a UUID, or a $new:N reference
    to a folder created earlier in this same plan."""
    if is_root(value):
        return None
    if is_new_ref(value):
        index = str(value)[len(NEW_REF_PREFIX) :]
        if not index.isdigit() or int(index) not in created:
            raise ToolError("refers to a folder that wasn't created")
        return created[int(index)]
    return _uuid(value, "folder")


async def apply_action(
    db: AsyncSession,
    user: User,
    action: dict[str, Any],
    created: dict[int, uuid.UUID],
    index: int,
) -> str:
    """Run one confirmed action. Returns a short outcome string. Raises ToolError
    for anything the user should see as a per-action failure; `created` collects
    folder ids so later actions can reference them."""
    op = str(action.get("op"))
    args = action.get("args") or {}
    if not isinstance(args, dict):
        raise ToolError("malformed action")

    try:
        if op == "create_folder":
            folder = await folders_service.create_folder(
                db,
                user,
                str(args.get("name") or "").strip(),
                _resolve(args.get("parent_id"), created),
            )
            created[index] = folder.id
            return f"created folder {folder.name}"

        if op == "rename_file":
            record = await files_service.rename_file(
                db, user, _uuid(args.get("file_id"), "file"), str(args.get("name") or "")
            )
            return f"renamed to {record.name}"

        if op == "move_file":
            await files_service.move_file(
                db,
                user,
                _uuid(args.get("file_id"), "file"),
                _resolve(args.get("folder_id"), created),
            )
            return "moved"

        if op == "set_favorite":
            await files_service.set_favorite(
                db, user, _uuid(args.get("file_id"), "file"), bool(args.get("favorite"))
            )
            return "starred" if args.get("favorite") else "unstarred"

        if op == "add_tag":
            await files_service.add_tag(
                db, user, _uuid(args.get("file_id"), "file"), str(args.get("name") or "")
            )
            return "tagged"

        if op == "remove_tag":
            await files_service.remove_tag(
                db, user, _uuid(args.get("file_id"), "file"), str(args.get("name") or "")
            )
            return "untagged"

        if op == "rename_folder":
            folder_id = _resolve(args.get("folder_id"), created)
            if folder_id is None:
                raise ToolError("the drive root can't be renamed")
            folder = await folders_service.update_folder(
                db, user, folder_id, {"name": str(args.get("name") or "").strip()}
            )
            return f"renamed to {folder.name}"

        if op == "move_folder":
            folder_id = _resolve(args.get("folder_id"), created)
            if folder_id is None:
                raise ToolError("the drive root can't be moved")
            await folders_service.move_folder(
                db, user, folder_id, _resolve(args.get("parent_id"), created)
            )
            return "moved"

        if op == "delete_file":
            record = await files_service.get_owned_file(
                db, user, _uuid(args.get("file_id"), "file")
            )
            await files_service.delete_file_record(db, user, record)
            return "deleted"

        if op == "delete_folder":
            folder_id = _resolve(args.get("folder_id"), created)
            if folder_id is None:
                raise ToolError("the drive root can't be deleted")
            await folders_service.delete_folder(db, user, folder_id)
            return "deleted"

        if op == "create_share_link":
            share = await shares_service.create_share(
                db,
                user,
                file_id=_uuid(args.get("file_id"), "file"),
                expires_in_days=args.get("expires_in_days")
                if isinstance(args.get("expires_in_days"), int)
                else None,
            )
            return f"shared at /s/{share.token}"

        if op == "create_alias":
            alias = await aliases_service.create_alias(
                db,
                user,
                str(args.get("slug") or "").strip().lower(),
                _uuid(args.get("file_id"), "file"),
                str(args["description"]) if args.get("description") else None,
            )
            return f"published at /a/{alias.slug}"

    except files_service.FileNotFound:
        raise ToolError("file no longer exists") from None
    except files_service.TargetFolderNotFound:
        raise ToolError("destination folder no longer exists") from None
    except folders_service.FolderNotFound:
        raise ToolError("folder no longer exists") from None
    except folders_service.InvalidMove:
        raise ToolError("can't move a folder inside itself") from None
    except shares_service.FileNotFound:
        raise ToolError("file no longer exists") from None
    except aliases_service.InvalidSlug:
        raise ToolError("invalid alias slug") from None
    except aliases_service.SlugTaken:
        raise ToolError("that alias slug is already taken") from None
    except aliases_service.FileAlreadyLinked:
        raise ToolError("that file already has an alias") from None
    except ValueError as exc:
        raise ToolError(str(exc)) from None

    raise ToolError(f"unknown action '{op}'")
