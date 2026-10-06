"""Bring Your Own Model (BYOM): call any OpenAI-compatible chat endpoint with
the user's own key. Provider-agnostic — base_url + key + model — so it works
with OpenAI, OpenRouter, Groq, Together, local servers, etc."""

from __future__ import annotations

import base64
import json
import re
import time
from collections.abc import AsyncIterator
from typing import Any, NamedTuple
from urllib.parse import urlparse

import httpx

# Roles we accept from callers.
Message = dict[str, str]


class LLMError(Exception):
    """The model endpoint failed (bad response, network, server error)."""


class LLMAuthError(LLMError):
    """The endpoint rejected the API key (401/403)."""


class LLMUnreachable(LLMError):
    """The endpoint couldn't be reached — DNS, connect, or read failure. Worth
    retrying: a burst of indexing requests can trip a resolver for one file and
    succeed on the next."""


class LLMRateLimited(LLMError):
    """The endpoint is throttling us (429). Worth retrying, unlike other errors —
    `retry_after` carries the provider's hint in seconds when it sends one."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def _retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))  # seconds form; HTTP-date form is ignored
    except ValueError:
        return None


def _endpoint(base_url: str) -> str:
    return base_url.rstrip("/") + "/chat/completions"


# ── Parameter compatibility ──────────────────────────────────────────────────
# Not every model takes every sampling parameter. OpenAI's reasoning models (the
# o-series and GPT-5) reject `temperature`/`top_p` outright and want
# `max_completion_tokens` instead of `max_tokens`. Known cases are adjusted before
# sending; anything else is learned from the provider's own 400 ("Unsupported
# parameter: 'x'"), retried without it, and remembered for that model.

# o1, o3-mini, o4-mini, gpt-5, gpt-5-mini, gpt-6.1... but not gpt-5-chat, which
# samples normally. Matched on the last path segment so "openai/o3" (OpenRouter)
# counts.
_REASONING_RE = re.compile(r"^(?:o\d|gpt-(?:[5-9]|\d{2,}))(?!.*-chat)", re.IGNORECASE)

# ── Providers ─────────────────────────────────────────────────────────────────
# Every provider BYOS supports speaks OpenAI's chat format, but they differ on
# reasoning: which models think, which levels they take, and how it's sent.
# OpenRouter wants `reasoning: {effort}`; OpenAI, Gemini, Groq and Together take
# `reasoning_effort`; OpenAI's Responses API nests it like OpenRouter does.


def provider(base_url: str) -> str:
    """Which provider a base URL belongs to, or "other" for custom endpoints."""
    host = (urlparse(base_url.strip()).hostname or "").lower()
    if host == "api.openai.com" or host.endswith(".openai.azure.com"):
        return "openai"
    if host == "openrouter.ai" or host.endswith(".openrouter.ai"):
        return "openrouter"
    if host == "generativelanguage.googleapis.com":
        return "gemini"
    if host.endswith("groq.com"):
        return "groq"
    if host.endswith("together.xyz") or host.endswith("together.ai"):
        return "together"
    return "other"


# ── Reasoning effort ──────────────────────────────────────────────────────────
# Reasoning models think before answering, and by default they think a lot.
# Nothing BYOS asks for (search, tagging, tidying files) needs that, so they're
# sent the lowest effort they accept. Which levels exist varies by model, so we
# start from what each family is known to take and, when a provider answers
# "Supported values are: ...", switch to the lowest of those and remember it.
EFFORT_LEVELS = ("none", "minimal", "low", "medium", "high", "xhigh")
# A refusal is about effort when it names the setting, or reasoning/thinking.
_EFFORT_RE = re.compile(r"reasoning[._ ]?effort|\breasoning\b|\bthinking\b|\beffort\b", re.I)
_SUPPORTED_VALUES_RE = re.compile(
    r"(?:supported values (?:are|is)|valid values (?:are|is)|allowed values (?:are|is)"
    r"|must be one of|expected one of|should be one of)\s*:?\s*(?P<list>.+)",
    re.IGNORECASE,
)
# The level was wrong, not the setting: Gemini 2.5 Pro and Gemini 3 can't stop
# thinking, OpenAI names the value it won't take.
_LEVEL_REFUSED_RE = re.compile(
    r"unsupported value|invalid value|does not support '|only works in thinking"
    r"|cannot be disabled|can't be disabled|cannot disable|budget 0|not a valid",
    re.IGNORECASE,
)

# (normalized base URL, model) -> the levels it offers, lowest first, or None
# when it rejects the setting altogether. Learned from 400s, like _quirks.
_effort_options: dict[tuple[str, str], tuple[str, ...] | None] = {}


def nearest_effort(requested: str, options: tuple[str, ...] | list[str]) -> str:
    """The offered level closest to what was asked: the same, else the next one
    up, else the highest there is."""
    rank = EFFORT_LEVELS.index(requested) if requested in EFFORT_LEVELS else 0
    for option in options:
        if option in EFFORT_LEVELS and EFFORT_LEVELS.index(option) >= rank:
            return option
    return options[-1]


def known_efforts(model: str) -> tuple[str, ...] | None:
    """The levels a model family is known to take, lowest first; None for a
    model we don't know to think (it's then sent no effort unless asked).

    Matched on the last path segment, so OpenRouter's "openai/gpt-5" and Groq's
    "openai/gpt-oss-20b" count."""
    name = model.strip().rsplit("/", 1)[-1].lower()
    if is_reasoning_model(name):
        if re.match(r"^o\d", name):
            return ("low", "medium", "high")  # the o-series starts at low
        if re.match(r"^gpt-5(?![.\d])", name):
            return ("minimal", "low", "medium", "high")  # gpt-5, -mini, -nano
        return ("none", "low", "medium", "high")  # gpt-5.1 onwards can skip thinking
    if name.startswith("gpt-oss"):
        return ("low", "medium", "high")
    if name.startswith("gemini-2.5-pro"):
        return ("low", "medium", "high")  # can't turn thinking off
    if name.startswith("gemini-2.5-flash"):
        return ("none", "low", "medium", "high")
    if name.startswith("gemini-3"):
        return ("minimal", "low", "medium", "high") if "flash" in name else ("low", "high")
    return None


def thinks(model: str) -> bool:
    """Whether a model reasons by default, so should be held to its lowest."""
    return known_efforts(model) is not None


def effort_choices(model: str) -> tuple[str, ...]:
    """The levels to offer for a model we haven't heard a list from."""
    return known_efforts(model) or ("low", "medium", "high")


def lowest_effort(model: str) -> str:
    """Our first guess at a reasoning model's lowest effort."""
    known = known_efforts(model)
    return known[0] if known else "none"


# Parameters we're willing to drop or rename to get a request through. Never
# model/messages/tools: without those the request means something else.
_ADJUSTABLE = (
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "presence_penalty",
    "frequency_penalty",
)

_UNSUPPORTED_RE = re.compile(
    r"unsupported|not supported|does not support|only the default|not allowed|unrecognized",
    re.IGNORECASE,
)

# Wider than _UNSUPPORTED_RE, for effort only: providers word a bad level many
# ways ("invalid", "must be one of", "can't be disabled").
_REFUSAL_RE = re.compile(
    _UNSUPPORTED_RE.pattern + r"|invalid|must be|expected|one of|only works|cannot|can't|unknown",
    re.IGNORECASE,
)

# (normalized base URL, model) -> {param: replacement name, or None to drop}.
# Learned from 400s so only the first request per model pays the extra round-trip.
_quirks: dict[tuple[str, str], dict[str, str | None]] = {}

# (normalized base URL, model) whose tool calls go through the Responses API.
# Some newer OpenAI models refuse function tools on /chat/completions ("To use
# function tools, use /v1/responses"); learned from that refusal, like _quirks.
_tools_via_responses: set[tuple[str, str]] = set()
_RESPONSES_HINT_RE = re.compile(r"/v1/responses|responses api", re.IGNORECASE)


def _norm_base(base_url: str) -> str:
    return base_url.strip().rstrip("/").lower()


def is_reasoning_model(model: str) -> bool:
    """Whether a model is one of OpenAI's reasoning models, which fix their own
    sampling (no temperature/top_p) and count output as completion tokens."""
    return bool(_REASONING_RE.match(model.strip().rsplit("/", 1)[-1]))


def _is_openai_host(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host == "api.openai.com" or host.endswith(".openai.azure.com")


def _prepare(base_url: str, payload: dict[str, Any]) -> dict[str, Any]:
    """The payload this provider/model will accept, as far as we know."""
    out = dict(payload)
    model = str(out.get("model") or "")
    if is_reasoning_model(model):
        if out.get("temperature") not in (None, 1):
            out.pop("temperature", None)
        out.pop("top_p", None)
        # OpenAI itself rejects max_tokens here. Gateways like OpenRouter accept
        # max_tokens and translate it, so only rename for OpenAI's own hosts.
        if "max_tokens" in out and _is_openai_host(base_url):
            out["max_completion_tokens"] = out.pop("max_tokens")
    for param, replacement in _quirks.get((_norm_base(base_url), model), {}).items():
        if param in out:
            value = out.pop(param)
            if replacement:
                out[replacement] = value
    # Reasoning effort: what the caller asked for, else (for reasoning models)
    # the lowest the model takes, kept to the levels the provider said it has.
    key = (_norm_base(base_url), model)
    options = _effort_options.get(key, ())
    requested = out.get("reasoning_effort")
    if options is None:
        out.pop("reasoning_effort", None)
    elif requested is None and (options or thinks(model)):
        out["reasoning_effort"] = options[0] if options else lowest_effort(model)
    elif requested is not None and options:
        out["reasoning_effort"] = nearest_effort(requested, options)
    return out


def _learn_effort(base_url: str, payload: dict[str, Any], message: str) -> dict[str, Any] | None:
    """A refusal about reasoning effort: move to the nearest level the provider
    lists (the lowest, when we asked for the lowest), or stop sending it if the
    model doesn't take it at all."""
    current = payload.get("reasoning_effort")
    if current is None or not _EFFORT_RE.search(message):
        return None
    if _RESPONSES_HINT_RE.search(message):
        return None  # about tools on this endpoint, not the setting (see chat_tools)
    key = (_norm_base(base_url), str(payload.get("model") or ""))
    listed = _SUPPORTED_VALUES_RE.search(message)
    if listed:
        offered = [v.lower() for v in re.findall(r"[A-Za-z]+", listed.group("list"))]
        known = tuple(level for level in EFFORT_LEVELS if level in offered)
        if known:
            _effort_options[key] = known
            nearest = nearest_effort(str(current), known)
            return None if nearest == current else {**payload, "reasoning_effort": nearest}
    if _LEVEL_REFUSED_RE.search(message):
        # A level it doesn't have, with no usable list: try the next one up.
        rank = EFFORT_LEVELS.index(current) if current in EFFORT_LEVELS else -1
        higher = EFFORT_LEVELS[rank + 1 :]
        if not higher or higher[0] == "xhigh":
            return None
        _effort_options[key] = higher[:-1]
        return {**payload, "reasoning_effort": higher[0]}
    # The setting itself isn't taken here.
    _effort_options[key] = None
    return {k: v for k, v in payload.items() if k != "reasoning_effort"}


def _learn_from_error(
    base_url: str, payload: dict[str, Any], response: httpx.Response
) -> dict[str, Any] | None:
    """If a 400 says a parameter we sent isn't supported, return the payload
    without it (renamed when the provider names a replacement) and remember the
    fix. None when the error is about something else."""
    try:
        body = response.json()
    except Exception:
        return None
    if isinstance(body, list) and body:
        body = body[0]
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        message = str(err.get("message") or "")
        named = err.get("param")
    else:
        message = str(err or (body.get("message") if isinstance(body, dict) else "") or "")
        named = None
    if _REFUSAL_RE.search(message):
        effort = _learn_effort(base_url, payload, message)
        if effort is not None:
            return effort
    if not _UNSUPPORTED_RE.search(message):
        return None
    lowered = message.lower()
    culprits = (
        [named]
        if isinstance(named, str) and named in payload
        else [p for p in _ADJUSTABLE if p in payload and re.search(rf"\b{p}\b", lowered)]
    )
    culprits = [c for c in culprits if c in _ADJUSTABLE]
    if not culprits:
        return None
    fixed = dict(payload)
    learned = _quirks.setdefault((_norm_base(base_url), str(payload.get("model") or "")), {})
    for param in culprits:
        value = fixed.pop(param)
        replacement = (
            "max_completion_tokens"
            if param == "max_tokens" and "max_completion_tokens" in lowered
            else None
        )
        if replacement:
            fixed[replacement] = value
        learned[param] = replacement
    return fixed


# How many unsupported parameters one request may shed before we give up.
_MAX_ADJUSTMENTS = 3


# A single pooled client for every provider call. Building one per request meant a
# fresh DNS lookup and TLS handshake each time — under an indexing burst that
# intermittently failed with EAI_NONAME ("nodename nor servname provided"), which
# surfaced as one file mysteriously skipped. Pooling reuses connections and the
# resolver result. Timeouts stay per-request.
_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
            follow_redirects=True,
        )
    return _client


async def aclose() -> None:
    """Close the pooled client — called from the app's lifespan shutdown."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def _error_detail(response: httpx.Response) -> str:
    # Pull just the human-readable message out of the provider's error body
    # (which may be a dict or, for Google, a single-element list) — never dump
    # the raw JSON at the user.
    try:
        body = response.json()
        if isinstance(body, list) and body:
            body = body[0]
        if isinstance(body, dict):
            err = body.get("error")
            msg = None
            if isinstance(err, dict):
                msg = err.get("message")
            elif isinstance(err, str):
                msg = err
            msg = msg or body.get("message")
            if isinstance(msg, str) and msg.strip():
                clean = msg.strip()
                return clean if len(clean) <= 300 else clean[:297] + "…"
    except Exception:
        pass
    # No usable message — a short, plain-language fallback per status.
    hints = {
        429: "You've hit the provider's rate limit or quota. Wait a moment and retry.",
        402: "This model needs credits on your account.",
        404: "Model not found. Check the model name.",
        500: "The provider had a server error. Try again soon.",
        503: "The provider is down for now. Try again soon.",
    }
    return hints.get(response.status_code, f"The endpoint returned HTTP {response.status_code}.")


def _wire(base_url: str, payload: dict[str, Any], path: str) -> dict[str, Any]:
    """The payload as this provider wants it sent. Effort is carried internally
    as `reasoning_effort`; the Responses API and OpenRouter nest it instead."""
    if "reasoning_effort" not in payload:
        return payload
    if path == "/responses" or provider(base_url) == "openrouter":
        wire = {k: v for k, v in payload.items() if k != "reasoning_effort"}
        wire["reasoning"] = {"effort": payload["reasoning_effort"]}
        return wire
    return payload


async def _post(
    base_url: str,
    api_key: str,
    payload: dict,
    *,
    timeout_s: float,
    path: str = "/chat/completions",
) -> httpx.Response:
    payload = _prepare(base_url, payload)
    for _ in range(_MAX_ADJUSTMENTS + 1):
        wire = _wire(base_url, payload, path)
        try:
            response = await client().post(
                base_url.rstrip("/") + path,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=wire,
                timeout=timeout_s,
            )
        except httpx.HTTPError as exc:
            raise LLMUnreachable(f"Couldn't reach the model endpoint: {exc}") from exc
        if response.status_code != 400:
            break
        retry = _learn_from_error(base_url, payload, response)
        if retry is None:
            break
        payload = retry
    if response.status_code in (401, 403):
        raise LLMAuthError("The model endpoint rejected your API key.")
    if response.status_code == 429:
        raise LLMRateLimited(_error_detail(response), _retry_after(response))
    if response.status_code >= 400:
        raise LLMError(_error_detail(response))
    return response


def _message_content(response: httpx.Response) -> str:
    """Pull the assistant text out of a non-streamed completion. Most providers
    return a plain string; some gateways return OpenAI-style content parts, which
    show up mainly on multimodal calls."""
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("Unexpected response shape from the model endpoint.") from exc
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict)).strip()
    return (content or "").strip()


async def chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[Message],
    temperature: float = 0.2,
    max_tokens: int = 1024,
    top_p: float | None = None,
    reasoning_effort: str | None = None,
) -> str:
    """One non-streamed chat completion (used for RAG pre-steps: rewrite, HyDE,
    rerank, CRAG grading). `reasoning_effort` None means the model's lowest."""
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if top_p is not None:
        payload["top_p"] = top_p
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    response = await _post(base_url, api_key, payload, timeout_s=120)
    return _message_content(response)


async def stream_chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[Message],
    temperature: float,
    max_tokens: int,
    top_p: float | None,
    reasoning_effort: str | None = None,
) -> AsyncIterator[str]:
    """Stream a chat completion token-by-token (OpenAI-compatible SSE). Takes
    plain params (not the ORM config) so it's safe to consume after the request
    DB session closes — used from a StreamingResponse body."""
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if top_p is not None:
        payload["top_p"] = top_p
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    payload = _prepare(base_url, payload)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        for attempt in range(_MAX_ADJUSTMENTS + 1):
            async with client().stream(
                "POST",
                _endpoint(base_url),
                headers=headers,
                json=_wire(base_url, payload, "/chat/completions"),
                timeout=httpx.Timeout(120, read=None),
            ) as response:
                if response.status_code in (401, 403):
                    raise LLMAuthError("The model endpoint rejected your API key.")
                if response.status_code >= 400:
                    await response.aread()
                    retry = (
                        _learn_from_error(base_url, payload, response)
                        if response.status_code == 400 and attempt < _MAX_ADJUSTMENTS
                        else None
                    )
                    if retry is not None:
                        payload = retry
                        continue
                    raise LLMError(_error_detail(response))
                async for piece in _stream_pieces(response):
                    yield piece
                return
    except httpx.HTTPError as exc:
        raise LLMError(f"Couldn't reach the model endpoint: {exc}") from exc


async def _stream_pieces(response: httpx.Response) -> AsyncIterator[str]:
    """Text out of an OpenAI-compatible SSE body. Reasoning models stream their
    thinking in a separate field; wrap it in <think> so the client shows it live,
    then collapses."""
    in_think = False
    async for line in response.aiter_lines():
        line = line.strip()
        if not line or not line.startswith("data:"):
            continue
        data = line[len("data:") :].strip()
        if data == "[DONE]":
            break
        try:
            delta = json.loads(data)["choices"][0]["delta"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError):
            continue
        reasoning = delta.get("reasoning_content") or delta.get("reasoning")
        content = delta.get("content")
        if reasoning:
            if not in_think:
                in_think = True
                yield "<think>"
            yield reasoning
        if content:
            if in_think:
                in_think = False
                yield "</think>"
            yield content
    if in_think:
        yield "</think>"


class ToolCall(NamedTuple):
    id: str
    name: str
    arguments: dict[str, Any]


class ToolTurn(NamedTuple):
    """One assistant turn in a tool-calling loop: prose, tool calls, or both."""

    content: str
    calls: list[ToolCall]
    raw: dict[str, Any]  # the raw assistant message, to append verbatim to history
    # Provider's finish_reason. "length" means the reply was cut off mid-thought,
    # which for a tool-calling step means the tool calls never arrived.
    finish_reason: str = ""


def _parse_tool_calls(message: dict[str, Any]) -> list[ToolCall]:
    """Read OpenAI-style `tool_calls` off an assistant message. A model that
    emits unparseable arguments is treated as having made no call — better a
    missing action than one built from garbage."""
    parsed: list[ToolCall] = []
    for call in message.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        fn = call.get("function") or {}
        name = fn.get("name")
        if not isinstance(name, str):
            continue
        raw_args = fn.get("arguments")
        try:
            if isinstance(raw_args, str) and raw_args:
                args = json.loads(raw_args)
            else:
                args = raw_args or {}
        except json.JSONDecodeError:
            continue
        if not isinstance(args, dict):
            continue
        parsed.append(ToolCall(id=str(call.get("id") or name), name=name, arguments=args))
    return parsed


async def chat_tools(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    temperature: float = 0.0,
    max_tokens: int = 2048,
    reasoning_effort: str | None = None,
) -> ToolTurn:
    """One non-streamed step of a tool-calling loop. Streaming is deliberately
    not used here: tool-call deltas arrive fragmented across providers, and the
    caller needs the whole call before it can act on it."""
    key = (_norm_base(base_url), model)
    if key in _tools_via_responses:
        return await _chat_tools_responses(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=messages,
            tools=tools,
            temperature=temperature,
            max_tokens=max_tokens,
            reasoning_effort=reasoning_effort,
        )
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    try:
        response = await _post(base_url, api_key, payload, timeout_s=180)
    except LLMError as exc:
        # Only a plain refusal that points at the Responses API; auth, rate
        # limits and network trouble mean the same thing on either endpoint.
        if type(exc) is not LLMError or not _RESPONSES_HINT_RE.search(str(exc)):
            raise
        _tools_via_responses.add(key)
        return await _chat_tools_responses(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=messages,
            tools=tools,
            temperature=temperature,
            max_tokens=max_tokens,
            reasoning_effort=reasoning_effort,
        )
    try:
        choice = response.json()["choices"][0]
        message = choice["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("Unexpected response shape from the model endpoint.") from exc
    if not isinstance(message, dict):
        raise LLMError("Unexpected response shape from the model endpoint.")
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ToolTurn(
        content=(content or "").strip(),
        calls=_parse_tool_calls(message),
        raw=message,
        finish_reason=str(choice.get("finish_reason") or ""),
    )


# ── Tool calls through the Responses API ─────────────────────────────────────
# The agent keeps its history in Chat Completions shape; these translate it to
# Responses items and back, so the loop doesn't care which endpoint answered.


def _as_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return "" if content is None else json.dumps(content)


def _responses_content(content: Any) -> Any:
    """A message's content as Responses parts: text and images."""
    if not isinstance(content, list):
        return _as_text(content)
    parts: list[dict[str, Any]] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            parts.append({"type": "input_text", "text": part.get("text", "")})
        elif part.get("type") == "image_url":
            image = part.get("image_url")
            url = image.get("url") if isinstance(image, dict) else image
            if url:
                parts.append({"type": "input_image", "image_url": url})
    return parts


def _responses_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        if role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": m.get("tool_call_id"),
                    "output": _as_text(m.get("content")),
                }
            )
        elif role == "assistant":
            text = _as_text(m.get("content"))
            if text:
                items.append({"role": "assistant", "content": text})
            for call in m.get("tool_calls") or []:
                fn = call.get("function") or {}
                items.append(
                    {
                        "type": "function_call",
                        "call_id": call.get("id"),
                        "name": fn.get("name"),
                        "arguments": fn.get("arguments") or "{}",
                    }
                )
        else:
            items.append(
                {
                    "role": role if role in ("system", "developer", "user") else "user",
                    "content": _responses_content(m.get("content")),
                }
            )
    return items


def _responses_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Chat-style {"type": "function", "function": {...}} to Responses' flat form."""
    out: list[dict[str, Any]] = []
    for tool in tools:
        fn = tool.get("function") if tool.get("type") == "function" else None
        if isinstance(fn, dict):
            out.append({"type": "function", **fn})
        else:
            out.append(tool)
    return out


async def _chat_tools_responses(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
    reasoning_effort: str | None = None,
) -> ToolTurn:
    payload: dict[str, Any] = {
        "model": model,
        "input": _responses_input(messages),
        "tools": _responses_tools(tools),
        "tool_choice": "auto",
        "temperature": temperature,
        "max_output_tokens": max_tokens,
        # Nothing kept on the provider's side: the history travels each time.
        "store": False,
    }
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    response = await _post(base_url, api_key, payload, timeout_s=180, path="/responses")
    try:
        data = response.json()
        output = data["output"]
    except (KeyError, TypeError, ValueError) as exc:
        raise LLMError("Unexpected response shape from the model endpoint.") from exc
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    for item in output if isinstance(output, list) else []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "message":
            for part in item.get("content") or []:
                if isinstance(part, dict) and part.get("type") in ("output_text", "text"):
                    texts.append(part.get("text", ""))
        elif item.get("type") == "function_call":
            calls.append(
                {
                    "id": item.get("call_id") or item.get("id"),
                    "type": "function",
                    "function": {
                        "name": item.get("name"),
                        "arguments": item.get("arguments") or "{}",
                    },
                }
            )
    content = "".join(texts).strip()
    raw: dict[str, Any] = {"role": "assistant", "content": content or None}
    if calls:
        raw["tool_calls"] = calls
    parsed = _parse_tool_calls(raw)
    incomplete = (data.get("incomplete_details") or {}).get("reason")
    if data.get("status") == "incomplete" and incomplete == "max_output_tokens":
        finish = "length"
    else:
        finish = "tool_calls" if parsed else "stop"
    return ToolTurn(content=content, calls=parsed, raw=raw, finish_reason=finish)


async def vision(
    *,
    base_url: str,
    api_key: str,
    model: str,
    image: bytes,
    mime: str,
    prompt: str,
    max_tokens: int,
) -> str:
    """One non-streamed completion over a single inline image, using the
    OpenAI-compatible multimodal `content` parts that OpenAI, OpenRouter,
    Anthropic-compatible gateways, Gemini's OpenAI shim and vLLM all accept.

    Raises LLMError if the model isn't multimodal — callers are expected to treat
    that as "no text available" rather than a failure. Temperature is pinned to 0:
    this is transcription, not generation."""
    data_url = f"data:{mime};base64,{base64.b64encode(image).decode('ascii')}"
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }
    ]
    response = await _post(
        base_url,
        api_key,
        {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0},
        timeout_s=180,  # a dense page can take a while on a slow provider
    )
    return _message_content(response)


async def embed(
    base_url: str, api_key: str, model: str, inputs: list[str], *, batch: int = 64
) -> list[list[float]]:
    """Embed texts via an OpenAI-compatible /embeddings endpoint, batched."""
    vectors: list[list[float]] = []
    for i in range(0, len(inputs), batch):
        response = await _post(
            base_url,
            api_key,
            {"model": model, "input": inputs[i : i + batch]},
            timeout_s=60,
            path="/embeddings",
        )
        try:
            data = response.json()["data"]
            vectors.extend(item["embedding"] for item in data)
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("Unexpected response from the embeddings endpoint.") from exc
    return vectors


# A test request that ran out of room still proves the URL, key and model work.
# Reasoning models hit this on a tiny budget: they think before they answer.
_OUTPUT_LIMIT_RE = re.compile(
    r"limit was reached|output limit|could not finish the message", re.IGNORECASE
)

# Sampling parameters a model may refuse, and the values used to test them. Not
# the defaults: some models accept only their default (temperature 1), so a
# default value would pass the test and then fail with the user's real setting.
_PROBE_SAMPLING = {"temperature": 0.5, "top_p": 0.5}


class ModelCheck(NamedTuple):
    #: Sampling parameters the model refuses ("temperature", "top_p").
    unsupported: list[str]
    #: Reasoning effort levels it takes, lowest first; empty if it has none.
    efforts: list[str]


async def validate(base_url: str, api_key: str, model: str) -> ModelCheck:
    """Check that the URL, key and model work together, and find out what this
    model takes. One tiny completion with temperature, top_p and a reasoning
    effort set: whatever the provider rejects is dropped or adjusted and retried
    (see `_learn_from_error`) and reported back, so the settings can switch
    those fields off. Raises on any other failure.

    OpenRouter passes on what the model's host accepts and quietly drops the
    rest, so a refusal never comes back; its model list says what each model
    takes instead, and that's used."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 16,
        **_PROBE_SAMPLING,
        # Any model may take it, not only the ones we know to think.
        "reasoning_effort": lowest_effort(model) if thinks(model) else "low",
    }
    try:
        await _post(base_url, api_key, payload, timeout_s=30)
    except LLMError as exc:
        if isinstance(exc, (LLMAuthError, LLMRateLimited)) or not _OUTPUT_LIMIT_RE.search(str(exc)):
            raise
    key = (_norm_base(base_url), model)
    if provider(base_url) == "openrouter":
        declared = await _declared_params(base_url, api_key, model)
        if declared:
            learned = _quirks.setdefault(key, {})
            for param in _PROBE_SAMPLING:
                if param not in declared:
                    learned[param] = None
            reasons = "reasoning" in declared or "reasoning_effort" in declared
            _effort_options[key] = effort_choices(model) if reasons else None
    # What survived is what _prepare now sends: known rules plus anything just
    # learned from the provider's errors.
    sent = _prepare(base_url, payload)
    learned_efforts = _effort_options.get(key, ())
    if learned_efforts is None or "reasoning_effort" not in sent:
        efforts: list[str] = []
    elif learned_efforts:
        efforts = list(learned_efforts)
    else:
        efforts = list(effort_choices(model))
    return ModelCheck(unsupported=[p for p in _PROBE_SAMPLING if p not in sent], efforts=efforts)


# OpenRouter's model list, with what each model takes: base URL -> (fetched at,
# {model id: parameter names}). Public and the same for everyone; an hour old
# is fresh enough.
_declared: dict[str, tuple[float, dict[str, set[str]]]] = {}
_DECLARED_TTL_S = 3600


async def _declared_params(base_url: str, api_key: str, model: str) -> set[str] | None:
    """The parameters a provider's model list says this model takes, or None
    when the list doesn't say (or couldn't be fetched)."""
    base = _norm_base(base_url)
    cached = _declared.get(base)
    if cached is None or time.monotonic() - cached[0] > _DECLARED_TTL_S:
        try:
            response = await client().get(
                base_url.rstrip("/") + "/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=20,
            )
            rows = response.json().get("data") if response.status_code < 400 else None
        except (httpx.HTTPError, ValueError, AttributeError):
            return None
        table: dict[str, set[str]] = {}
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, dict) and isinstance(row.get("id"), str):
                params = row.get("supported_parameters")
                if isinstance(params, list):
                    table[row["id"]] = {str(p) for p in params}
        cached = (time.monotonic(), table)
        _declared[base] = cached
    return cached[1].get(model)


async def list_models(base_url: str, api_key: str) -> list[str]:
    """Model ids this key can use, from the provider's OpenAI-compatible
    `GET /models`. Gemini's shim prefixes ids with "models/", which its own chat
    endpoint doesn't want back, so that's stripped."""
    try:
        response = await client().get(
            base_url.rstrip("/") + "/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=20,
        )
    except httpx.HTTPError as exc:
        raise LLMUnreachable(f"Couldn't reach the model endpoint: {exc}") from exc
    if response.status_code in (401, 403):
        raise LLMAuthError("The model endpoint rejected your API key.")
    if response.status_code >= 400:
        raise LLMError(_error_detail(response))
    try:
        body = response.json()
    except ValueError as exc:
        raise LLMError("This endpoint didn't return a model list.") from exc
    rows = body.get("data", body.get("models")) if isinstance(body, dict) else body
    ids: set[str] = set()
    for row in rows if isinstance(rows, list) else []:
        raw = row.get("id") or row.get("name") if isinstance(row, dict) else row
        if isinstance(raw, str) and raw.strip():
            ids.add(raw.strip().removeprefix("models/"))
    return sorted(ids, key=str.lower)
