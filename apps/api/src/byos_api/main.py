"""FastAPI application entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from byos_api.aliases.router import public_router as alias_public_router
from byos_api.aliases.router import router as aliases_router
from byos_api.auth.router import router as auth_router
from byos_api.core.config import get_settings
from byos_api.core.errors import CatchUnhandledErrorsMiddleware
from byos_api.files.router import router as files_router
from byos_api.folders.router import router as folders_router
from byos_api.providers.router import router as providers_router
from byos_api.storage import (
    available_providers,
    register_default_providers,
    shutdown_providers,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    register_default_providers()
    try:
        yield
    finally:
        await shutdown_providers()


def create_app() -> FastAPI:
    app = FastAPI(
        title="BYOS API",
        version="0.0.0",
        summary="Bring Your Own Storage — unified layer over your own storage providers.",
        lifespan=lifespan,
    )

    # Order matters: the LAST-added middleware is outermost. CORS must wrap the
    # error handler so that synthesized 500s still receive CORS headers.
    app.add_middleware(CatchUnhandledErrorsMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "environment": settings.environment,
            "providers": available_providers(),
        }

    app.include_router(auth_router)
    app.include_router(providers_router)
    app.include_router(folders_router)
    app.include_router(files_router)
    app.include_router(aliases_router)
    app.include_router(alias_public_router)
    return app


app = create_app()
