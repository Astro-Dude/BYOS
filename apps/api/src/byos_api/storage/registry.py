"""In-memory registry mapping provider name → provider instance."""

from __future__ import annotations

from byos_api.storage.base import StorageProvider

_registry: dict[str, StorageProvider] = {}


def register_provider(provider: StorageProvider) -> None:
    _registry[provider.name] = provider


def get_provider(name: str) -> StorageProvider:
    try:
        return _registry[name]
    except KeyError:
        raise KeyError(f"Unknown storage provider: {name!r}") from None


def available_providers() -> list[str]:
    return sorted(_registry)
