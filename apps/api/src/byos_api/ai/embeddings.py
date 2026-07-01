"""Semantic-search architecture (external-model dependent — flagged).

Semantic search needs (1) an embedding model and (2) a vector index. Neither
ships by default: the model is an external service decision and pgvector must be
enabled on Postgres. This module defines the seam so the rest of the app is
ready for it.

To enable in production:
  1. `CREATE EXTENSION vector;` and add an `embedding vector(N)` column to files
     (a dedicated Alembic migration, gated on the extension being present).
  2. Implement ``EmbeddingProvider`` against your model (Anthropic, OpenAI, a
     local sentence-transformer, …) and install it via ``set_embedding_provider``.
  3. On upload, embed name + extracted text; at query time, embed the query and
     ORDER BY the vector distance.

Until a provider is installed, ``embed`` returns None and semantic search is a
no-op — lexical/FTS search (already shipped) remains the default.
"""

from __future__ import annotations

from typing import Protocol


class EmbeddingProvider(Protocol):
    dimensions: int

    async def embed(self, text: str) -> list[float]: ...


class NullEmbeddingProvider:
    dimensions = 0

    async def embed(self, text: str) -> list[float] | None:
        return None


_provider: EmbeddingProvider | NullEmbeddingProvider = NullEmbeddingProvider()


def set_embedding_provider(provider: EmbeddingProvider) -> None:
    global _provider
    _provider = provider


def is_enabled() -> bool:
    return not isinstance(_provider, NullEmbeddingProvider)


async def embed(text: str) -> list[float] | None:
    return await _provider.embed(text)
