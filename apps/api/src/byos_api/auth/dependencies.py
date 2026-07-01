"""FastAPI auth dependencies: resolve the current user from a Bearer access token."""

from __future__ import annotations

import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.apikeys import service as apikeys_service
from byos_api.core.db import get_db
from byos_api.core.security import decode_access_token
from byos_api.db.models import User

_bearer = HTTPBearer(auto_error=False)
_API_KEY_SCHEME = "byosk_"
_unauthorized = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if creds is None:
        raise _unauthorized

    # Programmatic clients present an API key instead of a JWT access token.
    if creds.credentials.startswith(_API_KEY_SCHEME):
        user = await apikeys_service.authenticate(db, creds.credentials)
        if user is None:
            raise _unauthorized
        return user

    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise _unauthorized from None
    if payload.get("type") != "access":
        raise _unauthorized
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise _unauthorized from None
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
