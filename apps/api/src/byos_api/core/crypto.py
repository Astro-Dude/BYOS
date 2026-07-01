"""Symmetric encryption for provider credentials at rest (Fernet).

Used to encrypt sensitive storage-provider material (e.g. a Telegram
StringSession) before it touches the database. The master key comes from
BYOS_ENCRYPTION_KEY. The Fernet instance is built lazily so the rest of the
app imports cleanly even when no key is configured yet (Phase 0).
"""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet

from byos_api.core.config import get_settings


@lru_cache
def _fernet() -> Fernet:
    key = get_settings().byos_encryption_key
    if not key:
        raise RuntimeError("BYOS_ENCRYPTION_KEY is not set; cannot encrypt provider credentials.")
    return Fernet(key.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def decrypt_ttl(token: str, ttl: int) -> str:
    """Decrypt, rejecting tokens older than `ttl` seconds (raises InvalidToken)."""
    return _fernet().decrypt(token.encode(), ttl=ttl).decode()
