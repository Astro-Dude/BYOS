from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ── Keys ─────────────────────────────────────────────────────────────────────
class AiKeyOut(BaseModel):
    """A saved key as returned to the client — never includes the API key."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    base_url: str
    model: str
    embedding_model: str | None = None
    temperature: float
    max_tokens: int
    top_p: float | None = None


class AiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_url: str = Field(min_length=1, max_length=500)
    model: str = Field(min_length=1, max_length=200)
    # Required on create; omit on update to keep the stored key.
    api_key: str | None = Field(default=None, max_length=500)
    embedding_model: str | None = Field(default=None, max_length=200)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=32000)
    top_p: float | None = Field(default=None, ge=0, le=1)


# ── Prompts ──────────────────────────────────────────────────────────────────
class AiPromptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    content: str


class AiPromptIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8000)


# ── Chat (single document) ───────────────────────────────────────────────────
class SummarizeRequest(BaseModel):
    file_id: uuid.UUID
    key_id: uuid.UUID
    prompt_id: uuid.UUID | None = None


class ChatTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str = Field(max_length=16000)


class ChatSendRequest(BaseModel):
    file_id: uuid.UUID
    key_id: uuid.UUID
    prompt_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=16000)
    # Long-document mode: chunk + retrieve relevant parts instead of the whole file.
    retrieval: bool = False
    # Single-doc chats aren't stored server-side — the client keeps them in
    # localStorage and replays prior turns here for multi-turn context.
    history: list[ChatTurn] = Field(default_factory=list)


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    created_at: datetime


# ── Drive-wide indexing + RAG chat ───────────────────────────────────────────
class IndexRequest(BaseModel):
    key_id: uuid.UUID
    all: bool = False
    file_ids: list[uuid.UUID] = Field(default_factory=list)
    folder_ids: list[uuid.UUID] = Field(default_factory=list)


class UnindexRequest(BaseModel):
    all: bool = False
    file_ids: list[uuid.UUID] = Field(default_factory=list)


class IndexStatusOut(BaseModel):
    """Which of the user's extractable files are already embedded for a given
    key's embedding model (at their current version)."""

    indexed_file_ids: list[str]
    total: int


class RagStrategies(BaseModel):
    rewrite: bool = False
    hyde: bool = False
    rerank: bool = False
    crag: bool = False


class DriveChatRequest(BaseModel):
    conversation_id: uuid.UUID
    key_id: uuid.UUID
    prompt_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=16000)
    strategies: RagStrategies = Field(default_factory=RagStrategies)


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    updated_at: datetime


class ConversationCreate(BaseModel):
    title: str = Field(default="New chat", max_length=200)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=200)
