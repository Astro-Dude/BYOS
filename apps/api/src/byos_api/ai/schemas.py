from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from byos_api.ai.modes import Mode

# ── Keys ─────────────────────────────────────────────────────────────────────
Effort = Literal["none", "minimal", "low", "medium", "high", "xhigh"]


class ModelCheckOut(BaseModel):
    #: Sampling parameters this model refuses ("temperature", "top_p").
    unsupported: list[str]
    #: Reasoning effort levels the model takes, lowest first; empty if none.
    efforts: list[str] = []


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
    reasoning_effort: Effort | None = None
    #: What the model takes, when saving just tested it (a new key, or a new
    #: model), so the client needn't test it again.
    check: ModelCheckOut | None = None


class AiKeyRevealed(BaseModel):
    """The decrypted API key, returned only by the explicit reveal endpoint.

    Deliberately not part of AiKeyOut: keys stay out of list/get responses (and
    anything that logs or caches them), and revealing one is a single auditable
    action rather than a side effect of loading the vault.
    """

    api_key: str


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
    # None: the lowest the model takes (most of what BYOS asks is simple).
    reasoning_effort: Effort | None = None


class ModelListIn(BaseModel):
    """Which endpoint to ask for its models. The key comes from the form while
    adding one (`api_key`), or from the vault when editing (`key_id`)."""

    base_url: str = Field(min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    key_id: uuid.UUID | None = None


class ModelListOut(BaseModel):
    models: list[str]


class ModelCheckIn(ModelListIn):
    model: str = Field(min_length=1, max_length=200)


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
    # Narrow the selection to files not already embedded for this key's model.
    # Drive-wide, so "index remaining" can't be scoped to one folder by accident.
    remaining: bool = False
    # Re-embed even files already current. Without this, indexing is a cheap
    # no-op for anything already done — which is what you want by default, and
    # exactly wrong when you mean "rebuild it".
    force: bool = False


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
    # Not retrieval: the agent shows its working (steps, calculations) too.
    reasoning: bool = False


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


# ── Agent: plan → confirm → apply ────────────────────────────────────────────
class ActionResultOut(BaseModel):
    ok: bool
    detail: str


class OrganizeOptions(BaseModel):
    """Settings for /organize. The defaults are the cautious ones: names are
    left alone, existing folders kept, no tags."""

    rename: bool = False
    group_by: Literal["auto", "topic", "type", "year"] = "topic"
    # The most levels of folders. None leaves it to the agent, up to 3.
    depth: int | None = Field(default=None, ge=1, le=3)
    keep_existing: bool = True
    read_contents: bool = True
    tags: bool = False


class AgentChatRequest(BaseModel):
    conversation_id: uuid.UUID
    key_id: uuid.UUID
    prompt_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=16000)
    # How much the model may do unattended. Defaults to the safest option, so an
    # older client that doesn't send it still gets confirm-everything.
    mode: Mode = Mode.ASK
    # Retrieval add-ons, applied when the model searches file contents.
    strategies: RagStrategies = Field(default_factory=RagStrategies)
    # Set by /organize: tidy the whole drive with these settings.
    organize: OrganizeOptions | None = None
    # "Want it different?": the pending plan this turn replaces. It's discarded,
    # `message` is the user's note, and the reply rewrites that plan's message
    # in place rather than adding a new exchange.
    revises: uuid.UUID | None = None
    # "Fix with Bao": an applied plan whose failed changes this turn redoes.
    fixes: uuid.UUID | None = None


class ActionOut(BaseModel):
    """One change in a plan, as shown in the confirmation list. `auto` marks the
    ones that ran during the turn rather than waiting for a click; `result` is
    None while an action is still pending."""

    op: str
    label: str
    danger: bool = False
    auto: bool = False
    result: ActionResultOut | None = None


class PlanOut(BaseModel):
    id: uuid.UUID
    status: str  # pending | applied | discarded
    actions: list[ActionOut]
    created_at: datetime


class ApplyResultOut(BaseModel):
    plan_id: uuid.UUID
    status: str
    applied: int
    failed: int
    actions: list[ActionOut]
