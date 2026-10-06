"""Revising a plan edits it in place: the old changes carry over, and the model
only drops or adds what the note asks."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from byos_api.ai import agent, llm, tools
from byos_api.ai.modes import Mode

_KEY = SimpleNamespace(
    base_url="https://api.openai.com/v1", model="gpt-5-mini", max_tokens=1024, reasoning_effort=None
)
_USER = SimpleNamespace(display_name=None, username=None, email=None, phone=None)

SEED = [
    {"op": "create_folder", "args": {"name": "Tax", "parent_id": None}, "label": "Create Tax"},
    {
        "op": "move_file",
        "args": {"file_id": "pan", "folder_id": "$new:0"},
        "label": "Move PAN → Tax",
    },
    {
        "op": "move_file",
        "args": {"file_id": "tds", "folder_id": "$new:0"},
        "label": "Move TDS → Tax",
    },
]


@pytest.fixture
def scripted(monkeypatch):
    def install(*turns: llm.ToolTurn) -> list[dict[str, Any]]:
        queue = list(turns)
        offered: list[dict[str, Any]] = []

        async def fake_chat_tools(**kwargs: Any) -> llm.ToolTurn:
            offered.append({t["function"]["name"] for t in kwargs["tools"]})  # type: ignore[arg-type]
            return queue.pop(0)

        monkeypatch.setattr(llm, "chat_tools", fake_chat_tools)
        return offered

    return install


async def _label(_db: Any, _user: Any, op: str, args: dict[str, Any]) -> str:
    return f"{op} {args}"


async def _events(seed: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        e
        async for e in agent.run(
            None,  # type: ignore[arg-type]
            _USER,  # type: ignore[arg-type]
            _KEY,  # type: ignore[arg-type]
            "put my PAN card in Identity instead",
            [],
            api_key="k",
            system_prompt="",
            mode=Mode.ASK,
            seed=seed,
        )
    ]


async def test_a_revision_keeps_the_old_changes_and_applies_only_the_note(scripted, monkeypatch):
    monkeypatch.setattr(tools, "label", _label)
    offered = scripted(
        llm.ToolTurn(
            content="",
            calls=[
                llm.ToolCall(id="1", name="remove_change", arguments={"number": 1}),
                llm.ToolCall(
                    id="2", name="create_folder", arguments={"name": "Identity", "parent_id": None}
                ),
                llm.ToolCall(
                    id="3", name="move_file", arguments={"file_id": "pan", "folder_id": "$new:3"}
                ),
            ],
            raw={"role": "assistant"},
        ),
        llm.ToolTurn(
            content="Moved the PAN card to Identity.", calls=[], raw={"role": "assistant"}
        ),
    )
    events = await _events([dict(a) for a in SEED])

    assert "remove_change" in offered[0]
    plan = next(e for e in events if e["kind"] == "plan")
    ops = [(a["op"], a["args"]) for a in plan["actions"]]
    assert ops == [
        ("create_folder", {"name": "Tax", "parent_id": None}),
        ("move_file", {"file_id": "tds", "folder_id": "$new:0"}),  # kept as it was
        ("create_folder", {"name": "Identity", "parent_id": None}),
        ("move_file", {"file_id": "pan", "folder_id": "$new:2"}),  # renumbered: 3 → 2
    ]
    assert plan["results"] == [None] * 4
    assert any(e["kind"] == "proposed" and "Drop" in e["label"] for e in events)


async def test_remove_change_is_only_offered_when_revising(scripted):
    offered = scripted(
        llm.ToolTurn(content="Nothing to change.", calls=[], raw={"role": "assistant"})
    )
    await _events(None)
    assert "remove_change" not in offered[0]


async def test_a_miscounted_folder_number_is_sent_back_not_planned(scripted, monkeypatch):
    monkeypatch.setattr(tools, "label", _label)
    scripted(
        llm.ToolTurn(
            content="",
            calls=[
                llm.ToolCall(
                    id="1", name="create_folder", arguments={"name": "Identity", "parent_id": None}
                ),
                # 4 is this move's own slot, not the folder (that's 3): a miscount.
                llm.ToolCall(
                    id="2", name="move_file", arguments={"file_id": "pan", "folder_id": "$new:4"}
                ),
            ],
            raw={"role": "assistant"},
        ),
        llm.ToolTurn(
            content="",
            calls=[
                llm.ToolCall(
                    id="3", name="move_file", arguments={"file_id": "pan", "folder_id": "$new:3"}
                )
            ],
            raw={"role": "assistant"},
        ),
        llm.ToolTurn(content="Done.", calls=[], raw={"role": "assistant"}),
    )
    events = await _events([dict(a) for a in SEED])
    plan = next(e for e in events if e["kind"] == "plan")
    moves = [a["args"] for a in plan["actions"] if a["op"] == "move_file"]
    assert {"file_id": "pan", "folder_id": "$new:4"} not in moves  # rejected, never planned
    assert {"file_id": "pan", "folder_id": "$new:3"} in moves  # the corrected call


def test_folders_are_made_first_parents_before_children():
    actions = [
        {"op": "move_file", "args": {"file_id": "a", "folder_id": "$new:3"}},  # 0
        {"op": "create_folder", "args": {"name": "Payslips", "parent_id": "$new:2"}},  # 1
        {"op": "create_folder", "args": {"name": "Finance", "parent_id": ""}},  # 2
        {"op": "create_folder", "args": {"name": "Acme", "parent_id": "$new:1"}},  # 3
        {"op": "add_tag", "args": {"file_id": "a", "name": "payslip"}},  # 4
    ]
    assert agent.apply_order(actions) == [2, 1, 3, 0, 4]


def test_top_of_the_drive_spellings_mean_root():
    for v in [None, "", " ", "null", "root", "/", "My drive"]:
        assert tools.is_root(v), v
    assert tools.normalise_args("create_folder", {"name": "Finance", "parent_id": ""}) == {
        "name": "Finance",
        "parent_id": None,
    }
    # A folder you rename can't be "the root": left alone, so it's rejected.
    assert tools.normalise_args("rename_folder", {"folder_id": ""}) == {"folder_id": ""}


def test_a_made_up_folder_id_is_sent_back():
    bad = agent._bad_folder_ref({"file_id": "a", "folder_id": "Finance"}, [], set())
    assert bad is not None and "isn't a folder id" in bad
    assert agent._bad_folder_ref({"name": "X", "parent_id": None}, [], set()) is None


async def test_asking_for_the_same_folder_twice_plans_it_once(scripted, monkeypatch):
    monkeypatch.setattr(tools, "label", _label)
    scripted(
        llm.ToolTurn(
            content="",
            calls=[
                llm.ToolCall(id="1", name="create_folder", arguments={"name": "Finance"}),
                llm.ToolCall(
                    id="2", name="create_folder", arguments={"name": "finance", "parent_id": ""}
                ),
            ],
            raw={"role": "assistant"},
        ),
        llm.ToolTurn(content="Done.", calls=[], raw={"role": "assistant"}),
    )
    events = await _events(None)
    plan = next(e for e in events if e["kind"] == "plan")
    assert [a["args"].get("name") for a in plan["actions"]] == ["Finance"]
