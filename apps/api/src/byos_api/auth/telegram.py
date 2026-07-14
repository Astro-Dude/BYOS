"""Telegram-as-identity login.

The multi-step MTProto flow (phone → code → 2FA) authenticates the user AND
provisions their storage. Because no user exists until the flow completes, the
in-progress session is carried to the client as a short-lived Fernet-encrypted
"ticket" (opaque + tamper-proof) rather than server state. On success we
find-or-create a User keyed by telegram_user_id and upsert their Telegram
storage account.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import (
    PasswordHashInvalidError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    SessionPasswordNeededError,
)

from byos_api.auth import service
from byos_api.core import crypto
from byos_api.core.security import hash_password
from byos_api.db.models import StorageAccount, User
from byos_api.providers.service import TelegramNotConfigured, _new_client

_TICKET_TTL = 600  # seconds


class ExpiredTicket(Exception):
    pass


class InvalidCode(Exception):
    pass


class LoginStateError(Exception):
    pass


def _make_ticket(data: dict) -> str:
    return crypto.encrypt(json.dumps(data))


def _read_ticket(ticket: str, expected: str) -> dict:
    try:
        data = json.loads(crypto.decrypt_ttl(ticket, _TICKET_TTL))
    except Exception as exc:
        raise ExpiredTicket from exc
    if data.get("awaiting") != expected:
        raise LoginStateError
    return data


async def _send_code(phone: str, extra: dict) -> str:
    client = _new_client()
    try:
        await client.connect()
        sent = await client.send_code_request(phone)
        session = client.session.save()
    finally:
        await client.disconnect()
    return _make_ticket(
        {
            "phone": phone,
            "hash": sent.phone_code_hash,
            "session": session,
            "awaiting": "code",
            **extra,
        }
    )


async def start_login(phone: str) -> str:
    return await _send_code(phone, {})


async def start_signup(db: AsyncSession, phone: str, username: str, password: str) -> str:
    """Begin sign-up: validate the username and carry it (plus the hashed
    password) inside the encrypted ticket. NOTHING is written to the DB here —
    the account is created atomically only when the OTP verifies."""
    clean = await service.ensure_username_available(db, username)
    return await _send_code(
        phone, {"username": clean, "password_hash": hash_password(password)}
    )


async def verify_code(
    db: AsyncSession, ticket: str, code: str
) -> tuple[str, str | None, User | None]:
    data = _read_ticket(ticket, "code")
    client = _new_client(data["session"])
    try:
        await client.connect()
        try:
            await client.sign_in(phone=data["phone"], code=code, phone_code_hash=data["hash"])
        except SessionPasswordNeededError:
            new_ticket = _make_ticket(
                {
                    "phone": data["phone"],
                    "session": client.session.save(),
                    "awaiting": "password",
                    # Carry sign-up details forward through the 2FA step.
                    "username": data.get("username"),
                    "password_hash": data.get("password_hash"),
                }
            )
            return "password_needed", new_ticket, None
        except (PhoneCodeInvalidError, PhoneCodeExpiredError) as exc:
            raise InvalidCode(str(exc) or "Invalid or expired code") from exc
        user = await _complete(
            db,
            client,
            data["phone"],
            signup_username=data.get("username"),
            signup_password_hash=data.get("password_hash"),
        )
    finally:
        await client.disconnect()
    return "connected", None, user


async def verify_password(
    db: AsyncSession, ticket: str, password: str
) -> tuple[str, str | None, User | None]:
    data = _read_ticket(ticket, "password")
    client = _new_client(data["session"])
    try:
        await client.connect()
        try:
            await client.sign_in(password=password)
        except PasswordHashInvalidError as exc:
            raise InvalidCode("Invalid two-factor password") from exc
        user = await _complete(
            db,
            client,
            data["phone"],
            signup_username=data.get("username"),
            signup_password_hash=data.get("password_hash"),
        )
    finally:
        await client.disconnect()
    return "connected", None, user


async def _complete(
    db: AsyncSession,
    client,
    phone: str,
    *,
    signup_username: str | None = None,
    signup_password_hash: str | None = None,
) -> User:
    me = await client.get_me()
    session = client.session.save()
    tg_id = int(me.id)
    username = getattr(me, "username", None)
    display = getattr(me, "first_name", None) or (f"@{username}" if username else phone)

    user = (
        await db.execute(select(User).where(User.telegram_user_id == tg_id))
    ).scalar_one_or_none()
    if user is None:
        # New account — persist the sign-up username + password now, atomically
        # with the Telegram identity, in a single transaction.
        chosen = signup_username
        if chosen is not None:
            try:
                chosen = await service.ensure_username_available(db, chosen)
            except (service.InvalidUsername, service.UsernameTaken):
                chosen = None  # taken in the meantime → fall back to the setup gate
        user = User(
            telegram_user_id=tg_id,
            display_name=display,
            phone=phone,
            is_verified=True,
            username=chosen,
            password_hash=signup_password_hash,
        )
        db.add(user)
        await db.flush()
    else:
        # Don't overwrite display_name on re-login — the user may have set their
        # own in Profile. (Telegram first_name is only the initial default.)
        user.phone = phone

    account = (
        await db.execute(
            select(StorageAccount).where(
                StorageAccount.user_id == user.id, StorageAccount.provider == "telegram"
            )
        )
    ).scalar_one_or_none()
    if account is None:
        account = StorageAccount(user_id=user.id, provider="telegram")
        db.add(account)
    account.encrypted_credentials = crypto.encrypt(session)
    account.status = "connected"
    account.label = f"@{username}" if username else phone
    account.config = {"telegram_user_id": tg_id, "phone": phone}

    await db.commit()
    await db.refresh(user)
    return user


__all__ = [
    "ExpiredTicket",
    "InvalidCode",
    "LoginStateError",
    "TelegramNotConfigured",
    "start_login",
    "start_signup",
    "verify_code",
    "verify_password",
]
