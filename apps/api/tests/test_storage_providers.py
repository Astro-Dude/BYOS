"""GitHub and S3 storage against fakes: GitHub's HTTP API through a mock
transport, S3 through a stand-in boto3 client."""

from __future__ import annotations

import io
import json

import httpx
import pytest

from byos_api.storage import github, s3
from byos_api.storage.base import ProviderAccount, ProviderAuthError, ProviderError, StoredObjectRef


async def _stream(data: bytes):
    for i in range(0, len(data), 7):
        yield data[i : i + 7]


# ── GitHub ────────────────────────────────────────────────────────────────────
class FakeGitHub:
    """Just enough of GitHub's API: a user, repos, releases and assets."""

    def __init__(self) -> None:
        self.repos: dict[str, dict] = {}
        self.releases: dict[str, int] = {}
        self.assets: dict[int, bytes] = {}
        self.calls: list[tuple[str, str]] = []
        self.token_ok = True
        self.expiry: str | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append((method, path))
        if not self.token_ok:
            return httpx.Response(401, json={"message": "Bad credentials"})
        if path == "/user":
            headers = {"github-authentication-token-expiration": self.expiry} if self.expiry else {}
            return httpx.Response(200, json={"login": "ada"}, headers=headers)
        if path.startswith("/repos/ada/") and path.count("/") == 3:
            name = path.split("/")[3]
            if method == "GET":
                repo = self.repos.get(name)
                return (
                    httpx.Response(200, json=repo)
                    if repo
                    else httpx.Response(404, json={"message": "Not Found"})
                )
        if path == "/user/repos" and method == "POST":
            body = json.loads(request.content)
            self.repos[body["name"]] = {
                "name": body["name"],
                "private": body["private"],
                "html_url": f"https://github.com/ada/{body['name']}",
                "default_branch": "main",
                "size": 1,
            }
            return httpx.Response(201, json=self.repos[body["name"]])
        if "/releases/tags/" in path:
            tag = path.rsplit("/", 1)[-1]
            rid = self.releases.get(tag)
            return httpx.Response(200, json={"id": rid}) if rid else httpx.Response(404, json={})
        if path.endswith("/releases") and method == "POST":
            tag = json.loads(request.content)["tag_name"]
            self.releases[tag] = 100 + len(self.releases)
            return httpx.Response(201, json={"id": self.releases[tag]})
        if request.url.host == "uploads.github.com" and method == "POST":
            assert request.headers["content-length"]  # GitHub needs the length up front
            aid = 500 + len(self.assets)
            self.assets[aid] = request.read()
            return httpx.Response(201, json={"id": aid, "name": request.url.params["name"]})
        if "/releases/assets/" in path:
            aid = int(path.rsplit("/", 1)[-1])
            if aid not in self.assets:
                return httpx.Response(404, json={"message": "Not Found"})
            if method == "DELETE":
                del self.assets[aid]
                return httpx.Response(204)
            data = self.assets[aid]
            if "range" in request.headers:
                a, b = request.headers["range"].removeprefix("bytes=").split("-")
                return httpx.Response(206, content=data[int(a) : int(b) + 1])
            return httpx.Response(200, content=data)
        return httpx.Response(404, json={"message": f"unhandled {method} {path}"})


@pytest.fixture
def gh(monkeypatch):
    fake = FakeGitHub()
    monkeypatch.setattr(github, "_client", httpx.AsyncClient(transport=httpx.MockTransport(fake)))
    yield fake
    github._client = None


def _gh_account() -> ProviderAccount:
    return ProviderAccount(
        provider="github",
        id="acc-1",
        credentials={"token": "t" * 20},
        config={"owner": "ada", "repo": "byos-storage"},
    )


async def test_connect_creates_a_private_repo(gh):
    cfg = await github.connect("t" * 20, "byos-storage", private=True)
    assert cfg == {
        "owner": "ada",
        "repo": "byos-storage",
        "private": True,
        "url": "https://github.com/ada/byos-storage",
        "token_expires_at": None,
    }
    assert gh.repos["byos-storage"]["private"] is True


async def test_connect_uses_an_existing_repo_as_it_is(gh):
    gh.repos["mine"] = {
        "name": "mine",
        "private": False,
        "html_url": "u",
        "default_branch": "main",
        "size": 3,
    }
    cfg = await github.connect("t" * 20, "mine", private=True)
    assert cfg["private"] is False  # not silently changed
    assert ("POST", "/user/repos") not in gh.calls


async def test_connect_with_a_bad_token(gh):
    gh.token_ok = False
    with pytest.raises(ProviderAuthError) as err:
        await github.connect("t" * 20, "byos-storage", private=True)
    assert err.value.provider == "github"


async def test_upload_download_range_delete(gh):
    provider = github.GitHubStorageProvider()
    data = b"hello from byos, stored on github"
    ref = await provider.upload(
        _gh_account(), _stream(data), filename="My Notes.txt", size=len(data), mime="text/plain"
    )
    assert ref.size == len(data) and ref.locator["filename"] == "My Notes.txt"
    assert ref.locator["name"].endswith("-My-Notes.txt")

    got = b"".join([c async for c in provider.download(_gh_account(), ref)])
    assert got == data
    part = b"".join([c async for c in provider.download(_gh_account(), ref, byte_range=(6, 9))])
    assert part == data[6:10]

    # A second upload the same day reuses the release.
    before = sum(1 for m, p in gh.calls if m == "POST" and p.endswith("/releases"))
    await provider.upload(_gh_account(), _stream(b"two"), filename="b", size=3)
    after = sum(1 for m, p in gh.calls if m == "POST" and p.endswith("/releases"))
    assert before == after == 1

    await provider.delete(_gh_account(), ref)
    assert not await provider.exists(_gh_account(), ref)
    await provider.delete(_gh_account(), ref)  # already gone is fine


async def test_download_of_a_deleted_asset_is_missing(gh):
    provider = github.GitHubStorageProvider()
    ref = StoredObjectRef(
        provider="github", locator={"repo": "ada/byos-storage", "asset_id": 999}, size=1
    )
    with pytest.raises(FileNotFoundError):
        _ = [c async for c in provider.download(_gh_account(), ref)]


async def test_connect_remembers_when_the_token_expires(gh):
    gh.expiry = "2026-11-05 12:00:00 UTC"
    cfg = await github.connect("t" * 20, "byos-storage", private=True)
    assert cfg["token_expires_at"] == "2026-11-05T12:00:00+00:00"


async def test_an_expired_token_is_flagged_with_its_storage(gh):
    provider = github.GitHubStorageProvider()
    ref = await provider.upload(_gh_account(), _stream(b"x"), filename="a", size=1)
    gh.token_ok = False  # the token expires
    with pytest.raises(ProviderAuthError) as err:
        _ = [c async for c in provider.download(_gh_account(), ref)]
    assert err.value.revoked and err.value.account_id == "acc-1"
    with pytest.raises(ProviderAuthError) as err:
        await provider.upload(_gh_account(), _stream(b"y"), filename="b", size=1)
    assert err.value.revoked and err.value.account_id == "acc-1"
    with pytest.raises(ProviderAuthError) as err:
        await provider.exists(_gh_account(), ref)
    assert err.value.account_id == "acc-1"


async def test_a_missing_permission_is_not_an_expired_token():
    response = httpx.Response(
        403, json={"message": "Resource not accessible by personal access token"}
    )
    with pytest.raises(ProviderAuthError) as err:
        github._check(response, what="delete the file")
    assert not err.value.revoked


# ── S3 ────────────────────────────────────────────────────────────────────────
class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def upload_fileobj(self, fh, bucket, key, ExtraArgs=None):  # noqa: N803 - boto3's names
        self.objects[(bucket, key)] = fh.read()

    def get_object(self, Bucket, Key, Range=None):  # noqa: N803
        from botocore.exceptions import ClientError

        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "gone"}}, "GetObject")
        data = self.objects[(Bucket, Key)]
        if Range:
            a, b = Range.removeprefix("bytes=").split("-")
            data = data[int(a) : int(b) + 1]
        return {"Body": io.BytesIO(data)}

    def delete_object(self, Bucket, Key):  # noqa: N803
        self.objects.pop((Bucket, Key), None)

    def head_object(self, Bucket, Key):  # noqa: N803
        from botocore.exceptions import ClientError

        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return {"ContentLength": len(self.objects[(Bucket, Key)]), "ContentType": "text/plain"}


def _s3_account() -> ProviderAccount:
    return ProviderAccount(
        provider="s3",
        id="acc-2",
        credentials={"access_key_id": "AK", "secret_access_key": "SK"},
        config={"bucket": "files", "prefix": "byos/"},
    )


async def test_s3_upload_download_range_delete():
    provider = s3.S3StorageProvider()
    fake = FakeS3()
    provider._for = lambda account: fake  # type: ignore[method-assign]
    data = b"bytes in a bucket"
    ref = await provider.upload(_s3_account(), _stream(data), filename="a b.pdf", size=len(data))
    assert ref.locator["bucket"] == "files" and ref.locator["key"].startswith("byos/")
    assert ref.locator["key"].endswith("/a-b.pdf")
    assert b"".join([c async for c in provider.download(_s3_account(), ref)]) == data
    assert (
        b"".join([c async for c in provider.download(_s3_account(), ref, byte_range=(0, 4))])
        == b"bytes"
    )
    await provider.delete(_s3_account(), ref)
    assert not await provider.exists(_s3_account(), ref)
    with pytest.raises(FileNotFoundError):
        _ = [c async for c in provider.download(_s3_account(), ref)]


def test_s3_errors_in_plain_terms():
    from botocore.exceptions import ClientError

    def err(code: str) -> ClientError:
        return ClientError({"Error": {"Code": code, "Message": code}}, "Op")

    auth = s3._translate(err("InvalidAccessKeyId"), what="upload the file")
    assert isinstance(auth, ProviderAuthError) and auth.provider == "s3" and auth.revoked
    denied = s3._translate(err("AccessDenied"), what="upload the file")
    assert isinstance(denied, ProviderAuthError) and not denied.revoked
    missing = s3._translate(err("NoSuchBucket"), what="open the bucket")
    assert isinstance(missing, ProviderError) and "doesn't exist" in str(missing)
