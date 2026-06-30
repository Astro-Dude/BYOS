"""Smoke tests for password hashing and JWT access tokens. No database required."""

from __future__ import annotations

from byos_api.core.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)


def test_password_hash_roundtrip() -> None:
    hashed = hash_password("s3cret-password")
    assert hashed != "s3cret-password"
    assert verify_password("s3cret-password", hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_access_token_roundtrip() -> None:
    token = create_access_token("user-123")
    payload = decode_access_token(token)
    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"


def test_refresh_token_is_opaque_and_hash_is_stable() -> None:
    raw = generate_refresh_token()
    assert len(raw) > 40
    first = hash_refresh_token(raw)
    second = hash_refresh_token(raw)
    assert first == second
    assert first != raw
    assert len(first) == 64  # sha256 hex
