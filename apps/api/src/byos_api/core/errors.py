"""Catch-all error handling.

Starlette's ServerErrorMiddleware is the OUTERMOST layer, so a bare unhandled
exception produces a 500 that never passes back through CORSMiddleware — the
response has no Access-Control-Allow-Origin header and browsers misreport the
real error as a CORS failure.

This pure-ASGI middleware sits just inside CORS: it converts unhandled
exceptions into a JSON 500 *before* they reach ServerErrorMiddleware, so the
response flows back out through CORS (and any other outer middleware) and
carries the right headers. It only synthesizes a response if none has started,
so streaming responses are never buffered or corrupted.
"""

from __future__ import annotations

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("byos")


class CatchUnhandledErrorsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("Unhandled application error")
            if response_started:
                # Response already in flight (e.g. streaming) — can't replace it.
                raise
            response = JSONResponse({"detail": "Internal server error"}, status_code=500)
            await response(scope, receive, send)
