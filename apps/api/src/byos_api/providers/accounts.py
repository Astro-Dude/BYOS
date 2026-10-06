"""Storage accounts across providers: connecting GitHub and S3, choosing the
default for uploads, and disconnecting.

Telegram connects at login (providers/service.py); this module treats it as one
storage among several once it's there.

Each account row stays put while files live on it. Disconnecting a storage that
still holds files wipes its credentials and marks it "disconnected" instead of
deleting it, so the files keep their link and come back when the same repo or
bucket is connected again.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core import crypto
from byos_api.db.models import File, StorageAccount, User
from byos_api.providers import service as telegram_service
from byos_api.storage import github, s3

DEFAULT_KEY = "default"

logger = logging.getLogger("byos")


class AccountNotFound(Exception):
    pass


def credentials(account: StorageAccount) -> dict[str, Any]:
    """Decrypted credentials. Telegram stores a bare session string; the others
    store JSON."""
    raw = crypto.decrypt(account.encrypted_credentials or "")
    if account.provider == "telegram":
        return {"session": raw}
    try:
        value = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def is_default(account: StorageAccount) -> bool:
    return bool((account.config or {}).get(DEFAULT_KEY))


def token_expires_at(account: StorageAccount) -> datetime | None:
    """When a GitHub token stops working, if it was made with an expiry."""
    raw = (account.config or {}).get("token_expires_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw))
    except ValueError:
        return None


def status(account: StorageAccount) -> str:
    """The stored status, with a token past its expiry date counted as expired
    before any request has to fail to find out."""
    expires = token_expires_at(account)
    if account.status == "connected" and expires is not None and expires <= datetime.now(UTC):
        return "expired"
    return account.status


def usable(account: StorageAccount) -> bool:
    return status(account) == "connected" and bool(account.encrypted_credentials)


async def flag_rejected(account_id: str | None) -> None:
    """`mark_expired` from outside a request's session (error handlers, public
    downloads). Best effort: the error response matters more than the flag."""
    if not account_id:
        return
    from byos_api.core.db import SessionLocal

    try:
        async with SessionLocal() as db:
            await mark_expired(db, uuid.UUID(account_id))
    except Exception:
        logger.warning("couldn't flag storage %s as expired", account_id, exc_info=True)


async def mark_expired(db: AsyncSession, account_id: uuid.UUID) -> StorageAccount | None:
    """The provider rejected this storage's credentials: flag it so the app
    asks for new ones and uploads stop going there. Its files stay listed and
    work again once it's reconnected. Telegram is left alone, since signing in
    again is what repairs it."""
    account = await db.get(StorageAccount, account_id)
    if account is None or account.provider == "telegram" or account.status != "connected":
        return account
    account.status = "expired"
    await db.commit()
    return account


async def list_accounts(db: AsyncSession, user: User) -> list[StorageAccount]:
    rows = await db.execute(
        select(StorageAccount)
        .where(StorageAccount.user_id == user.id)
        .order_by(StorageAccount.created_at)
    )
    return list(rows.scalars())


async def usage(db: AsyncSession, user: User) -> dict[uuid.UUID, tuple[int, int]]:
    """Files and bytes stored on each account."""
    rows = await db.execute(
        select(File.storage_account_id, func.count(File.id), func.coalesce(func.sum(File.size), 0))
        .where(File.owner_id == user.id, File.storage_account_id.is_not(None))
        .group_by(File.storage_account_id)
    )
    return {r[0]: (int(r[1]), int(r[2])) for r in rows}


async def get_owned(db: AsyncSession, user: User, account_id: uuid.UUID) -> StorageAccount:
    account = await db.get(StorageAccount, account_id)
    if account is None or account.user_id != user.id:
        raise AccountNotFound
    return account


async def default_account(db: AsyncSession, user: User) -> StorageAccount | None:
    """Where uploads go when nobody picks: the chosen default if it's usable,
    else Telegram, else the first storage that works."""
    accounts = [a for a in await list_accounts(db, user) if usable(a)]
    for a in accounts:
        if is_default(a):
            return a
    for a in accounts:
        if a.provider == "telegram":
            return a
    return accounts[0] if accounts else None


async def _upsert(
    db: AsyncSession,
    user: User,
    provider: str,
    match: dict[str, Any],
    *,
    config: dict[str, Any],
    secrets: dict[str, Any],
    label: str,
) -> StorageAccount:
    """Create the account, or revive the existing one for the same repo or
    bucket (so files stored there before reconnect cleanly)."""
    existing = await list_accounts(db, user)
    account = None
    for a in existing:
        if a.provider == provider and all((a.config or {}).get(k) == v for k, v in match.items()):
            account = a
            break
    # Only the first working storage becomes the default on its own. Uploads
    # already going somewhere (Telegram, usually, which is the default without
    # being marked) keep going there until the user picks otherwise.
    others_usable = any(usable(a) for a in existing if a is not account)
    if account is None:
        account = StorageAccount(user_id=user.id, provider=provider)
        db.add(account)
    keep_default = is_default(account)
    account.config = {**config, DEFAULT_KEY: keep_default or not others_usable}
    account.encrypted_credentials = crypto.encrypt(json.dumps(secrets))
    account.status = "connected"
    account.label = label
    await db.commit()
    await db.refresh(account)
    return account


async def connect_github(
    db: AsyncSession, user: User, *, token: str, repo: str, private: bool
) -> StorageAccount:
    config = await github.connect(token.strip(), repo.strip(), private)
    return await _upsert(
        db,
        user,
        "github",
        {"owner": config["owner"], "repo": config["repo"]},
        config=config,
        secrets={"token": token.strip()},
        label=f"{config['owner']}/{config['repo']}",
    )


async def connect_s3(
    db: AsyncSession,
    user: User,
    *,
    endpoint: str | None,
    region: str | None,
    bucket: str,
    prefix: str | None,
    access_key_id: str,
    secret_access_key: str,
) -> StorageAccount:
    secrets = {
        "access_key_id": access_key_id.strip(),
        "secret_access_key": secret_access_key.strip(),
    }
    config = await s3.connect(
        {"endpoint": endpoint, "region": region, "bucket": bucket, "prefix": prefix}, secrets
    )
    host = (config["endpoint"] or "").split("://")[-1].split("/")[0]
    return await _upsert(
        db,
        user,
        "s3",
        {"endpoint": config["endpoint"], "bucket": config["bucket"], "prefix": config["prefix"]},
        config=config,
        secrets=secrets,
        label=f"{config['bucket']}{f' on {host}' if host else ''}",
    )


async def set_default(db: AsyncSession, user: User, account_id: uuid.UUID) -> None:
    target = await get_owned(db, user, account_id)
    if not usable(target):
        raise AccountNotFound
    for a in await list_accounts(db, user):
        want = a.id == target.id
        if is_default(a) != want:
            a.config = {
                **(a.config or {}),
                DEFAULT_KEY: want,
            }  # reassign so the JSON change is saved
    await db.commit()


async def set_github_private(
    db: AsyncSession, user: User, account_id: uuid.UUID, private: bool
) -> StorageAccount:
    account = await get_owned(db, user, account_id)
    if account.provider != "github" or not usable(account):
        raise AccountNotFound
    cfg = account.config or {}
    actual = await github.set_visibility(
        credentials(account)["token"], cfg["owner"], cfg["repo"], private
    )
    account.config = {**cfg, "private": actual}
    await db.commit()
    await db.refresh(account)
    return account


async def disconnect(db: AsyncSession, user: User, account_id: uuid.UUID) -> None:
    account = await get_owned(db, user, account_id)
    if account.provider == "telegram":
        await telegram_service.disconnect(db, user)
        return
    files = (
        await db.execute(select(func.count(File.id)).where(File.storage_account_id == account.id))
    ).scalar_one()
    if files:
        account.encrypted_credentials = None
        account.status = "disconnected"
        account.config = {**(account.config or {}), DEFAULT_KEY: False}
    else:
        await db.delete(account)
    await db.commit()
