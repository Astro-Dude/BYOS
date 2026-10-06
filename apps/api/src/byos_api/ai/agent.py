"""The agent loop: turn a request into a plan of drive changes, never a change.

One turn runs the model in a tool-calling loop. READ tools execute as they're
called so the model can look around. What happens to a WRITE tool depends on the
turn's permission mode (see `Mode`): it is either refused, queued for the user to
confirm, or run on the spot.

When a write is queued it is still acknowledged back to the model as though it
had happened, so the model can chain "create a Finance folder" → "move these 12
files into it" in one pass without anything touching the drive.

The loop ends when the model replies without calling a tool (that reply is the
answer) or when it hits `MAX_STEPS`. What comes out is an ordered action list;
every action carries its own outcome, so one plan can hold a mix of changes that
already ran and changes still waiting on the user. `apply` fills in the rest.

Events are yielded as they happen so the UI can show progress: `step` per tool
call, `plan` once at the end, `error` if the model endpoint fails.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import citations, llm, tools
from byos_api.ai.modes import Mode, runs_now
from byos_api.db.models import AiActionPlan, AiKey, User

# Each step is a full model round-trip, so this bounds both latency and spend.
# Enough for search → read a few files → propose a large batch.
MAX_STEPS = 10

# One step may fan out over many files; the cap is on the whole plan.
MAX_ACTIONS = 200

# Output budget per step. A key's `max_tokens` is tuned for chat answers (often
# 1024), which is nowhere near enough here: a reasoning model narrates its plan
# before emitting tool calls, and if it runs out mid-thought the calls never
# arrive — the turn looks like it "did nothing".
MIN_STEP_TOKENS = 8192

_SYSTEM = """You are an agent that organises the user's file drive.

You have read tools (which run immediately) and write tools (which do NOT run \
immediately — they are collected into a plan the user reviews and confirms).

How to work:
- Look before you act. Call list_folders and list_files to learn what actually \
exists; never guess an id, a filename or a folder path.
- Reuse existing folders and tags instead of creating near-duplicates.
- When filenames are uninformative (scan_0032.pdf), use read_file_text to \
categorise by content.
- Then call write tools for every change you want. Be specific and complete: if \
the user asks to organise 30 files, propose all 30 moves, not an example.
- Deleting and sharing are irreversible or public. Only propose those when the \
user clearly asked for them.

When you are done proposing, reply with a short plain-language summary of what \
you are proposing and why. Do not list every change — the user sees the exact \
list already. Do not claim anything has been done: nothing has happened yet.

If the request needs no changes, just answer it.

When your answer uses what a file says, end it with one line for each file you \
actually relied on, and only those, exactly like this:
[source: <file_id> | <a few words copied exactly from that file>]
Copy the words as they appear in the file (for a figure, the figure and its \
label, e.g. "Total Net Pay ₹84,500.00"). The user doesn't see these lines; \
they mark the passage in the document."""

_CLARIFY = """When to ask instead of answering:
- If the request could mean different things that would change the answer, \
look first, then call ask_user with one short question and the choices you \
found. For example "my salary in June" when there are June payslips from 2025 \
and 2026, or "my Aadhaar number" when there are cards for more than one person.
- "My" means the user's own documents: match the name on a document against \
the details under "About the user". When exactly one matches, use it without \
asking.
- If no name matches, or a document might use a nickname, pet name or alias \
for the user, ask which one is theirs rather than guess.
- Don't ask when there's only one sensible reading, or when the user already \
said which (e.g. "latest"). Ask one question at a time."""


def _about(user: User) -> str:
    """The user's own details, so "my" documents can be told from other
    people's (a family member's ID card, say)."""
    rows = [
        ("Name", user.display_name),
        ("Username", user.username),
        ("Email", user.email),
        ("Phone", user.phone),
    ]
    known = [f"- {label}: {value}" for label, value in rows if value]
    return "About the user:\n" + "\n".join(known) if known else "About the user: nothing on file."


# The "Show reasoning" add-on: the working goes in its own block, which the chat
# shows above the answer.
_SHOW_WORK = """Show your reasoning this turn. Before the answer, write how you \
worked it out inside <reasoning></reasoning>: which files and figures you used, \
and every calculation with the arithmetic written out (e.g. 2,20,000 + 45,000 = \
84,500). Keep it to the steps that matter. Then give the answer itself after \
the closing tag, without repeating the working."""

_MODE_BRIEF = {
    Mode.READ_ONLY: (
        "You have READ-ONLY access this turn: you cannot change anything. Answer "
        "questions about the drive and about what files say — use search_content "
        "for questions about document contents. If the user asked for changes, "
        "describe what you would do and tell them to switch out of read-only mode."
    ),
    Mode.ASK: (
        "Your write calls are queued for the user to review and confirm. Nothing "
        "happens until they do, so never say a change has been made."
    ),
    Mode.AUTO: (
        "Reversible write calls (move, rename, tag, star, folders) are applied "
        "immediately. Deleting and sharing are still queued for confirmation."
    ),
    Mode.FULL: (
        "Your write calls are applied immediately, including deletes and public "
        "links. Be careful and conservative: prefer the smallest change that "
        "satisfies the request, and never delete anything not clearly asked for."
    ),
}


_THOUGHT_RE = re.compile(r"<(think|thought)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_REASONING_RE = re.compile(r"<reasoning>(.*?)</reasoning>", re.IGNORECASE | re.DOTALL)


def _question(args: dict[str, Any]) -> tuple[str, list[str]]:
    """An ask_user call's question and its options, tidied: short, distinct, at
    most five."""
    question = str(args.get("question") or "").strip()
    raw = args.get("options")
    options: list[str] = []
    for option in raw if isinstance(raw, list) else []:
        text = str(option).strip()[:80]
        if text and text not in options:
            options.append(text)
    return question[:300], options[:5]


def _split_reasoning(text: str) -> tuple[str, str]:
    """The working the model wrote for "Show reasoning", and the answer without it."""
    found = _REASONING_RE.search(text)
    if not found:
        return "", text
    return found.group(1).strip(), (text[: found.start()] + text[found.end() :]).strip()


def _provider_reasoning(message: dict[str, Any]) -> str:
    """Reasoning some providers return beside the answer (DeepSeek, OpenRouter)."""
    for field in ("reasoning_content", "reasoning"):
        value = message.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _strip_thoughts(text: str) -> str:
    """Drop <think> blocks. Reasoning models emit them as ordinary content on a
    non-streamed call, so without this a turn's "answer" can be pure scratch work."""
    return _THOUGHT_RE.sub("", text).strip()


def _without_thoughts(message: dict[str, Any]) -> dict[str, Any]:
    """The assistant message as replayed to the model, minus its own reasoning —
    which is most of the tokens and of no use to the next step."""
    content = message.get("content")
    if not isinstance(content, str) or "<think" not in content.lower():
        return message
    return {**message, "content": _strip_thoughts(content)}


def _ack(name: str, index: int, *, ran: str | None, folder_id: uuid.UUID | None) -> dict[str, Any]:
    """What a write tool reports back to the model.

    A queued `create_folder` hands back a `$new:N` placeholder so later steps can
    target the not-yet-created folder; one that actually ran hands back its real
    id, which needs no resolution later."""
    if ran is not None:
        ack: dict[str, Any] = {"applied": True, "result": ran}
        if folder_id is not None:
            ack["folder_id"] = str(folder_id)
        return ack
    ack = {"queued": True, "note": "awaiting user confirmation"}
    if name == "create_folder":
        ack["folder_id"] = f"{tools.NEW_REF_PREFIX}{index}"
    return ack


async def run(
    db: AsyncSession,
    user: User,
    key: AiKey,
    question: str,
    prior: list[dict[str, Any]],
    *,
    api_key: str,
    system_prompt: str,
    mode: Mode = Mode.ASK,
    strategies: Any = None,
    exclude: frozenset[str] = frozenset(),
    max_steps: int = MAX_STEPS,
    seed: list[dict[str, Any]] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Drive one agent turn. Yields `step` / `plan` / `answer` / `error` events.

    `seed` is a plan being revised: its changes start out in this turn's plan
    under their old numbers, and the model only drops (remove_change) or adds
    what the user's note asks, instead of writing the whole plan out again.

    Takes the already-decrypted `api_key` so a bad credential surfaces as a clean
    error on the request rather than a truncated response body."""
    show_work = bool(getattr(strategies, "reasoning", False))
    brief = f"{_SYSTEM}\n\n{_CLARIFY}\n\n{_about(user)}\n\n{_MODE_BRIEF[mode]}" + (
        f"\n\n{_SHOW_WORK}" if show_work else ""
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": f"{system_prompt}\n\n{brief}"},
        *prior,
        {"role": "user", "content": question},
    ]
    actions: list[dict[str, Any]] = [{**a, "auto": False} for a in (seed or [])]
    results: list[dict[str, Any] | None] = [None] * len(actions)
    removed: set[int] = set()
    if not seed:
        exclude = exclude | {"remove_change"}
    created: dict[int, uuid.UUID] = {}
    # Files whose content the answer could have drawn on, in the order they came
    # up, with what was read from each: the sources are picked from these.
    cited: dict[str, str] = {}
    read_text: dict[str, str] = {}
    answer = ""
    reasoning = ""
    clarify: dict[str, Any] | None = None

    for round_no in range(max_steps):
        # Progress for the screen (not saved): a long plan spends minutes in
        # model calls between reads, and silence there looks like a hang.
        yield {"kind": "thinking", "round": round_no + 1}
        try:
            turn = await llm.chat_tools(
                base_url=key.base_url,
                api_key=api_key,
                model=key.model,
                messages=messages,
                tools=tools.schemas(writes=mode is not Mode.READ_ONLY, exclude=exclude),
                max_tokens=max(key.max_tokens, MIN_STEP_TOKENS),
                reasoning_effort=key.reasoning_effort,
            )
        except llm.LLMError as exc:
            yield {"kind": "error", "detail": str(exc)}
            return

        if not turn.calls:
            # Cut off before it could call anything: report that instead of
            # presenting a half-written thought as the answer.
            if turn.finish_reason == "length":
                yield {
                    "kind": "error",
                    "detail": (
                        f"'{key.model}' hit its output limit while thinking, so it never "
                        "got to proposing changes. Raise Max tokens on this key, or ask "
                        "for a smaller batch."
                    ),
                }
                return
            reasoning, answer = _split_reasoning(_strip_thoughts(turn.content))
            if show_work and not reasoning:
                reasoning = _provider_reasoning(turn.raw)
            if not answer and reasoning:
                answer, reasoning = reasoning, ""
            if not answer:
                yield {
                    "kind": "error",
                    "detail": (
                        f"'{key.model}' replied with only its own reasoning and no "
                        "answer. Try again, or use a different model for agent turns."
                    ),
                }
                return
            break

        asked = next((c for c in turn.calls if c.name == "ask_user"), None)
        if asked is not None:
            question, options = _question(asked.arguments)
            if question:
                # The question is the turn's answer, so it's kept in the history
                # and the model sees what it asked when the user replies.
                answer = question
                clarify = {"kind": "question", "question": question, "options": options}
                break
        messages.append(_without_thoughts(turn.raw))
        for call in turn.calls:
            spec = tools.BY_NAME.get(call.name)
            if spec is None:
                result: Any = {"error": f"no such tool '{call.name}'"}
            elif spec.kind == tools.ASK:
                result = {"error": "ask_user needs a question"}
            elif call.name in exclude:
                # Never offered, so only a model inventing calls gets here.
                result = {"error": f"'{call.name}' isn't allowed in this task"}
            elif spec.kind == tools.PLAN:
                number = call.arguments.get("number")
                if not isinstance(number, int) or not 0 <= number < len(actions):
                    result = {"error": f"there's no change number {number}"}
                elif number in removed:
                    result = {"ok": True, "note": f"change {number} was already dropped"}
                else:
                    removed.add(number)
                    label = str(actions[number].get("label", ""))
                    result = {"ok": True, "dropped": number, "was": label}
                    yield {
                        "kind": "proposed",
                        "label": f"Drop: {label}",
                        "count": len(actions) - len(removed),
                    }
            elif spec.kind == tools.READ:
                try:
                    result = await tools.run_read(
                        db, user, call.name, call.arguments, key=key, strategies=strategies
                    )
                    _remember_reads(call, result, cited, read_text)
                    yield {
                        "kind": "step",
                        "label": call.name,
                        "detail": _summarise(call.name, call.arguments, result),
                    }
                except tools.ToolError as exc:
                    result = {"error": str(exc)}
                except Exception as exc:  # a broken read shouldn't kill the turn
                    result = {"error": f"tool failed: {exc}"}
            elif (
                bad := _bad_folder_ref(
                    tools.normalise_args(call.name, call.arguments), actions, removed
                )
            ) is not None:
                # Caught now, not at apply: a move into "$new:66" when 66 is a
                # move (a miscounted number) would fail every change after it.
                result = {"error": bad}
            elif call.name == "create_folder" and (
                same := await _existing_folder(db, user, call.arguments, actions, removed)
            ):
                # Asked for a folder that's already planned or already exists:
                # hand that one back instead of planning a duplicate.
                result = {"folder_id": same, "note": "that folder already exists: use this id"}
            elif len(actions) >= MAX_ACTIONS:
                result = {
                    "error": f"plan is full ({MAX_ACTIONS} changes) — stop proposing and summarise"
                }
            else:
                index = len(actions)
                # Any $new:N the model passes for a folder that already exists
                # for real (auto mode created it this turn) is resolved now, so a
                # queued action never depends on an earlier action having run.
                args = tools.normalise_args(call.name, _resolve_known_refs(call.arguments, created))
                label = await tools.label(db, user, call.name, args)
                actions.append(
                    {
                        "op": call.name,
                        "args": args,
                        "label": label,
                        "danger": spec.danger,
                        "auto": runs_now(mode, spec.danger),
                    }
                )
                if runs_now(mode, spec.danger):
                    try:
                        outcome = await tools.apply_action(db, user, actions[-1], created, index)
                        results.append({"ok": True, "detail": outcome})
                        result = _ack(call.name, index, ran=outcome, folder_id=created.get(index))
                        yield {"kind": "applied", "label": label, "detail": outcome}
                    except Exception as exc:
                        await db.rollback()
                        await db.refresh(user)
                        detail = str(exc) if isinstance(exc, tools.ToolError) else f"failed: {exc}"
                        results.append({"ok": False, "detail": detail})
                        result = {"error": detail}
                        yield {"kind": "applied", "label": label, "detail": detail, "failed": True}
                else:
                    results.append(None)
                    result = _ack(call.name, index, ran=None, folder_id=None)
                    yield {"kind": "proposed", "label": label, "count": len(actions)}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": call.name,
                    "content": json.dumps(result, default=str)[:20_000],
                }
            )
    else:
        # Ran out of steps with the model still calling tools. Keep whatever it
        # proposed and say so, rather than silently truncating its thinking.
        answer = (
            f"I ran out of steps ({max_steps} rounds of work) before finishing. The plan "
            "below is what I got to: apply it if it looks right, then ask me to continue "
            "with the rest."
        )

    answer, cites = citations.split(answer)
    # Shown as its own block above the answer; only when it was asked for.
    shown = f"<reasoning>{reasoning}</reasoning>\n\n{answer}" if show_work and reasoning else answer
    yield {"kind": "answer", "text": shown}
    if clarify:
        yield clarify
    if cited:
        sources = citations.pick(answer, cites, read_text, cited, list(cited))
        if sources:
            yield {"kind": "sources", "sources": sources}
    if removed:
        actions, results = _without(actions, results, removed)
    if actions:
        yield {"kind": "plan", "actions": actions, "results": results}


async def _existing_folder(
    db: AsyncSession,
    user: User,
    args: dict[str, Any],
    actions: list[dict[str, Any]],
    removed: set[int],
) -> str | None:
    """The id of a folder with this name in this parent that is already in the
    plan ($new:N) or already on the drive, or None. Names compare ignoring case."""
    args = tools.normalise_args("create_folder", args)
    name = str(args.get("name") or "").strip()
    parent = args.get("parent_id")
    if not name:
        return None
    for i, a in enumerate(actions):
        a_args = tools.normalise_args("create_folder", a.get("args") or {})
        if (
            i not in removed
            and a.get("op") == "create_folder"
            and str(a_args.get("name") or "").strip().lower() == name.lower()
            and a_args.get("parent_id") == parent
        ):
            return f"{tools.NEW_REF_PREFIX}{i}"
    if db is None or tools.is_new_ref(parent):
        return None  # a folder inside a not-yet-made one can't exist yet
    from byos_api.db.models import Folder

    try:
        parent_id = None if parent is None else uuid.UUID(str(parent))
    except ValueError:
        return None
    found = (
        await db.execute(
            select(Folder.id).where(
                Folder.owner_id == user.id,
                Folder.parent_id.is_(None) if parent_id is None else Folder.parent_id == parent_id,
                func.lower(Folder.name) == name.lower(),
            )
        )
    ).scalar_one_or_none()
    return str(found) if found is not None else None


def apply_order(actions: list[dict[str, Any]]) -> list[int]:
    """The order to run a plan in: every new folder first, each after the new
    folder it sits in, then everything else as listed. However the model listed
    the plan, a move never runs before the folder it goes into exists."""

    def parent_ref(action: dict[str, Any]) -> int | None:
        value = (action.get("args") or {}).get("parent_id")
        if tools.is_new_ref(value):
            tail = str(value)[len(tools.NEW_REF_PREFIX) :]
            if tail.isdigit():
                return int(tail)
        return None

    folders = [i for i, a in enumerate(actions) if a.get("op") == "create_folder"]
    ordered: list[int] = []
    placed: set[int] = set()
    waiting = list(folders)
    while waiting:
        ready = [
            i
            for i in waiting
            if (p := parent_ref(actions[i])) is None or p in placed or p not in folders
        ]
        if not ready:  # a cycle or a bad ref: run the rest as listed and let them fail
            ready = waiting
        for i in ready:
            ordered.append(i)
            placed.add(i)
        waiting = [i for i in waiting if i not in placed]
    return ordered + [i for i in range(len(actions)) if i not in placed]


async def undo_plan(
    db: AsyncSession, user: User, plan: AiActionPlan, origins: dict[str, str]
) -> list[dict[str, Any] | None]:
    """Reverse an applied plan's changes, newest first, recording each undo's
    outcome under "undone" next to the change's own result. Anything that can't
    be reversed says why; the rest still go back."""
    from byos_api.ai import undo

    actions = list(plan.actions or [])
    results: list[dict[str, Any] | None] = list(plan.result or [None] * len(actions))
    results += [None] * (len(actions) - len(results))
    made: dict[int, uuid.UUID] = {}
    await recall_folders(db, user, actions, results, made)

    for index in reversed(apply_order(actions)):
        outcome = results[index]
        if not outcome or not outcome.get("ok") or outcome.get("undone", {}).get("ok"):
            continue  # never ran, failed, or already undone
        if index in made and not outcome.get("folder_id"):
            outcome = {**outcome, "folder_id": str(made[index])}
        try:
            detail = await undo.undo_action(db, user, actions[index], outcome, origins)
            results[index] = {**outcome, "undone": {"ok": True, "detail": detail}}
        except tools.ToolError as exc:
            await db.rollback()
            await db.refresh(user)
            results[index] = {**outcome, "undone": {"ok": False, "detail": str(exc)}}
        except Exception as exc:
            await db.rollback()
            await db.refresh(user)
            results[index] = {**outcome, "undone": {"ok": False, "detail": f"failed: {exc}"}}

    await db.refresh(plan)
    plan.result = results
    plan.status = "undone"
    await db.commit()
    return results


async def recall_folders(
    db: AsyncSession,
    user: User,
    actions: list[dict[str, Any]],
    prior: list[dict[str, Any] | None],
    created: dict[int, uuid.UUID],
) -> None:
    """Fill `created` with the folders this plan already made, by their action
    index: from the id stored with the outcome, or (outcomes saved before ids
    were) by name under the same parent, resolved in plan order."""
    from byos_api.db.models import Folder

    for index, action in enumerate(actions):
        done = prior[index] if index < len(prior) else None
        if action.get("op") != "create_folder" or not (done and done.get("ok")):
            continue
        if done.get("folder_id"):
            created[index] = uuid.UUID(str(done["folder_id"]))
            continue
        args = action.get("args") or {}
        try:
            parent = tools.resolve_folder(args.get("parent_id"), created)
        except tools.ToolError:
            continue
        found = (
            await db.execute(
                select(Folder.id).where(
                    Folder.owner_id == user.id,
                    Folder.parent_id.is_(None) if parent is None else Folder.parent_id == parent,
                    Folder.name == str(args.get("name") or "").strip(),
                )
            )
        ).scalar_one_or_none()
        if found is not None:
            created[index] = found


def _bad_folder_ref(
    args: dict[str, Any], actions: list[dict[str, Any]], removed: set[int]
) -> str | None:
    """Why a proposed change's `$new:N` folder reference is wrong, or None. N must
    be a create_folder already in this plan (and not dropped); the error lists the
    right numbers so the model can fix the call."""
    for key, value in args.items():
        if key in {"folder_id", "parent_id"} and not tools.is_new_ref(value):
            if tools.is_root(value):
                continue  # the top of the drive: fine wherever it's allowed
            try:
                uuid.UUID(str(value))
            except ValueError:
                return (
                    f"{key}={value!r} isn't a folder id. Use an id from list_folders, a "
                    "$new:N from create_folder, or null for the top of the drive."
                )
            continue
        if not tools.is_new_ref(value):
            continue
        tail = str(value)[len(tools.NEW_REF_PREFIX) :]
        ok = (
            tail.isdigit()
            and int(tail) < len(actions)
            and int(tail) not in removed
            and actions[int(tail)].get("op") == "create_folder"
        )
        if ok:
            continue
        folders = [
            f"{tools.NEW_REF_PREFIX}{i} = {(a.get('args') or {}).get('name')}"
            for i, a in enumerate(actions)
            if a.get("op") == "create_folder" and i not in removed
        ]
        listing = "; ".join(folders[-40:]) or "none yet: call create_folder first"
        return (
            f"{value} isn't a folder you've created in this plan. Use the folder_id "
            f"create_folder gave you. New folders so far: {listing}"
        )
    return None


def _without(
    actions: list[dict[str, Any]], results: list[dict[str, Any] | None], removed: set[int]
) -> tuple[list[dict[str, Any]], list[dict[str, Any] | None]]:
    """The plan minus dropped changes. A change that puts something in a new
    folder that was dropped goes too, and the remaining `$new:N` references are
    renumbered to the folders' new positions so the plan still applies."""
    gone = set(removed)

    def refs(action: dict[str, Any]) -> list[int]:
        out = []
        for value in (action.get("args") or {}).values():
            if tools.is_new_ref(value):
                tail = str(value)[len(tools.NEW_REF_PREFIX) :]
                if tail.isdigit():
                    out.append(int(tail))
        return out

    changed = True
    while changed:  # a dropped folder takes everything placed in it, transitively
        changed = False
        for i, action in enumerate(actions):
            if i not in gone and any(r in gone for r in refs(action)):
                gone.add(i)
                changed = True
    new_index: dict[int, int] = {}
    for i in range(len(actions)):
        if i not in gone:
            new_index[i] = len(new_index)

    def renumber(value: Any) -> Any:
        if tools.is_new_ref(value):
            tail = str(value)[len(tools.NEW_REF_PREFIX) :]
            if tail.isdigit() and int(tail) in new_index:
                return f"{tools.NEW_REF_PREFIX}{new_index[int(tail)]}"
        return value

    kept = [
        {**a, "args": {k: renumber(v) for k, v in (a.get("args") or {}).items()}}
        for i, a in enumerate(actions)
        if i not in gone
    ]
    return kept, [r for i, r in enumerate(results) if i not in gone]


def _remember_reads(
    call: llm.ToolCall, result: Any, cited: dict[str, str], read_text: dict[str, str]
) -> None:
    """Note which files a read turned up and what it showed of them, so the
    answer's sources can be picked (and their quotes checked) at the end."""
    if not isinstance(result, dict):
        return
    found: list[tuple[str, str, str]] = [
        (str(h["file_id"]), str(h.get("name") or "file"), str(h.get("excerpt") or ""))
        for h in result.get("hits", [])
        if isinstance(h, dict) and h.get("file_id")
    ]
    if call.name == "read_file_text" and result.get("text") and call.arguments.get("file_id"):
        found.append(
            (str(call.arguments["file_id"]), str(result.get("name") or "file"), str(result["text"]))
        )
    for file_id, name, text in found:
        fid = file_id.lower()
        cited.setdefault(fid, name)
        read_text[fid] = read_text.get(fid, "") + "\n" + text


def _summarise(name: str, args: dict[str, Any], result: Any) -> str:
    """One-line detail for a read step, for the UI's step disclosure."""
    if isinstance(result, dict):
        if "error" in result:
            return str(result["error"])
        if "count" in result:
            query = args.get("query") or args.get("tag") or args.get("ext")
            return f"{result['count']} files" + (f" matching “{query}”" if query else "")
        for field in ("folders", "tags", "groups"):
            if field in result and isinstance(result[field], list):
                return f"{len(result[field])} {field}"
        if "name" in result:
            return f"read {result['name']}"
    return ""


def _resolve_known_refs(args: dict[str, Any], created: dict[int, uuid.UUID]) -> dict[str, Any]:
    """Replace $new:N folder references with a real id where one already exists."""
    out = dict(args)
    for field in ("folder_id", "parent_id"):
        value = out.get(field)
        if tools.is_new_ref(value):
            index = str(value)[len(tools.NEW_REF_PREFIX) :]
            if index.isdigit() and int(index) in created:
                out[field] = str(created[int(index)])
    return out


def plan_status(results: list[dict[str, Any] | None]) -> str:
    """A plan is done only once nothing is left waiting on the user."""
    return "pending" if any(r is None for r in results) else "applied"


# ── persistence + apply ─────────────────────────────────────────────────────
async def save_plan(
    db: AsyncSession,
    user: User,
    conversation_id: uuid.UUID,
    actions: list[dict[str, Any]],
    results: list[dict[str, Any] | None] | None = None,
) -> AiActionPlan:
    """Store a turn's actions. `results` carries outcomes for anything that
    already ran (auto/full mode), with None for actions still awaiting a click."""
    outcomes: list[dict[str, Any] | None] = results or [None] * len(actions)
    status = plan_status(outcomes)
    plan = AiActionPlan(
        user_id=user.id,
        conversation_id=conversation_id,
        status=status,
        actions=actions,
        result=outcomes if any(r is not None for r in outcomes) else None,
    )
    if status == "applied":
        plan.applied_at = datetime.now(UTC)
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


async def apply(db: AsyncSession, user: User, plan: AiActionPlan) -> list[dict[str, Any] | None]:
    """Execute a confirmed plan in order, recording a per-action outcome.

    One failing action doesn't abort the rest: on a drive that changed since the
    plan was made, "3 of 12 files were already moved" should still leave the other
    9 done. Results are stored on the plan so the outcome survives a reload.
    """
    created: dict[int, uuid.UUID] = {}
    actions = list(plan.actions or [])  # snapshot: a rollback below expires `plan`
    # Anything that already ran during the turn keeps its outcome; only the holes
    # are executed here, so applying a mixed plan can't re-run a done change.
    prior_results = list(plan.result or [None] * len(actions))
    prior_results += [None] * (len(actions) - len(prior_results))
    results: list[dict[str, Any] | None]

    async def recover() -> None:
        """Undo a half-done action and make the session usable again. Rollback
        expires every instance in the identity map, so `user` and `plan` would
        otherwise lazy-load on next touch — sync IO inside async, which raises
        a greenlet error instead of the real failure."""
        await db.rollback()
        await db.refresh(user)

    await recall_folders(db, user, actions, prior_results, created)

    results = [None] * len(actions)
    for index in apply_order(actions):
        action = actions[index]
        done = prior_results[index]
        if done is not None:
            results[index] = done
            continue
        try:
            from byos_api.ai import undo

            before = await undo.snapshot(db, user, action)  # what this replaces, for Undo
            outcome = await tools.apply_action(db, user, action, created, index)
            ran: dict[str, Any] = {"ok": True, "detail": outcome}
            if before is not None:
                ran["before"] = before
            if index in created:
                ran["folder_id"] = str(created[index])  # so "Fix with Bao" can find it
            results[index] = ran
        except tools.ToolError as exc:
            await recover()
            results[index] = {"ok": False, "detail": str(exc)}
        except Exception as exc:
            await recover()
            results[index] = {"ok": False, "detail": f"failed: {exc}"}

    await db.refresh(plan)  # may have been expired by a recovery above
    plan.status = "applied"
    plan.result = results
    plan.applied_at = datetime.now(UTC)
    await db.commit()
    return results
