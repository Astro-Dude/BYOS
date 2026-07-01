"""Helpers for the provider-agnostic file pipeline: choosing which provider a
user's uploads go to, and reconstructing a decrypted ProviderAccount for a
stored file."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.core import crypto
from byos_api.db.models import File, StorageAccount, User
from byos_api.providers import service as providers_service
from byos_api.storage import ProviderAccount


def split_filename(filename: str) -> tuple[str, str | None]:
    """Return (name, extension). Extension is lowercased, or None if absent."""
    if "." in filename.strip("."):
        ext = filename.rpartition(".")[2].lower()
        return filename, ext or None
    return filename, None


def _account_to_provider_account(account: StorageAccount) -> ProviderAccount:
    return ProviderAccount(
        provider=account.provider,
        id=str(account.id),
        credentials={"session": crypto.decrypt(account.encrypted_credentials or "")},
        config=account.config,
    )


async def resolve_upload_target(
    db: AsyncSession, user: User
) -> tuple[str, ProviderAccount, uuid.UUID | None]:
    """Route uploads to Telegram when connected, otherwise the Local provider."""
    account = await providers_service.get_telegram_account(db, user)
    if account and account.status == "connected" and account.encrypted_credentials:
        return "telegram", _account_to_provider_account(account), account.id
    return "local", ProviderAccount(provider="local"), None


async def account_for_file(db: AsyncSession, user: User, record: File) -> ProviderAccount | None:
    """Build the ProviderAccount needed to read/delete a stored file, or None if
    its provider account is no longer available."""
    if record.provider != "telegram":
        return ProviderAccount(provider="local")

    account: StorageAccount | None = None
    if record.storage_account_id is not None:
        account = await db.get(StorageAccount, record.storage_account_id)
    if account is None:
        account = await providers_service.get_telegram_account(db, user)
    if account is None or not account.encrypted_credentials:
        return None
    return _account_to_provider_account(account)
