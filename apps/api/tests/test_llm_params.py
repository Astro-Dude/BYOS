"""Parameter compatibility: reasoning models and providers that reject a
sampling parameter still get a working request."""

from __future__ import annotations

import json

import httpx
import pytest

from byos_api.ai import llm


@pytest.fixture(autouse=True)
def _fresh_state():
    llm._quirks.clear()
    llm._tools_via_responses.clear()
    llm._effort_options.clear()
    llm._declared.clear()
    yield
    llm._quirks.clear()
    llm._tools_via_responses.clear()
    llm._effort_options.clear()
    llm._client = None  # drop the mock so later tests get a real client


def _install(handler) -> list[dict]:
    """Route llm's pooled client through `handler`; return the payloads sent."""
    sent: list[dict] = []

    def record(request: httpx.Request) -> httpx.Response:
        if request.content:
            sent.append(json.loads(request.content))
        return handler(request, sent)

    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(record))
    return sent


def _ok(text: str = "hi") -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


async def test_openai_reasoning_model_is_adjusted_before_sending():
    sent = _install(lambda req, sent: _ok())
    await llm.chat(
        base_url="https://api.openai.com/v1",
        api_key="k",
        model="gpt-5-mini",
        messages=[{"role": "user", "content": "x"}],
        temperature=0.2,
        max_tokens=50,
        top_p=0.9,
    )
    assert sent == [
        {
            "model": "gpt-5-mini",
            "messages": [{"role": "user", "content": "x"}],
            "max_completion_tokens": 50,
            "reasoning_effort": "minimal",
        }
    ]


async def test_gateway_keeps_max_tokens_for_reasoning_model():
    sent = _install(lambda req, sent: _ok())
    await llm.chat(
        base_url="https://openrouter.ai/api/v1",
        api_key="k",
        model="openai/o3",
        messages=[],
        temperature=0.2,
        max_tokens=50,
    )
    assert "max_tokens" in sent[0] and "temperature" not in sent[0]


async def test_ordinary_model_is_untouched():
    sent = _install(lambda req, sent: _ok())
    await llm.chat(
        base_url="https://api.openai.com/v1",
        api_key="k",
        model="gpt-4o-mini",
        messages=[],
        temperature=0.2,
        max_tokens=50,
    )
    assert sent[0]["temperature"] == 0.2 and sent[0]["max_tokens"] == 50


async def test_unknown_unsupported_param_is_dropped_retried_and_remembered():
    def handler(req, sent):
        if "temperature" in sent[-1]:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported value: 'temperature' does not support 0.2 "
                        "with this model.",
                        "param": "temperature",
                        "code": "unsupported_value",
                    }
                },
            )
        return _ok("done")

    sent = _install(handler)
    kwargs = dict(
        base_url="https://example.test/v1",
        api_key="k",
        model="future-model",
        messages=[],
        temperature=0.2,
        max_tokens=50,
    )
    assert await llm.chat(**kwargs) == "done"
    assert len(sent) == 2 and "temperature" not in sent[1]

    # Second call goes straight through: the quirk was learned.
    sent.clear()
    await llm.chat(**kwargs)
    assert len(sent) == 1 and "temperature" not in sent[0]


async def test_max_tokens_renamed_when_provider_names_replacement():
    def handler(req, sent):
        if "max_tokens" in sent[-1]:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported parameter: 'max_tokens' is not supported "
                        "with this model. Use 'max_completion_tokens' instead."
                    }
                },
            )
        return _ok()

    sent = _install(handler)
    await llm.chat(
        base_url="https://example.test/v1", api_key="k", model="m", messages=[], max_tokens=50
    )
    assert sent[-1]["max_completion_tokens"] == 50 and "max_tokens" not in sent[-1]


async def test_unrelated_400_is_not_retried():
    sent = _install(
        lambda req, sent: httpx.Response(400, json={"error": {"message": "Model not found."}})
    )
    with pytest.raises(llm.LLMError, match="Model not found"):
        await llm.chat(base_url="https://example.test/v1", api_key="k", model="m", messages=[])
    assert len(sent) == 1


async def test_streaming_retries_before_any_text():
    def handler(req, sent):
        if "top_p" in sent[-1]:
            return httpx.Response(400, json={"error": {"message": "top_p is not supported."}})
        body = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, text=body)

    sent = _install(handler)
    out = [
        p
        async for p in llm.stream_chat(
            base_url="https://example.test/v1",
            api_key="k",
            model="m",
            messages=[],
            temperature=0.2,
            max_tokens=50,
            top_p=0.5,
        )
    ]
    assert out == ["ok"] and len(sent) == 2


async def test_list_models_reads_openai_and_gemini_shapes():
    _install(
        lambda req, sent: httpx.Response(
            200,
            json={
                "data": [
                    {"id": "models/gemini-2.0-flash"},
                    {"id": "gpt-4o"},
                    {"id": "gpt-4o"},
                ]
            },
        )
    )
    assert await llm.list_models("https://x.test/v1", "k") == ["gemini-2.0-flash", "gpt-4o"]


async def test_validate_passes_when_reasoning_model_runs_out_of_room():
    # The save check used to fail on exactly this: a model that thinks first
    # spends a tiny budget before answering.
    _install(
        lambda req, sent: httpx.Response(
            400,
            json={
                "error": {
                    "message": "Could not finish the message because max_tokens or model "
                    "output limit was reached. Please try again with higher max_tokens."
                }
            },
        )
    )
    check = await llm.validate("https://example.test/v1", "k", "deep-thinker-2")
    assert check.unsupported == []


async def test_validate_reports_refused_sampling_params():
    def handler(req, sent):
        for p in ("temperature", "top_p"):
            if p in sent[-1]:
                return httpx.Response(
                    400,
                    json={
                        "error": {
                            "message": f"Unsupported parameter: '{p}' is not supported "
                            "with this model.",
                            "param": p,
                        }
                    },
                )
        return _ok()

    _install(handler)
    check = await llm.validate("https://example.test/v1", "k", "new-model")
    assert sorted(check.unsupported) == ["temperature", "top_p"]


async def test_validate_known_reasoning_model_reports_without_extra_requests():
    sent = _install(lambda req, sent: _ok())
    check = await llm.validate("https://api.openai.com/v1", "k", "o3-mini")
    assert check.unsupported == ["temperature", "top_p"]
    assert check.efforts == ["low", "medium", "high"]
    assert len(sent) == 1


async def test_validate_still_fails_on_real_errors():
    _install(lambda req, sent: httpx.Response(404, json={"error": {"message": "Model not found."}}))
    with pytest.raises(llm.LLMError, match="Model not found"):
        await llm.validate("https://example.test/v1", "k", "nope")


_TOOLS_REFUSAL = (
    "Function tools with reasoning_effort are not supported for gpt-6.1-sol in "
    "/v1/chat/completions. To use function tools, use /v1/responses or set "
    "reasoning_effort to 'none'."
)
_TOOL = {"type": "function", "function": {"name": "search", "parameters": {"type": "object"}}}


async def test_tools_move_to_the_responses_api_when_chat_refuses_them():
    def handler(req, sent):
        if req.url.path.endswith("/chat/completions"):
            return httpx.Response(400, json={"error": {"message": _TOOLS_REFUSAL}})
        body = sent[-1]
        if any(i.get("type") == "function_call_output" for i in body["input"]):
            return httpx.Response(
                200,
                json={
                    "status": "completed",
                    "output": [
                        {"type": "reasoning", "summary": []},
                        {"type": "message", "content": [{"type": "output_text", "text": "50k"}]},
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "c1",
                        "name": "search",
                        "arguments": '{"q": "salary june"}',
                    }
                ],
            },
        )

    sent = _install(handler)
    args = {
        "base_url": "https://api.openai.com/v1",
        "api_key": "k",
        "model": "gpt-6.1-sol",
        "tools": [_TOOL],
    }
    messages: list[dict] = [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "salary?"},
    ]
    turn = await llm.chat_tools(messages=messages, **args)
    assert [c.name for c in turn.calls] == ["search"] and turn.calls[0].id == "c1"
    first = sent[1]
    assert first["tools"] == [
        {"type": "function", "name": "search", "parameters": {"type": "object"}}
    ]
    assert first["reasoning"] == {"effort": "none"} and "reasoning_effort" not in first
    assert first["input"][1] == {"role": "user", "content": "salary?"}
    assert first["store"] is False and first["max_output_tokens"] == 2048

    # The agent appends the call and its result in chat shape; it goes back as items.
    messages += [turn.raw, {"role": "tool", "tool_call_id": "c1", "content": '{"hits": []}'}]
    turn = await llm.chat_tools(messages=messages, **args)
    assert turn.content == "50k" and not turn.calls
    assert len(sent) == 3  # remembered: straight to /responses, no second refusal
    replay = sent[2]["input"]
    assert {
        "type": "function_call",
        "call_id": "c1",
        "name": "search",
        "arguments": '{"q": "salary june"}',
    } in replay
    assert {"type": "function_call_output", "call_id": "c1", "output": '{"hits": []}'} in replay


async def test_responses_cut_off_reports_length():
    llm._tools_via_responses.add(("https://api.openai.com/v1", "m"))
    _install(
        lambda req, sent: httpx.Response(
            200,
            json={
                "status": "incomplete",
                "incomplete_details": {"reason": "max_output_tokens"},
                "output": [{"type": "reasoning", "summary": []}],
            },
        )
    )
    turn = await llm.chat_tools(
        base_url="https://api.openai.com/v1", api_key="k", model="m", messages=[], tools=[_TOOL]
    )
    assert turn.finish_reason == "length" and not turn.calls


async def test_other_errors_dont_switch_endpoints():
    sent = _install(
        lambda req, sent: httpx.Response(400, json={"error": {"message": "context too long"}})
    )
    with pytest.raises(llm.LLMError):
        await llm.chat_tools(
            base_url="https://api.openai.com/v1", api_key="k", model="m", messages=[], tools=[_TOOL]
        )
    assert len(sent) == 1 and not llm._tools_via_responses


async def test_reasoning_models_get_the_lowest_effort_they_take():
    def handler(req, sent):
        if sent[-1].get("reasoning_effort") in ("none", "minimal"):
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported value: 'reasoning_effort' does not support "
                        f"'{sent[-1]['reasoning_effort']}' with this model. Supported values "
                        "are: 'low', 'medium', 'high', and 'xhigh'.",
                        "param": "reasoning_effort",
                    }
                },
            )
        return _ok()

    sent = _install(handler)
    chat = {"base_url": "https://api.openai.com/v1", "api_key": "k", "messages": []}
    await llm.chat(model="gpt-6.1-sol", **chat)
    assert [p.get("reasoning_effort") for p in sent] == ["none", "low"]
    await llm.chat(model="gpt-6.1-sol", **chat)
    assert sent[-1]["reasoning_effort"] == "low" and len(sent) == 3  # remembered


async def test_known_families_start_at_their_floor():
    assert llm.lowest_effort("o4-mini") == "low"
    assert llm.lowest_effort("openai/gpt-5-mini") == "minimal"
    assert llm.lowest_effort("gpt-5.1") == "none"


async def test_effort_is_dropped_where_it_isnt_taken():
    def handler(req, sent):
        if "reasoning_effort" in sent[-1]:
            return httpx.Response(
                400,
                json={
                    "error": {"message": "Unrecognized request argument supplied: reasoning_effort"}
                },
            )
        return _ok()

    sent = _install(handler)
    await llm.chat(base_url="https://gw.test/v1", api_key="k", model="o3", messages=[])
    assert "reasoning_effort" not in sent[-1]
    await llm.chat(base_url="https://gw.test/v1", api_key="k", model="o3", messages=[])
    assert len(sent) == 3


async def test_plain_models_get_no_effort():
    sent = _install(lambda req, sent: _ok())
    await llm.chat(base_url="https://api.openai.com/v1", api_key="k", model="gpt-4o", messages=[])
    assert "reasoning_effort" not in sent[0]


async def test_validate_reports_the_levels_a_model_lists():
    def handler(req, sent):
        if sent[-1].get("reasoning_effort") == "none":
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported value: 'reasoning_effort' does not support "
                        "'none' with this model. Supported values are: 'low', 'medium', "
                        "'high', and 'xhigh'."
                    }
                },
            )
        return _ok()

    _install(handler)
    check = await llm.validate("https://api.openai.com/v1", "k", "gpt-6.1-sol")
    assert check.efforts == ["low", "medium", "high", "xhigh"]


async def test_validate_reports_no_levels_for_models_without_them():
    def handler(req, sent):
        if "reasoning_effort" in sent[-1]:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported parameter: 'reasoning_effort' is not "
                        "supported with this model.",
                        "param": "reasoning_effort",
                    }
                },
            )
        return _ok()

    _install(handler)
    check = await llm.validate("https://api.openai.com/v1", "k", "gpt-4o")
    assert check.efforts == []


async def test_a_chosen_level_the_model_lacks_moves_to_the_nearest():
    llm._effort_options[("https://api.openai.com/v1", "gpt-6.1-sol")] = ("low", "medium", "high")
    sent = _install(lambda req, sent: _ok())
    chat = {"base_url": "https://api.openai.com/v1", "api_key": "k", "messages": []}
    await llm.chat(model="gpt-6.1-sol", reasoning_effort="minimal", **chat)
    await llm.chat(model="gpt-6.1-sol", reasoning_effort="high", **chat)
    await llm.chat(model="gpt-6.1-sol", reasoning_effort="xhigh", **chat)
    assert [p["reasoning_effort"] for p in sent] == ["low", "high", "high"]


# ── Per provider ──────────────────────────────────────────────────────────────


async def test_openrouter_gets_effort_in_its_own_shape():
    sent = _install(lambda req, sent: _ok())
    await llm.chat(
        base_url="https://openrouter.ai/api/v1",
        api_key="k",
        model="openai/gpt-5-mini",
        messages=[],
        reasoning_effort="high",
    )
    assert sent[0]["reasoning"] == {"effort": "high"} and "reasoning_effort" not in sent[0]


async def test_openrouter_streams_with_its_own_shape_too():
    def handler(req, sent):
        return httpx.Response(
            200, text='data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n'
        )

    sent = _install(handler)
    out = [
        piece
        async for piece in llm.stream_chat(
            base_url="https://openrouter.ai/api/v1",
            api_key="k",
            model="google/gemini-2.5-flash",
            messages=[],
            temperature=0.2,
            max_tokens=50,
            top_p=None,
        )
    ]
    assert out == ["ok"] and sent[0]["reasoning"] == {"effort": "none"}


@pytest.mark.parametrize(
    ("base_url", "model", "floor"),
    [
        ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash", "none"),
        ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-pro", "low"),
        ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3-pro-preview", "low"),
        ("https://api.groq.com/openai/v1", "openai/gpt-oss-20b", "low"),
        ("https://api.together.xyz/v1", "openai/gpt-oss-120b", "low"),
    ],
)
async def test_thinking_models_elsewhere_start_at_their_floor(base_url, model, floor):
    sent = _install(lambda req, sent: _ok())
    await llm.chat(base_url=base_url, api_key="k", model=model, messages=[], temperature=0.3)
    assert sent[0]["reasoning_effort"] == floor
    assert sent[0]["temperature"] == 0.3  # only OpenAI's own reasoning models drop it


async def test_models_that_dont_think_get_no_effort_anywhere():
    sent = _install(lambda req, sent: _ok())
    for base_url, model in [
        ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
        ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"),
        ("https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4.5"),
    ]:
        await llm.chat(base_url=base_url, api_key="k", model=model, messages=[])
    assert all("reasoning_effort" not in p and "reasoning" not in p for p in sent)


async def test_a_model_that_cant_stop_thinking_moves_up_a_level():
    # Gemini's wording when thinking can't be switched off: no list of levels.
    def handler(req, sent):
        if sent[-1].get("reasoning_effort") in ("none", "minimal"):
            return httpx.Response(
                400,
                json=[
                    {
                        "error": {
                            "message": "Budget 0 is invalid. "
                            "This model only works in thinking mode."
                        }
                    }
                ],
            )
        return _ok()

    sent = _install(handler)
    base = "https://generativelanguage.googleapis.com/v1beta/openai"
    await llm.chat(
        base_url=base, api_key="k", model="gemini-2.5-pro-exp", messages=[], reasoning_effort="none"
    )
    assert [p["reasoning_effort"] for p in sent] == ["none", "minimal", "low"]


async def test_groq_lists_levels_its_own_way():
    def handler(req, sent):
        if sent[-1].get("reasoning_effort") == "low":
            return httpx.Response(
                400,
                json={
                    "error": {"message": "`reasoning_effort` must be one of `none` or `default`"}
                },
            )
        return _ok()

    _install(handler)
    check = await llm.validate("https://api.groq.com/openai/v1", "k", "qwen/qwen3-32b")
    assert check.efforts == ["none"]


async def test_groq_drops_effort_for_models_without_it():
    def handler(req, sent):
        if "reasoning_effort" in sent[-1]:
            return httpx.Response(
                400,
                json={"error": {"message": "reasoning_effort is not supported with this model"}},
            )
        return _ok()

    _install(handler)
    check = await llm.validate("https://api.groq.com/openai/v1", "k", "llama-3.3-70b-versatile")
    assert check.efforts == [] and check.unsupported == []


def _openrouter(models: dict[str, list[str]]):
    def handler(req, sent):
        if req.method == "GET":
            return httpx.Response(
                200,
                json={"data": [{"id": m, "supported_parameters": p} for m, p in models.items()]},
            )
        return _ok()

    return handler


async def test_openrouter_check_reads_what_the_model_list_declares():
    sent = _install(
        _openrouter(
            {
                "anthropic/claude-sonnet-4.5": ["max_tokens", "temperature", "reasoning", "tools"],
                "meta-llama/llama-3.3-70b-instruct": ["max_tokens", "temperature", "top_p"],
            }
        )
    )
    base = "https://openrouter.ai/api/v1"
    claude = await llm.validate(base, "k", "anthropic/claude-sonnet-4.5")
    assert claude.efforts == ["low", "medium", "high"] and claude.unsupported == ["top_p"]
    llama = await llm.validate(base, "k", "meta-llama/llama-3.3-70b-instruct")
    assert llama.efforts == [] and llama.unsupported == []
    # What it learned holds for real requests: no effort for llama, no top_p for claude.
    await llm.chat(
        base_url=base,
        api_key="k",
        model="meta-llama/llama-3.3-70b-instruct",
        messages=[],
        reasoning_effort="high",
    )
    assert "reasoning" not in sent[-1]
    await llm.chat(
        base_url=base,
        api_key="k",
        model="anthropic/claude-sonnet-4.5",
        messages=[],
        top_p=0.5,
        reasoning_effort="medium",
    )
    assert "top_p" not in sent[-1] and sent[-1]["reasoning"] == {"effort": "medium"}


def test_providers_are_told_apart():
    assert llm.provider("https://api.openai.com/v1") == "openai"
    assert llm.provider("https://openrouter.ai/api/v1") == "openrouter"
    assert llm.provider("https://generativelanguage.googleapis.com/v1beta/openai") == "gemini"
    assert llm.provider("https://api.groq.com/openai/v1") == "groq"
    assert llm.provider("https://api.together.xyz/v1") == "together"
    assert llm.provider("http://localhost:11434/v1") == "other"
