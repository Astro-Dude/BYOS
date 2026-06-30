"""Password hashing (Argon2) and JWT access tokens.

Access tokens are short-lived JWTs. Refresh tokens are opaque high-entropy
strings (see byos_api.auth.service) whose SHA-256 hash is stored for revocation.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc

from byos_api.core.config import get_settings

_ph = PasswordHasher()
_settings = get_settings()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except argon2_exc.VerificationError:
        return False


def needs_rehash(hashed: str) -> bool:
    return _ph.check_needs_rehash(hashed)


def create_access_token(subject: str, *, expires_minutes: int | None = None) -> str:
    now = datetime.now(UTC)
    expire = now + timedelta(minutes=expires_minutes or _settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, _settings.jwt_secret_key, algorithm=_settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT. Raises jwt.PyJWTError on failure."""
    return jwt.decode(token, _settings.jwt_secret_key, algorithms=[_settings.jwt_algorithm])


def generate_refresh_token() -> str:
    """Opaque, URL-safe refresh token (stored hashed, never as plaintext)."""
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """SHA-256 is sufficient for high-entropy random tokens (unlike passwords)."""
    return hashlib.sha256(token.encode()).hexdigest()
