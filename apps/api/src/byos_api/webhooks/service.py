from __future__ import annotations

import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.db.models import User, Webhook

# Event types a webhook may subscribe to (plus "*" for all).
EVENT_TYPES = ("file.created", "file.replaced", "file.deleted")


class InvalidEvents(Exception):
    pass


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
