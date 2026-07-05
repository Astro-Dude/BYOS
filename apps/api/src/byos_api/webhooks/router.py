from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.auth.dependencies import CurrentUser, get_session_user
from byos_api.core.db import get_db
from byos_api.webhooks import service
from byos_api.webhooks.schemas import WebhookCreate, WebhookOut

router = APIRouter(
    prefix="/webhooks", tags=["webhooks"], dependencies=[Depends(get_session_user)]
)

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.post("", response_model=WebhookOut, status_code=status.HTTP_201_CREATED)
async def create_webhook(payload: WebhookCreate, user: CurrentUser, db: DbDep) -> WebhookOut:
    try:
        hook = await service.create_webhook(
            db, user, url=str(payload.url), events=payload.events
        )
    except service.InvalidEvents as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown event '{exc}'. Valid: {', '.join(service.EVENT_TYPES)} or '*'",
        ) from None
    except service.InvalidUrl as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    return WebhookOut.model_validate(hook)


@router.get("", response_model=list[WebhookOut])
async def list_webhooks(user: CurrentUser, db: DbDep) -> list[WebhookOut]:
    return [WebhookOut.model_validate(h) for h in await service.list_webhooks(db, user)]


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(webhook_id: uuid.UUID, user: CurrentUser, db: DbDep) -> None:
    await service.delete_webhook(db, user, webhook_id)
