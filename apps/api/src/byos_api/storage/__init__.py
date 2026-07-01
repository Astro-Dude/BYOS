"""Storage abstraction package."""

from __future__ import annotations

from byos_api.core.config import get_settings
from byos_api.storage.base import (
    AccessHandle,
    ProviderAccount,
    ProviderObjectMeta,
    StorageProvider,
    StoredObjectRef,
)
from byos_api.storage.local import LocalStorageProvider
from byos_api.storage.registry import (
    available_providers,
    get_provider,
    providers,
    register_provider,
)

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
    "shutdown_providers",
]


async def shutdown_providers() -> None:
    """Give each provider a chance to release resources on API shutdown."""
    for provider in providers():
        shutdown = getattr(provider, "shutdown", None)
        if shutdown is not None:
            try:
                await shutdown()
            except Exception:  # noqa: BLE001 - shutdown must not raise
                pass


def register_default_providers() -> None:
    """Register the providers available in this deployment. Called on API startup."""
    settings = get_settings()
    # Local disk storage is opt-in (tests only); by default nothing is stored
    # locally — files go to the user's own Telegram storage.
    if settings.enable_local_storage:
        register_provider(LocalStorageProvider())

    if settings.telegram_api_id and settings.telegram_api_hash:
        # Imported lazily so Telethon is only loaded when Telegram is configured.
        from byos_api.storage.telegram import TelegramClientPool, TelegramStorageProvider

        pool = TelegramClientPool(settings.telegram_api_id, settings.telegram_api_hash)
        register_provider(TelegramStorageProvider(pool))
