"""Bring Your Own Model (BYOM): call any OpenAI-compatible chat endpoint with
the user's own key. Provider-agnostic — base_url + key + model — so it works
with OpenAI, OpenRouter, Groq, Together, local servers, etc."""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator
from typing import Any, NamedTuple

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
        429: "Rate limited — you've hit the provider's rate limit or quota. "
        "Wait a moment and retry.",
        402: "This model needs credits on your account.",
        404: "Model not found — check the model name.",
        500: "The provider had a server error — try again shortly.",
        503: "The provider is temporarily unavailable — try again shortly.",
    }
    return hints.get(response.status_code, f"The endpoint returned HTTP {response.status_code}.")


async def _post(
    base_url: str,
    api_key: str,
    payload: dict,
    *,
    timeout_s: float,
    path: str = "/chat/completions",
) -> httpx.Response:
    try:
        response = await client().post(
            base_url.rstrip("/") + path,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout_s,
        )
    except httpx.HTTPError as exc:
        raise LLMUnreachable(f"Couldn't reach the model endpoint: {exc}") from exc
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
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        ).strip()
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
) -> str:
    """One non-streamed chat completion (used for RAG pre-steps: rewrite, HyDE,
    rerank, CRAG grading)."""
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if top_p is not None:
        payload["top_p"] = top_p
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
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        async with client().stream(
            "POST",
            _endpoint(base_url),
            headers=headers,
            json=payload,
            timeout=httpx.Timeout(120, read=None),
        ) as response:
            if response.status_code in (401, 403):
                raise LLMAuthError("The model endpoint rejected your API key.")
            if response.status_code >= 400:
                await response.aread()
                raise LLMError(_error_detail(response))
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
                # Reasoning models stream their thinking in a separate field;
                # wrap it in <think> so the client shows it live, then collapses.
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
    except httpx.HTTPError as exc:
        raise LLMError(f"Couldn't reach the model endpoint: {exc}") from exc


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
) -> ToolTurn:
    """One non-streamed step of a tool-calling loop. Streaming is deliberately
    not used here: tool-call deltas arrive fragmented across providers, and the
    caller needs the whole call before it can act on it."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    response = await _post(base_url, api_key, payload, timeout_s=180)
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


async def validate(base_url: str, api_key: str, model: str) -> None:
    """Cheap round-trip used when saving config — a 1-token completion confirms
    the base URL, key, and model all work together. Raises on failure."""
    await _post(
        base_url,
        api_key,
        {"model": model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
        timeout_s=30,
    )
