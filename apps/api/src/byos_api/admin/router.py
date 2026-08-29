"""Admin-only platform analytics."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.admin import service
from byos_api.admin.schemas import AdminRow, GrantRequest, PlatformStats
from byos_api.audit import recorder as audit
from byos_api.auth.dependencies import CurrentUser
from byos_api.core.db import get_db
from byos_api.db.models import User

router = APIRouter(prefix="/admin", tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def require_admin(user: CurrentUser) -> User:
    """404, not 403, for non-admins.

    A 403 confirms the endpoint exists and that the caller simply isn't allowed —
    which tells a probing account something. An admin surface is better off
    indistinguishable from a route that isn't there.
    """
    if not service.is_admin(user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


@router.get("/overview", response_model=PlatformStats)
async def overview(_: AdminUser, db: DbDep) -> PlatformStats:
    return PlatformStats.model_validate(await service.platform_stats(db))


@router.get("/admins", response_model=list[AdminRow])
async def list_admins(_: AdminUser, db: DbDep) -> list[AdminRow]:
    return [AdminRow.model_validate(r) for r in await service.list_admins(db)]


@router.post("/admins", response_model=AdminRow, status_code=status.HTTP_201_CREATED)
async def grant_admin(payload: GrantRequest, me: AdminUser, db: DbDep) -> AdminRow:
    """Promote someone by username or phone.

    Idempotent: re-granting an existing admin succeeds and changes nothing, so a
    double click can't produce a confusing error.
    """
    target = await service.find_user(db, payload.identifier)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account matches that username or phone")
    if not target.is_admin:
        await service.set_admin(db, target, True)
    await audit.record(
        me.id, "admin.grant", target_type="user", target_id=str(target.id)
    )
    return AdminRow(
        id=target.id,
        username=target.username,
        phone=target.phone,
        granted=True,
        bootstrap=service.is_bootstrap_admin(target),
    )


@router.delete("/admins/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_admin(user_id: uuid.UUID, me: AdminUser, db: DbDep) -> None:
    """Demote an admin.

    Two guards, both about not losing access to the dashboard entirely:
    you can't revoke yourself, and you can't revoke the last remaining admin.
    The bootstrap account is a special case — its access comes from config, so
    clearing the flag wouldn't remove it and pretending otherwise would mislead.
    """
    if user_id == me.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't revoke your own access")
    target = await db.get(User, user_id)
    if target is None or not target.is_admin:
        return  # idempotent: already not an admin
    if service.is_bootstrap_admin(target):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That account is an admin via ADMIN_IDS — change the environment instead.",
        )
    remaining = [a for a in await service.list_admins(db) if a["id"] != user_id]
    if not remaining:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There must be at least one admin")
    await service.set_admin(db, target, False)
    await audit.record(me.id, "admin.revoke", target_type="user", target_id=str(user_id))
