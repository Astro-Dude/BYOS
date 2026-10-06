"""GitHub storage: files kept as release assets in a repository the user owns.

Why release assets and not commits: an asset can be up to 2 GB (a committed
file tops out at 100 MB), assets don't bloat the git history, and deleting one
really deletes it. A deleted commit would live on in history forever.

Assets are grouped into one release per day (`byos-YYYY-MM-DD`), which keeps
each release well under GitHub's 1,000-assets-per-release limit.

The repository is created on connect, private unless the user says otherwise.
Credentials are a personal access token: classic with the `repo` scope, or
fine-grained with Contents (read and write) and Administration (to create the
repo) on that repository.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx

from byos_api.storage.base import (
    AccessHandle,
    ProviderAccount,
    ProviderAuthError,
    ProviderError,
    ProviderObjectMeta,
    StoredObjectRef,
    tags_account,
)
from byos_api.storage.spool import spool

API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"
NAME = "github"
_MAX_ASSET = 2 * 1024 * 1024 * 1024  # GitHub's per-asset ceiling

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        # Redirects are followed for downloads (GitHub hands out a signed URL);
        # httpx drops the Authorization header when a redirect leaves the origin.
        _client = httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(60, read=300))
    return _client


def _headers(token: str, **extra: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "BYOS",
        **extra,
    }


def _message(response: httpx.Response) -> str:
    try:
        body = response.json()
        msg = body.get("message") if isinstance(body, dict) else None
        errors = body.get("errors") if isinstance(body, dict) else None
        if isinstance(errors, list) and errors and isinstance(errors[0], dict):
            msg = f"{msg}: {errors[0].get('message') or errors[0].get('code')}"
        if msg:
            return str(msg)
    except Exception:
        pass
    return f"GitHub returned HTTP {response.status_code}."


def token_expiry(response: httpx.Response) -> datetime | None:
    """GitHub sends a token's expiry on every response it authenticates, e.g.
    "2026-11-05 12:00:00 UTC". Absent for tokens without one."""
    raw = (response.headers.get("github-authentication-token-expiration") or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S %Z", "%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    return None


def _check(response: httpx.Response, *, what: str) -> None:
    """Turn a GitHub error into one of ours."""
    if response.status_code < 400:
        return
    if response.status_code == 401:
        raise ProviderAuthError(
            "Your GitHub token has expired or was revoked.", provider=NAME, revoked=True
        )
    if response.status_code == 403 and "rate limit" in _message(response).lower():
        raise ProviderError(
            "GitHub's rate limit was hit. Try again in a few minutes.", provider=NAME, status=429
        )
    if response.status_code == 403:
        raise ProviderAuthError(f"The token isn't allowed to {what}.", provider=NAME)
    raise ProviderError(f"GitHub couldn't {what}: {_message(response)}", provider=NAME)


def _safe_name(filename: str) -> str:
    """Asset names: GitHub replaces odd characters itself, but a predictable
    name keeps the release page readable."""
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip("-.")
    return clean[:120] or "file"


def _repo(account: ProviderAccount) -> str:
    return f"{account.config['owner']}/{account.config['repo']}"


def _token(account: ProviderAccount) -> str:
    token = account.credentials.get("token")
    if not token:
        raise ProviderAuthError(
            "No GitHub token is saved for this storage.", provider=NAME, revoked=True
        )
    return str(token)


# ── Connecting ────────────────────────────────────────────────────────────────
async def connect(token: str, repo: str, private: bool) -> dict[str, Any]:
    """Check the token and make sure the storage repository exists, creating it
    (empty, with one commit so releases can be tagged) if it doesn't. Returns
    the config to store. An existing repository keeps its current visibility."""
    http = _http()
    me = await http.get(f"{API}/user", headers=_headers(token))
    if me.status_code == 401:
        raise ProviderAuthError("GitHub didn't accept that token.", provider=NAME)
    _check(me, what="read your account")
    owner = me.json()["login"]
    expires_at = token_expiry(me)

    existing = await http.get(f"{API}/repos/{owner}/{repo}", headers=_headers(token))
    if existing.status_code == 200:
        data = existing.json()
        if not data.get("permissions", {}).get("push", True):
            raise ProviderAuthError(f"The token can't write to {owner}/{repo}.", provider=NAME)
        if data.get("size", 0) == 0 and not data.get("default_branch"):
            raise ProviderError(
                f"{owner}/{repo} is empty. Add a README to it first.", provider=NAME, status=400
            )
    elif existing.status_code == 404:
        created = await http.post(
            f"{API}/user/repos",
            headers=_headers(token),
            json={
                "name": repo,
                "private": private,
                "auto_init": True,
                "description": "Files stored by BYOS. Please don't edit its releases.",
                "has_issues": False,
                "has_wiki": False,
                "has_projects": False,
            },
        )
        _check(created, what="create the repository")
        data = created.json()
    else:
        _check(existing, what="open the repository")
        data = existing.json()

    return {
        "owner": owner,
        "repo": data["name"],
        "private": bool(data.get("private", True)),
        "url": data.get("html_url"),
        # When the token stops working, if it was made with an expiry, so the
        # app can warn ahead of time. None for tokens that never expire.
        "token_expires_at": expires_at.isoformat() if expires_at else None,
    }


async def set_visibility(token: str, owner: str, repo: str, private: bool) -> bool:
    """Make the repository private or public. Returns the visibility it ended on."""
    response = await _http().patch(
        f"{API}/repos/{owner}/{repo}", headers=_headers(token), json={"private": private}
    )
    _check(response, what="change the repository's visibility")
    return bool(response.json().get("private", private))


# ── The provider ──────────────────────────────────────────────────────────────
class GitHubStorageProvider:
    name = NAME

    def __init__(self) -> None:
        # (repo, tag) -> release id, so most uploads skip the lookup.
        self._releases: dict[tuple[str, str], int] = {}

    async def shutdown(self) -> None:
        global _client
        if _client is not None and not _client.is_closed:
            await _client.aclose()
        _client = None

    async def _release_id(self, account: ProviderAccount) -> int:
        repo = _repo(account)
        tag = datetime.now(UTC).strftime("byos-%Y-%m-%d")
        cached = self._releases.get((repo, tag))
        if cached:
            return cached
        token = _token(account)
        http = _http()
        found = await http.get(f"{API}/repos/{repo}/releases/tags/{tag}", headers=_headers(token))
        if found.status_code == 200:
            release_id = int(found.json()["id"])
        else:
            if found.status_code != 404:
                _check(found, what="find today's release")
            created = await http.post(
                f"{API}/repos/{repo}/releases",
                headers=_headers(token),
                json={
                    "tag_name": tag,
                    "name": f"BYOS {tag[5:]}",
                    "body": "Files uploaded through BYOS on this day.",
                    "prerelease": True,
                },
            )
            if created.status_code == 422:  # created by a parallel upload
                again = await http.get(
                    f"{API}/repos/{repo}/releases/tags/{tag}", headers=_headers(token)
                )
                _check(again, what="find today's release")
                release_id = int(again.json()["id"])
            else:
                _check(created, what="create a release to hold files")
                release_id = int(created.json()["id"])
        self._releases[(repo, tag)] = release_id
        return release_id

    @tags_account
    async def upload(
        self,
        account: ProviderAccount,
        stream: AsyncIterator[bytes],
        *,
        filename: str,
        size: int,
        mime: str | None = None,
    ) -> StoredObjectRef:
        token = _token(account)
        spooled = await spool(stream)
        try:
            if spooled.size > _MAX_ASSET:
                raise ProviderError("GitHub stores files up to 2 GB.", provider=NAME, status=413)
            release_id = await self._release_id(account)
            asset_name = f"{uuid.uuid4().hex[:12]}-{_safe_name(filename)}"
            response = await _http().post(
                f"{UPLOADS}/repos/{_repo(account)}/releases/{release_id}/assets?name={quote(asset_name)}",
                headers=_headers(
                    token,
                    **{
                        "Content-Type": mime or "application/octet-stream",
                        "Content-Length": str(spooled.size),
                    },
                ),
                content=spooled.chunks(),
            )
            if response.status_code == 404:
                # The release went away (deleted on GitHub): forget it, retry once.
                self._releases = {k: v for k, v in self._releases.items() if v != release_id}
                raise ProviderError(
                    "GitHub's release for today was removed. Please try again.", provider=NAME
                )
            _check(response, what="upload the file")
            asset = response.json()
        finally:
            spooled.close()
        return StoredObjectRef(
            provider=NAME,
            locator={
                "repo": _repo(account),
                "asset_id": int(asset["id"]),
                "release_id": release_id,
                "name": asset.get("name", asset_name),
                "filename": filename,
                "mime": mime,
            },
            size=spooled.size,
            checksum=spooled.sha256,
        )

    def _asset_url(self, ref: StoredObjectRef, account: ProviderAccount) -> str:
        repo = ref.locator.get("repo") or _repo(account)
        return f"{API}/repos/{repo}/releases/assets/{ref.locator['asset_id']}"

    @tags_account
    async def download(
        self,
        account: ProviderAccount,
        ref: StoredObjectRef,
        *,
        byte_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]:
        headers = _headers(_token(account), Accept="application/octet-stream")
        if byte_range is not None:
            headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
        async with _http().stream(
            "GET", self._asset_url(ref, account), headers=headers
        ) as response:
            if response.status_code == 404:
                raise FileNotFoundError(ref.locator.get("name"))  # deleted on GitHub
            if response.status_code >= 400:
                await response.aread()
                _check(response, what="download the file")
            async for chunk in response.aiter_bytes(256 * 1024):
                yield chunk

    @tags_account
    async def delete(self, account: ProviderAccount, ref: StoredObjectRef) -> None:
        response = await _http().delete(
            self._asset_url(ref, account), headers=_headers(_token(account))
        )
        if response.status_code != 404:  # already gone is fine
            _check(response, what="delete the file")

    @tags_account
    async def get_metadata(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> ProviderObjectMeta:
        response = await _http().get(
            self._asset_url(ref, account), headers=_headers(_token(account))
        )
        if response.status_code == 404:
            return ProviderObjectMeta(size=0, mime=ref.locator.get("mime"), exists=False)
        _check(response, what="read the file's details")
        data = response.json()
        return ProviderObjectMeta(
            size=int(data.get("size", 0)), mime=data.get("content_type"), exists=True
        )

    async def exists(self, account: ProviderAccount, ref: StoredObjectRef) -> bool:
        return (await self.get_metadata(account, ref)).exists

    async def shareable_access(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> AccessHandle:
        # Private repo: BYOS proxies the bytes (auth, analytics, ranges).
        return AccessHandle(kind="proxy")
