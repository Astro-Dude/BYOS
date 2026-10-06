"""S3-compatible storage: AWS S3, Cloudflare R2, Backblaze B2, MinIO, and the
rest. Objects go under `<prefix><random id>/<filename>` in the user's bucket.

boto3 is synchronous, so every call runs in a worker thread; uploads go through
`upload_fileobj`, which switches to multipart for big files on its own.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

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

NAME = "s3"
_CHUNK = 256 * 1024

_AUTH_CODES = {
    "InvalidAccessKeyId",
    "SignatureDoesNotMatch",
    "AccessDenied",
    "InvalidToken",
    "ExpiredToken",
    "AuthorizationHeaderMalformed",
    "403",
}
# Of those, the ones that mean the keys themselves no longer work (deleted,
# rotated, expired), rather than valid keys short of a permission.
_DEAD_KEY_CODES = {"InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidToken", "ExpiredToken"}


def _client(config: dict[str, Any], credentials: dict[str, Any]):  # type: ignore[no-untyped-def]
    import boto3
    from botocore.config import Config

    endpoint = (config.get("endpoint") or "").strip() or None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=(config.get("region") or "").strip() or ("auto" if endpoint else "us-east-1"),
        aws_access_key_id=credentials.get("access_key_id"),
        aws_secret_access_key=credentials.get("secret_access_key"),
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
            # Custom endpoints (R2, MinIO, B2) are happiest with path-style URLs.
            s3={"addressing_style": "path" if endpoint else "auto"},
            connect_timeout=10,
            read_timeout=120,
        ),
    )


def _translate(exc: Exception, *, what: str) -> Exception:
    """botocore's errors, in our terms and plain words."""
    from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError

    if isinstance(exc, NoCredentialsError):
        return ProviderAuthError(
            "No S3 keys are saved for this storage.", provider=NAME, revoked=True
        )
    if isinstance(exc, EndpointConnectionError):
        return ProviderError("Couldn't reach the S3 endpoint. Check its URL.", provider=NAME)
    if isinstance(exc, ClientError):
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in _DEAD_KEY_CODES:
            return ProviderAuthError(
                "The S3 keys no longer work. They may have been deleted, rotated or expired.",
                provider=NAME,
                revoked=True,
            )
        if code in _AUTH_CODES:
            return ProviderAuthError("The S3 keys can't access this bucket.", provider=NAME)
        if code in {"NoSuchBucket", "404"} and what == "open the bucket":
            return ProviderError("That bucket doesn't exist.", provider=NAME, status=400)
        if code == "EntityTooLarge":
            return ProviderError(
                "The file is larger than the bucket allows.", provider=NAME, status=413
            )
        message = exc.response.get("Error", {}).get("Message") or code
        return ProviderError(f"S3 couldn't {what}: {message}", provider=NAME)
    return ProviderError(f"S3 couldn't {what}.", provider=NAME)


def _safe_name(filename: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip("-.")
    return clean[:150] or "file"


async def connect(config: dict[str, Any], credentials: dict[str, Any]) -> dict[str, Any]:
    """Check the keys can reach the bucket. Returns the config to store."""
    client = _client(config, credentials)
    try:
        await asyncio.to_thread(client.head_bucket, Bucket=config["bucket"])
    except Exception as exc:
        raise _translate(exc, what="open the bucket") from exc
    prefix = (config.get("prefix") or "").strip().strip("/")
    return {
        "endpoint": (config.get("endpoint") or "").strip() or None,
        "region": (config.get("region") or "").strip() or None,
        "bucket": config["bucket"].strip(),
        "prefix": f"{prefix}/" if prefix else "",
    }


class S3StorageProvider:
    name = NAME

    def __init__(self) -> None:
        # One client per storage account: creating one costs a few milliseconds
        # and a credentials lookup, so they're reused.
        self._clients: dict[str, Any] = {}

    def _for(self, account: ProviderAccount):  # type: ignore[no-untyped-def]
        key = f"{account.id}:{account.credentials.get('access_key_id')}"
        client = self._clients.get(key)
        if client is None:
            client = self._clients[key] = _client(account.config, account.credentials)
        return client

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
        bucket = account.config["bucket"]
        key = f"{account.config.get('prefix') or ''}{uuid.uuid4().hex}/{_safe_name(filename)}"
        spooled = await spool(stream)
        try:
            extra = {"ContentType": mime} if mime else {}
            await asyncio.to_thread(
                self._for(account).upload_fileobj, spooled.file, bucket, key, ExtraArgs=extra
            )
        except Exception as exc:
            raise _translate(exc, what="upload the file") from exc
        finally:
            spooled.close()
        return StoredObjectRef(
            provider=NAME,
            locator={"bucket": bucket, "key": key, "filename": filename, "mime": mime},
            size=spooled.size,
            checksum=spooled.sha256,
        )

    @tags_account
    async def download(
        self,
        account: ProviderAccount,
        ref: StoredObjectRef,
        *,
        byte_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]:
        params: dict[str, Any] = {"Bucket": ref.locator["bucket"], "Key": ref.locator["key"]}
        if byte_range is not None:
            params["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
        from botocore.exceptions import ClientError

        try:
            obj = await asyncio.to_thread(self._for(account).get_object, **params)
        except ClientError as exc:
            if str(exc.response.get("Error", {}).get("Code")) in {"NoSuchKey", "404"}:
                raise FileNotFoundError(ref.locator["key"]) from exc  # deleted from the bucket
            raise _translate(exc, what="download the file") from exc
        except Exception as exc:
            raise _translate(exc, what="download the file") from exc
        body = obj["Body"]
        try:
            while chunk := await asyncio.to_thread(body.read, _CHUNK):
                yield chunk
        finally:
            body.close()

    @tags_account
    async def delete(self, account: ProviderAccount, ref: StoredObjectRef) -> None:
        try:
            await asyncio.to_thread(
                self._for(account).delete_object,
                Bucket=ref.locator["bucket"],
                Key=ref.locator["key"],
            )
        except Exception as exc:
            raise _translate(exc, what="delete the file") from exc

    @tags_account
    async def get_metadata(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> ProviderObjectMeta:
        from botocore.exceptions import ClientError

        try:
            head = await asyncio.to_thread(
                self._for(account).head_object, Bucket=ref.locator["bucket"], Key=ref.locator["key"]
            )
        except ClientError as exc:
            if str(exc.response.get("Error", {}).get("Code")) in {"404", "NoSuchKey", "NotFound"}:
                return ProviderObjectMeta(size=0, mime=ref.locator.get("mime"), exists=False)
            raise _translate(exc, what="read the file's details") from exc
        return ProviderObjectMeta(
            size=int(head.get("ContentLength", 0)), mime=head.get("ContentType"), exists=True
        )

    async def exists(self, account: ProviderAccount, ref: StoredObjectRef) -> bool:
        return (await self.get_metadata(account, ref)).exists

    async def shareable_access(
        self, account: ProviderAccount, ref: StoredObjectRef
    ) -> AccessHandle:
        # Proxied like every provider, so links keep their auth and analytics.
        return AccessHandle(kind="proxy")
