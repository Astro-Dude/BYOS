"""A storage's status as the app sees it: a GitHub token past its expiry date
counts as expired before any request has to fail."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from byos_api.db.models import StorageAccount
from byos_api.providers import accounts


def _account(expires: datetime | None, status: str = "connected") -> StorageAccount:
    return StorageAccount(
        provider="github",
        status=status,
        encrypted_credentials="x",
        config={"token_expires_at": expires.isoformat() if expires else None},
    )


def test_a_token_without_an_expiry_stays_connected():
    a = _account(None)
    assert accounts.status(a) == "connected" and accounts.usable(a)


def test_a_token_that_expires_later_is_usable():
    a = _account(datetime.now(UTC) + timedelta(days=3))
    assert accounts.status(a) == "connected" and accounts.usable(a)


def test_a_token_past_its_date_is_expired():
    a = _account(datetime.now(UTC) - timedelta(minutes=1))
    assert accounts.status(a) == "expired" and not accounts.usable(a)


def test_a_disconnected_storage_stays_disconnected():
    a = _account(datetime.now(UTC) - timedelta(days=1), status="disconnected")
    assert accounts.status(a) == "disconnected"
