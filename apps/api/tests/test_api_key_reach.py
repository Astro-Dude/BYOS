"""What an API key can reach. No database required: this walks the app's routes.

Every route that authenticates the caller must either demand an interactive
login (`get_session_user`) or check the API key's scopes (`require_scope`).
A route that does neither lets any key, whatever it was granted, through.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from fastapi.routing import APIRoute

from byos_api.auth.dependencies import get_principal, get_session_user
from byos_api.main import create_app

# Authenticated routes that are fine for any key: reading who you are.
ANY_KEY = {("GET", "/auth/me")}


def _calls(dependant: Any) -> Iterator[Any]:
    for dep in dependant.dependencies:
        yield dep.call
        yield from _calls(dep)


def _flatten(routes: list[Any]) -> Iterator[APIRoute]:
    # Newer FastAPI keeps an included router as one entry wrapping the original.
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from _flatten(route.original_router.routes)


def _routes() -> Iterator[tuple[str, str, set[Any]]]:
    for route in _flatten(create_app().routes):
        calls = set(_calls(route.dependant))
        for method in route.methods:
            yield method, route.path, calls


def test_every_authenticated_route_checks_session_or_scope() -> None:
    open_to_any_key = []
    for method, path, calls in _routes():
        if get_principal not in calls or (method, path) in ANY_KEY:
            continue  # public, or deliberately open
        scoped = any(getattr(c, "__qualname__", "").startswith("require_scope.") for c in calls)
        if get_session_user not in calls and not scoped:
            open_to_any_key.append(f"{method} {path}")
    assert not open_to_any_key, f"reachable by any API key: {sorted(open_to_any_key)}"


def test_assistant_admin_and_identity_need_a_login() -> None:
    session_only = [
        ("POST", "/ai/agent/chat"),
        ("POST", "/ai/agent/plans/{plan_id}/apply"),
        ("GET", "/admin/overview"),
        ("POST", "/auth/username"),
        ("POST", "/auth/display-name"),
    ]
    routes = {(m, p): calls for m, p, calls in _routes()}
    for key in session_only:
        assert key in routes, f"route moved: {key}"
        assert get_session_user in routes[key], f"{key} accepts API keys"
