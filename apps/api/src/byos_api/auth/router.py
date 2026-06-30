from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from byos_api.auth import service
from byos_api.auth.dependencies import CurrentUser
from byos_api.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from byos_api.core.config import get_settings
from byos_api.core.db import get_db
from byos_api.core.security import create_access_token

_settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


def _set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        key=_settings.refresh_cookie_name,
        value=raw,
        httponly=True,
        secure=_settings.refresh_cookie_secure,
        samesite="lax",
        max_age=_settings.refresh_token_expire_days * 24 * 3600,
        path="/",
    )


def _access_response(user_id: str) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user_id),
        expires_in=_settings.access_token_expire_minutes * 60,
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: DbDep) -> UserResponse:
    try:
        user = await service.create_user(
            db, email=payload.email, password=payload.password, display_name=payload.display_name
        )
    except service.EmailAlreadyExists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        ) from None
    return UserResponse.model_validate(user)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, db: DbDep) -> TokenResponse:
    try:
        user = await service.authenticate(db, email=payload.email, password=payload.password)
    except service.InvalidCredentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        ) from None
    raw = await service.issue_refresh_token(db, user)
    _set_refresh_cookie(response, raw)
    return _access_response(str(user.id))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: DbDep) -> TokenResponse:
    raw = request.cookies.get(_settings.refresh_cookie_name)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token"
        )
    try:
        user, new_raw = await service.rotate_refresh_token(db, raw)
    except service.InvalidRefreshToken:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from None
    _set_refresh_cookie(response, new_raw)
    return _access_response(str(user.id))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: DbDep) -> None:
    raw = request.cookies.get(_settings.refresh_cookie_name)
    if raw:
        await service.revoke_refresh_token(db, raw)
    response.delete_cookie(_settings.refresh_cookie_name, path="/")


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(user)
