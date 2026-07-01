"""Telegram connection lifecycle: stateful MTProto login (phone → code → 2FA)
and account management.

The in-progress Telethon StringSession is Fernet-encrypted and kept in the
`storage_accounts.config` JSON under `pending_session`, alongside the `awaiting`
step. The account's committed `encrypted_credentials` + `status` (the last known
GOOD connection) are only replaced once a login fully succeeds — so re-logging
in never destroys a working session.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import (
    PasswordHashInvalidError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    SessionPasswordNeededError,
)
from telethon.sessions import StringSession

from byos_api.core import crypto
from byos_api.core.config import get_settings
from byos_api.db.models import StorageAccount, User

logger = logging.getLogger("byos")

_PROVIDER = "telegram"


class TelegramNotConfigured(Exception):
    pass


class NoPendingLogin(Exception):
    pass


class InvalidLoginCode(Exception):
    pass


def _new_client(session_string: str = "") -> TelegramClient:
    settings = get_settings()
    if not (settings.telegram_api_id and settings.telegram_api_hash):
        raise TelegramNotConfigured("TELEGRAM_API_ID / TELEGRAM_API_HASH are not set")
    return TelegramClient(
        StringSession(session_string), settings.telegram_api_id, settings.telegram_api_hash
    )


async def _safe_get_me(client: TelegramClient) -> object:
    # get_me() returns None on UnauthorizedError; other hiccups shouldn't fail an
    # otherwise-successful sign_in (the session is already authorized).
    try:
        return await client.get_me()
    except Exception:
        logger.warning("get_me failed after sign_in", exc_info=True)
        return None


async def get_telegram_account(db: AsyncSession, user: User) -> StorageAccount | None:
    result = await db.execute(
        select(StorageAccount).where(
            StorageAccount.user_id == user.id, StorageAccount.provider == _PROVIDER
        )
    )
    return result.scalar_one_or_none()


async def list_accounts(db: AsyncSession, user: User) -> list[StorageAccount]:
    result = await db.execute(select(StorageAccount).where(StorageAccount.user_id == user.id))
    return list(result.scalars())


async def start_login(db: AsyncSession, user: User, phone: str) -> str:
    client = _new_client()
    try:
        await client.connect()
        sent = await client.send_code_request(phone)
        pending_session = client.session.save()
    finally:
        await client.disconnect()

    account = await get_telegram_account(db, user)
    if account is None:
        account = StorageAccount(user_id=user.id, provider=_PROVIDER, status="pending_code")
        db.add(account)
    # Login-in-progress lives only in config; a prior connected session (in
    # encrypted_credentials / status="connected") is preserved until success.
    account.config = {
        "phone": phone,
        "phone_code_hash": sent.phone_code_hash,
        "pending_session": crypto.encrypt(pending_session),
        "awaiting": "code",
    }
    if account.status != "connected":
        account.status = "pending_code"
    await db.commit()
    return "code_sent"


def _require_pending(account: StorageAccount | None) -> dict[str, Any]:
    config = account.config if account else None
    if account is None or not config or "pending_session" not in config:
        raise NoPendingLogin
    return config


async def verify_code(db: AsyncSession, user: User, code: str) -> str:
    account = await get_telegram_account(db, user)
    config = _require_pending(account)
    assert account is not None
    if config.get("awaiting") == "password":
        # Code was already accepted; the client must submit the 2FA password.
        return "password_needed"

    client = _new_client(crypto.decrypt(config["pending_session"]))
    try:
        await client.connect()
        try:
            await client.sign_in(
                phone=config.get("phone"), code=code, phone_code_hash=config.get("phone_code_hash")
            )
        except SessionPasswordNeededError:
            account.config = {
                **config,
                "pending_session": crypto.encrypt(client.session.save()),
                "awaiting": "password",
            }
            if account.status != "connected":
                account.status = "pending_password"
            await db.commit()
            return "password_needed"
        except (PhoneCodeInvalidError, PhoneCodeExpiredError) as exc:
            raise InvalidLoginCode(str(exc) or "Invalid or expired code") from exc
        me = await _safe_get_me(client)
        session_string = client.session.save()
    finally:
        await client.disconnect()

    _mark_connected(account, session_string, me, fallback=config.get("phone"))
    await db.commit()
    return "connected"


async def verify_password(db: AsyncSession, user: User, password: str) -> str:
    account = await get_telegram_account(db, user)
    config = _require_pending(account)
    assert account is not None
    if config.get("awaiting") != "password":
        raise NoPendingLogin

    client = _new_client(crypto.decrypt(config["pending_session"]))
    try:
        await client.connect()
        try:
            await client.sign_in(password=password)
        except PasswordHashInvalidError as exc:
            raise InvalidLoginCode("Invalid two-factor password") from exc
        me = await _safe_get_me(client)
        session_string = client.session.save()
    finally:
        await client.disconnect()

    _mark_connected(account, session_string, me, fallback=config.get("phone"))
    await db.commit()
    return "connected"


async def disconnect(db: AsyncSession, user: User) -> None:
    account = await get_telegram_account(db, user)
    if account is None:
        return

    session_string: str | None = None
    if account.encrypted_credentials:
        try:
            session_string = crypto.decrypt(account.encrypted_credentials)
        except Exception:
            session_string = None

    if session_string:
        try:
            client = _new_client(session_string)
            try:
                await client.connect()
                await client.log_out()
            finally:
                await client.disconnect()
        except Exception:  # best-effort remote logout; always remove the local record
            logger.warning("Telegram log_out failed during disconnect", exc_info=True)
        await _release_pooled(session_string)

    await db.delete(account)
    await db.commit()


async def _release_pooled(session: str) -> None:
    """Evict and disconnect any cached pooled client for this session."""
    try:
        from byos_api.storage.registry import get_provider

        provider = get_provider(_PROVIDER)
    except KeyError:
        return
    release = getattr(provider, "release_session", None)
    if release is not None:
        try:
            await release(session)
        except Exception:
            logger.warning("Failed to release pooled Telegram client", exc_info=True)


def _mark_connected(
    account: StorageAccount, session_string: str, me: object, *, fallback: str | None
) -> None:
    username = getattr(me, "username", None)
    account.encrypted_credentials = crypto.encrypt(session_string)
    account.status = "connected"
    account.label = f"@{username}" if username else fallback
    account.config = {"phone": fallback}  # clears pending_session / phone_code_hash / awaiting
