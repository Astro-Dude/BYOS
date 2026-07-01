"""Access-event capture.

Events are appended on an *isolated* session so a logging failure can never
poison — or be poisoned by — the request that triggered it. ``record_event``
never raises: analytics must not break the download it measures.

Geo/country relies on an edge-provided header (Cloudflare/Vercel set these);
we deliberately avoid bundling a GeoIP database. When BYOS runs without such an
edge, ``country`` is simply null.
"""

from __future__ import annotations

import hashlib
import logging
import uuid

from fastapi import Request

from byos_api.core.config import get_settings
from byos_api.core.db import SessionLocal
from byos_api.db.models import AnalyticsEvent

logger = logging.getLogger("byos.analytics")
_settings = get_settings()


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _hash_ip(ip: str | None) -> str | None:
    """Salted, one-way hash — we can count unique visitors without storing IPs."""
    if not ip:
        return None
    salted = f"{ip}:{_settings.jwt_secret_key}".encode()
    return hashlib.sha256(salted).hexdigest()[:64]


def _browser(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    ua = user_agent.lower()
    # Order matters: Edge/Opera embed "chrome"; Chrome embeds "safari".
    if "edg" in ua:
        return "Edge"
    if "opr" in ua or "opera" in ua:
        return "Opera"
    if "firefox" in ua:
        return "Firefox"
    if "chrome" in ua or "chromium" in ua:
        return "Chrome"
    if "safari" in ua:
        return "Safari"
    if "curl" in ua or "wget" in ua or "python" in ua:
        return "CLI"
    if "bot" in ua or "spider" in ua or "crawl" in ua:
        return "Bot"
    return "Other"


def _country(request: Request) -> str | None:
    for header in ("cf-ipcountry", "x-vercel-ip-country", "x-country"):
        value = request.headers.get(header)
        if value and len(value) == 2 and value.isalpha():
            return value.upper()
    return None


async def record_event(
    request: Request,
    *,
    owner_id: uuid.UUID,
    target_type: str,
    target_id: uuid.UUID,
    event_type: str,
) -> None:
    referrer = request.headers.get("referer")
    event = AnalyticsEvent(
        owner_id=owner_id,
        target_type=target_type,
        target_id=target_id,
        event_type=event_type,
        referrer=referrer[:512] if referrer else None,
        country=_country(request),
        browser=_browser(request.headers.get("user-agent")),
        ip_hash=_hash_ip(_client_ip(request)),
    )
    try:
        async with SessionLocal() as session:
            session.add(event)
            await session.commit()
    except Exception:
        logger.debug("analytics event dropped", exc_info=True)
