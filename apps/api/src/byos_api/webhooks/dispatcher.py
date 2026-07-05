"""Outbound webhook delivery.

``emit`` is fire-and-forget: it schedules delivery on the running loop and
returns immediately, so file operations never wait on a subscriber's endpoint.
Each delivery is a JSON POST signed with the hook's secret (HMAC-SHA256, sent
as ``X-BYOS-Signature: sha256=<hex>``) so receivers can verify authenticity.

This in-process delivery is best-effort — a failed POST is logged and dropped,
and pending deliveries are lost on restart. Production should route ``emit``
through arq (already a dependency) for retries and durability; the call sites
stay identical.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import uuid
from typing import Any

import httpx
from sqlalchemy import select

from byos_api.core.db import SessionLocal
from byos_api.db.models import Webhook

logger = logging.getLogger("byos.webhooks")

_TIMEOUT = 5.0
_tasks: set[asyncio.Task[None]] = set()


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def _deliver(url: str, secret: str, body: bytes) -> None:
    try:
        # follow_redirects stays off so a 3xx can't bounce a validated URL to
        # an internal address (SSRF via redirect).
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
            await client.post(
                url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-BYOS-Signature": sign(secret, body),
                    "User-Agent": "BYOS-Webhook/1.0",
                },
            )
    except Exception:
        logger.debug("webhook delivery to %s failed", url, exc_info=True)


async def _fanout(owner_id: uuid.UUID, event_type: str, payload: dict[str, Any]) -> None:
    async with SessionLocal() as session:
        result = await session.execute(
            select(Webhook).where(Webhook.owner_id == owner_id, Webhook.active.is_(True))
        )
        hooks = list(result.scalars())
    if not hooks:
        return
    body = json.dumps(
        {"event": event_type, "data": payload}, separators=(",", ":")
    ).encode()
    for hook in hooks:
        if "*" in hook.events or event_type in hook.events:
            await _deliver(hook.url, hook.secret, body)


def emit(owner_id: uuid.UUID, event_type: str, payload: dict[str, Any]) -> None:
    try:
        task = asyncio.create_task(_fanout(owner_id, event_type, payload))
    except RuntimeError:
        return  # no running loop (e.g. sync context) — nothing to schedule
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
