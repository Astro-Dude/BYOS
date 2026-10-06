"""The "Show reasoning" add-on: the model's working is split from its answer."""

from __future__ import annotations

from byos_api.ai import agent
from byos_api.ai.router import _answer_only


def test_working_is_split_from_the_answer():
    text = "<reasoning>70,000 + 14,500 = 84,500</reasoning>\n\nYour net pay was ₹84,500."
    assert agent._split_reasoning(text) == (
        "70,000 + 14,500 = 84,500",
        "Your net pay was ₹84,500.",
    )


def test_an_answer_without_working_is_left_alone():
    assert agent._split_reasoning("Just the answer.") == ("", "Just the answer.")


def test_provider_reasoning_is_used_when_the_model_wrote_none():
    assert agent._provider_reasoning({"reasoning_content": " steps "}) == "steps"
    assert agent._provider_reasoning({"reasoning": "why"}) == "why"
    assert agent._provider_reasoning({"content": "x"}) == ""


def test_past_working_isnt_fed_back_to_the_model():
    stored = '<reasoning>long working</reasoning>\n\nThe answer.\x1e{"type":"sources"}\n'
    assert _answer_only(stored) == "The answer."
