from __future__ import annotations

import asyncio
import ipaddress
import secrets
import uuid
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core.config import get_settings
from byos_api.db.models import User, Webhook

# Event types a webhook may subscribe to (plus "*" for all).
EVENT_TYPES = ("file.created", "file.replaced", "file.deleted")


class InvalidEvents(Exception):
    pass


class InvalidUrl(Exception):
    pass


async def _validate_url(url: str) -> None:
    """Reject non-http(s) URLs and any host that resolves to an internal
    address (SSRF guard: loopback, private, link-local, reserved, etc.)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise InvalidUrl("URL must be http or https")
    host = parsed.hostname
    if not host:
        raise InvalidUrl("URL must include a host")
    settings = get_settings()
    if settings.is_production and parsed.scheme != "https":
        raise InvalidUrl("HTTPS is required for webhook URLs")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, proto=6)
    except OSError:
        raise InvalidUrl("host does not resolve") from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise InvalidUrl("URL resolves to a disallowed internal address")


def _validate_events(events: list[str]) -> list[str]:
    cleaned = [e.strip() for e in events if e.strip()]
    if not cleaned:
        cleaned = ["*"]
    for event in cleaned:
        if event != "*" and event not in EVENT_TYPES:
            raise InvalidEvents(event)
    return cleaned


async def create_webhook(
    db: AsyncSession, user: User, *, url: str, events: list[str]
) -> Webhook:
    await _validate_url(url)
    hook = Webhook(
        owner_id=user.id,
        url=url,
        secret=secrets.token_urlsafe(32),
        events=_validate_events(events),
        active=True,
    )
    db.add(hook)
    await db.commit()
    await db.refresh(hook)
    return hook


async def list_webhooks(db: AsyncSession, user: User) -> list[Webhook]:
    result = await db.execute(
        select(Webhook).where(Webhook.owner_id == user.id).order_by(Webhook.created_at.desc())
    )
    return list(result.scalars())


async def delete_webhook(db: AsyncSession, user: User, webhook_id: uuid.UUID) -> None:
    hook = await db.get(Webhook, webhook_id)
    if hook is not None and hook.owner_id == user.id:
        await db.delete(hook)
        await db.commit()  # absent → idempotent no-op
