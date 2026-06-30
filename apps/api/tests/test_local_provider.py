"""End-to-end smoke test for the StorageProvider pipeline via LocalStorageProvider.
No database or network required."""

from __future__ import annotations

from collections.abc import AsyncIterator

from byos_api.storage import LocalStorageProvider, ProviderAccount


async def _aiter(chunks: list[bytes]) -> AsyncIterator[bytes]:
    for chunk in chunks:
        yield chunk


async def test_local_provider_roundtrip(tmp_path) -> None:
    provider = LocalStorageProvider(base_dir=str(tmp_path / "bucket"))
    account = ProviderAccount(provider="local")
    payload = b"hello byos " * 1000

    ref = await provider.upload(
        account,
        _aiter([payload[:500], payload[500:]]),
        filename="hello.txt",
        size=len(payload),
        mime="text/plain",
    )
    assert ref.provider == "local"
    assert ref.size == len(payload)
    assert ref.checksum is not None

    assert await provider.exists(account, ref) is True

    meta = await provider.get_metadata(account, ref)
    assert meta.exists is True
    assert meta.size == len(payload)

    full = b"".join([chunk async for chunk in provider.download(account, ref)])
    assert full == payload

    head = b"".join([chunk async for chunk in provider.download(account, ref, byte_range=(0, 9))])
    assert head == payload[:10]

    await provider.delete(account, ref)
    assert await provider.exists(account, ref) is False
