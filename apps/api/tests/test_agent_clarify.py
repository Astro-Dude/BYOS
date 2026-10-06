"""The agent asks instead of guessing when a request is ambiguous."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from byos_api.ai import agent, llm, tools


def _user(**fields: Any) -> Any:
    base = {"display_name": None, "username": None, "email": None, "phone": None}
    return SimpleNamespace(**{**base, **fields})


_KEY = SimpleNamespace(
    base_url="https://api.openai.com/v1", model="gpt-5-mini", max_tokens=1024, reasoning_effort=None
)


@pytest.fixture
def scripted(monkeypatch):
    """Replace the model with scripted turns; record what it was sent."""
    seen: list[list[dict[str, Any]]] = []

    def install(*turns: llm.ToolTurn) -> list[list[dict[str, Any]]]:
        queue = list(turns)

        async def fake_chat_tools(**kwargs: Any) -> llm.ToolTurn:
            seen.append(kwargs["messages"])
            return queue.pop(0)

        monkeypatch.setattr(llm, "chat_tools", fake_chat_tools)
        return seen

    return install


async def _run(user: Any, question: str = "my salary in june") -> list[dict[str, Any]]:
    return [
        evt
        async for evt in agent.run(
            None,  # type: ignore[arg-type]
            user,
            _KEY,  # type: ignore[arg-type]
            question,
            [],
            api_key="k",
            system_prompt="",
            mode=agent.Mode.READ_ONLY,
        )
    ]


async def test_a_question_ends_the_turn_with_its_options(scripted):
    call = llm.ToolCall(
        id="c1",
        name="ask_user",
        arguments={"question": "Which June?", "options": ["June 2026", "June 2025", "June 2026"]},
    )
    scripted(llm.ToolTurn(content="", calls=[call], raw={"role": "assistant"}))
    events = await _run(_user(display_name="Asha Rao"))
    events = [e for e in events if e["kind"] != "thinking"]  # progress only, not saved
    assert events == [
        {"kind": "answer", "text": "Which June?"},
        {"kind": "question", "question": "Which June?", "options": ["June 2026", "June 2025"]},
    ]


async def test_the_model_is_told_who_the_user_is(scripted):
    seen = scripted(llm.ToolTurn(content="Done.", calls=[], raw={"role": "assistant"}))
    await _run(_user(display_name="Asha Rao", username="asha"), "my aadhaar number")
    system = seen[0][0]["content"]
    assert "Name: Asha Rao" in system and "Username: asha" in system
    assert "Phone" not in system  # nothing on file, nothing said
    assert "ask_user" in system


def test_asking_is_offered_even_when_read_only():
    names = [t["function"]["name"] for t in tools.schemas(writes=False)]
    assert "ask_user" in names and "move_file" not in names
