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

from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.ai import llm, tools
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

If the request needs no changes, just answer it."""

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
) -> AsyncIterator[dict[str, Any]]:
    """Drive one agent turn. Yields `step` / `plan` / `answer` / `error` events.

    Takes the already-decrypted `api_key` so a bad credential surfaces as a clean
    error on the request rather than a truncated response body."""
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": f"{system_prompt}\n\n{_SYSTEM}\n\n{_MODE_BRIEF[mode]}"},
        *prior,
        {"role": "user", "content": question},
    ]
    actions: list[dict[str, Any]] = []
    results: list[dict[str, Any] | None] = []
    created: dict[int, uuid.UUID] = {}
    # Files whose content the answer could have drawn on, for source chips.
    cited: dict[str, str] = {}
    answer = ""

    for _ in range(MAX_STEPS):
        try:
            turn = await llm.chat_tools(
                base_url=key.base_url,
                api_key=api_key,
                model=key.model,
                messages=messages,
                tools=tools.schemas(writes=mode is not Mode.READ_ONLY),
                max_tokens=max(key.max_tokens, MIN_STEP_TOKENS),
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
            answer = _strip_thoughts(turn.content)
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

        messages.append(_without_thoughts(turn.raw))
        for call in turn.calls:
            spec = tools.BY_NAME.get(call.name)
            if spec is None:
                result: Any = {"error": f"no such tool '{call.name}'"}
            elif spec.kind == tools.READ:
                try:
                    result = await tools.run_read(
                        db, user, call.name, call.arguments, key=key, strategies=strategies
                    )
                    for hit in (result or {}).get("hits", []) if isinstance(result, dict) else []:
                        if hit.get("file_id"):
                            cited[str(hit["file_id"])] = str(hit.get("name") or "file")
                    yield {
                        "kind": "step",
                        "label": call.name,
                        "detail": _summarise(call.name, call.arguments, result),
                    }
                except tools.ToolError as exc:
                    result = {"error": str(exc)}
                except Exception as exc:  # a broken read shouldn't kill the turn
                    result = {"error": f"tool failed: {exc}"}
            elif len(actions) >= MAX_ACTIONS:
                result = {
                    "error": f"plan is full ({MAX_ACTIONS} changes) — stop proposing and summarise"
                }
            else:
                index = len(actions)
                # Any $new:N the model passes for a folder that already exists
                # for real (auto mode created it this turn) is resolved now, so a
                # queued action never depends on an earlier action having run.
                args = _resolve_known_refs(call.arguments, created)
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
            "I stopped after reaching my step limit. Here's what I have so far — "
            "apply it and ask me to continue if you need more."
        )

    yield {"kind": "answer", "text": answer}
    if cited:
        yield {
            "kind": "sources",
            "sources": [{"id": fid, "name": name} for fid, name in cited.items()],
        }
    if actions:
        yield {"kind": "plan", "actions": actions, "results": results}


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


def _resolve_known_refs(
    args: dict[str, Any], created: dict[int, uuid.UUID]
) -> dict[str, Any]:
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


async def apply(
    db: AsyncSession, user: User, plan: AiActionPlan
) -> list[dict[str, Any] | None]:
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
    results: list[dict[str, Any] | None] = []

    async def recover() -> None:
        """Undo a half-done action and make the session usable again. Rollback
        expires every instance in the identity map, so `user` and `plan` would
        otherwise lazy-load on next touch — sync IO inside async, which raises
        a greenlet error instead of the real failure."""
        await db.rollback()
        await db.refresh(user)

    for index, action in enumerate(actions):
        done = prior_results[index]
        if done is not None:
            results.append(done)
            continue
        try:
            outcome = await tools.apply_action(db, user, action, created, index)
            results.append({"ok": True, "detail": outcome})
        except tools.ToolError as exc:
            await recover()
            results.append({"ok": False, "detail": str(exc)})
        except Exception as exc:
            await recover()
            results.append({"ok": False, "detail": f"failed: {exc}"})

    await db.refresh(plan)  # may have been expired by a recovery above
    plan.status = "applied"
    plan.result = results
    plan.applied_at = datetime.now(UTC)
    await db.commit()
    return results
