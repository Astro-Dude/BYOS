"""Bring Your Own Model (BYOM): call any OpenAI-compatible chat endpoint with
the user's own key. Provider-agnostic — base_url + key + model — so it works
with OpenAI, OpenRouter, Groq, Together, local servers, etc."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from byos_api.core import crypto
from byos_api.db.models import AiConfig

# Roles we accept from callers.
Message = dict[str, str]


class LLMError(Exception):
    """The model endpoint failed (bad response, network, server error)."""


class LLMAuthError(LLMError):
    """The endpoint rejected the API key (401/403)."""


def _endpoint(base_url: str) -> str:
    return base_url.rstrip("/") + "/chat/completions"


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


async def _post(base_url: str, api_key: str, payload: dict, *, timeout_s: float) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                _endpoint(base_url),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise LLMError(f"Couldn't reach the model endpoint: {exc}") from exc
    if response.status_code in (401, 403):
        raise LLMAuthError("The model endpoint rejected your API key.")
    if response.status_code >= 400:
        raise LLMError(_error_detail(response))
    return response


async def chat(cfg: AiConfig, messages: list[Message], *, max_tokens: int | None = None) -> str:
    """Run a chat completion using the user's stored BYOM config."""
    payload: dict = {
        "model": cfg.model,
        "messages": messages,
        "temperature": cfg.temperature,
        "max_tokens": max_tokens or cfg.max_tokens,
    }
    if cfg.top_p is not None:
        payload["top_p"] = cfg.top_p
    response = await _post(
        cfg.base_url, crypto.decrypt(cfg.encrypted_api_key), payload, timeout_s=120
    )
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("Unexpected response shape from the model endpoint.") from exc
    return content or ""


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
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, read=None)) as client:
            async with client.stream(
                "POST", _endpoint(base_url), headers=headers, json=payload
            ) as response:
                if response.status_code in (401, 403):
                    raise LLMAuthError("The model endpoint rejected your API key.")
                if response.status_code >= 400:
                    await response.aread()
                    raise LLMError(_error_detail(response))
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        delta = json.loads(data)["choices"][0]["delta"].get("content")
                    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                        continue
                    if delta:
                        yield delta
    except httpx.HTTPError as exc:
        raise LLMError(f"Couldn't reach the model endpoint: {exc}") from exc


async def validate(base_url: str, api_key: str, model: str) -> None:
    """Cheap round-trip used when saving config — a 1-token completion confirms
    the base URL, key, and model all work together. Raises on failure."""
    await _post(
        base_url,
        api_key,
        {"model": model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
        timeout_s=30,
    )
