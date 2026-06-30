"""Storage abstraction package."""

from __future__ import annotations

from byos_api.storage.base import (
    AccessHandle,
    ProviderAccount,
    ProviderObjectMeta,
    StorageProvider,
    StoredObjectRef,
)
from byos_api.storage.local import LocalStorageProvider
from byos_api.storage.registry import available_providers, get_provider, register_provider

__all__ = [
    "AccessHandle",
    "LocalStorageProvider",
    "ProviderAccount",
    "ProviderObjectMeta",
    "StorageProvider",
    "StoredObjectRef",
    "available_providers",
    "get_provider",
    "register_default_providers",
    "register_provider",
]


def register_default_providers() -> None:
    """Register the providers available in this deployment. Called on API startup.
    Telegram is added here in Phase 2."""
    register_provider(LocalStorageProvider())
