"use client";

import { type AiKey, type AiPrompt } from "@byos/api-client";
import { Copy, Database, FileDown, FileText, KeyRound, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

import { IndexPanel } from "@/components/byok/index-panel";
import { KeyEditor } from "@/components/byok/key-editor";
import { PromptEditor } from "@/components/byok/prompt-editor";
import { MD_PLUGINS } from "@/components/dashboard/chat-format";
import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

/* The BYOK vault's three sections. Shared by the BYOK settings modal and the
   app's Settings page, so both show the same thing and can't drift. */

/** Who serves a key, from its base URL: the five presets by name, a local
 *  server as "Self-hosted", anything else by its host. */
export function providerOf(baseUrl: string): string {
  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "Custom";
  }
  if (host.endsWith("openai.com")) return "OpenAI";
  if (host.includes("openrouter")) return "OpenRouter";
  if (host.includes("generativelanguage") || host.includes("googleapis")) return "Gemini";
  if (host.includes("groq")) return "Groq";
  if (host.includes("together")) return "Together";
  if (host === "localhost" || host.startsWith("127.") || host.startsWith("192.168.") || host.endsWith(".local"))
    return "Self-hosted";
  return host.replace(/^api\./, "");
}

/** Saved model keys: add, edit, delete. One card per key: who serves it, the
 *  chat model, and whether it can index (an embedding model) at a glance. */
export function KeysSection({
  keys,
  loading = false,
  onChanged,
  startWithNewKey = false,
}: {
  keys: AiKey[];
  /** Still fetching: show placeholders, not the empty state. */
  loading?: boolean;
  onChanged: () => void;
  /** Open the "Add key" editor straight away. */
  startWithNewKey?: boolean;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const [editor, setEditor] = useState<AiKey | "new" | null>(startWithNewKey ? "new" : null);
  const [deleting, setDeleting] = useState<AiKey | null>(null);

  const remove = async (k: AiKey) => {
    setDeleting(null);
    try {
      await authed((t) => api.deleteAiKey(t, k.id));
      toast("Key deleted");
      onChanged();
    } catch {
      toast("Couldn't delete the key", "error");
    }
  };

  return (
    <div>
      {loading && keys.length === 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />
          <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
            <KeyRound className="h-5 w-5" />
          </span>
          <p className="mt-4 text-[0.9375rem] font-medium text-zinc-900">No model keys yet</p>
          <p className="mt-1 max-w-sm text-[0.8125rem] leading-[1.5] text-zinc-500">
            Add a key from OpenAI, OpenRouter, Gemini, Groq, Together, or a model you host. Bao uses it to
            chat with your drive.
          </p>
          <button onClick={() => setEditor("new")} className="pill-sm-filled mt-5 inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Add your first key
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[0.8125rem] text-zinc-500">
              {keys.length} key{keys.length === 1 ? "" : "s"} saved
            </p>
            <button onClick={() => setEditor("new")} className="pill-sm-filled inline-flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Add key
            </button>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {keys.map((k) => {
              const provider = providerOf(k.base_url);
              return (
                <div
                  key={k.id}
                  className="group flex min-w-0 flex-col rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 font-display text-[1rem] text-[rgb(var(--c-paper))]">
                      {provider.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-medium text-zinc-900">{k.name}</p>
                      <p className="truncate text-[0.8125rem] text-zinc-500">{provider}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button onClick={() => setEditor(k)} className="btn-icon-sm" aria-label="Edit key" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleting(k)}
                        className="btn-icon-sm hover:!bg-[rgb(var(--c-danger-50))] hover:!text-[rgb(var(--c-danger-600))]"
                        aria-label="Delete key"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <dl className="mt-4 grid min-w-0 gap-1.5 text-[0.8125rem]">
                    <div className="flex min-w-0 items-center gap-2">
                      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-zinc-500">
                        <MessageSquare className="h-3.5 w-3.5" /> Chat
                      </dt>
                      <dd className="min-w-0 truncate font-mono text-[0.75rem] text-zinc-900">{k.model}</dd>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-zinc-500">
                        <Database className="h-3.5 w-3.5" /> Indexing
                      </dt>
                      <dd className="min-w-0 truncate">
                        {k.embedding_model ? (
                          <span className="font-mono text-[0.75rem] text-zinc-900">{k.embedding_model}</span>
                        ) : (
                          <button onClick={() => setEditor(k)} className="text-zinc-400 hover:text-zinc-900 hover:underline">
                            Not set: add an embedding model
                          </button>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-200 pt-3 text-[0.6875rem] text-zinc-600">
                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">Temp {k.temperature}</span>
                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">
                      {k.max_tokens.toLocaleString()} tokens
                    </span>
                    {k.reasoning_effort ? (
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5">Effort {k.reasoning_effort}</span>
                    ) : null}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
      {editor !== null ? (
        <KeyEditor
          existing={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={onChanged}
        />
      ) : null}
      {deleting ? (
        <ConfirmModal
          title="Delete this key?"
          message={`“${deleting.name}” will be removed. Chats that used it keep their history.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </div>
  );
}

function promptSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

/** "name copy", "name copy 2"... whichever is free. */
function copyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  let candidate = `${name} copy`;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${name} copy ${i}`;
  return candidate;
}

function downloadPrompt(p: AiPrompt) {
  const url = URL.createObjectURL(new Blob([p.content], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${promptSlug(p.name)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** A prompt as a document: its rendered first lines as a thumbnail, its name
 *  as a file, and quiet actions on hover. Click to open the editor. */
function PromptCard({
  prompt,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  prompt: AiPrompt;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const words = prompt.content.trim() ? prompt.content.trim().split(/\s+/).length : 0;
  const action =
    "flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900";
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[var(--shadow-popover)]">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left" aria-label={`Open ${prompt.name}`}>
        {/* The page: rendered Markdown, fading out like a file thumbnail. */}
        <div className="relative h-44 overflow-hidden bg-zinc-50 px-5 pt-4">
          <div className="prompt-thumb">
            <ReactMarkdown remarkPlugins={MD_PLUGINS}>{prompt.content.slice(0, 1200)}</ReactMarkdown>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-50 to-transparent" />
        </div>
        <div className="flex items-center gap-2.5 border-t border-zinc-200 px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <p className="truncate font-mono text-[0.8125rem] text-zinc-900">{promptSlug(prompt.name)}.md</p>
            <p className="text-[0.75rem] text-zinc-500">
              {words.toLocaleString()} {words === 1 ? "word" : "words"}
            </p>
          </div>
        </div>
      </button>
      {/* Actions float over the page on hover (always shown on touch). */}
      <div className="absolute right-2.5 top-2.5 flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white/95 p-0.5 opacity-100 shadow-sm backdrop-blur transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <button type="button" onClick={onOpen} className={action} title="Edit" aria-label="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onDuplicate} className={action} title="Duplicate" aria-label="Duplicate">
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => downloadPrompt(prompt)} className={action} title="Download .md" aria-label="Download as .md">
          <FileDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${action} hover:!bg-[rgb(var(--c-danger-50))] hover:!text-[rgb(var(--c-danger-600))]`}
          title="Delete"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Saved system prompts, as a grid of documents. */
export function PromptsSection({
  prompts,
  onChanged,
  startWithNew = false,
}: {
  prompts: AiPrompt[];
  onChanged: () => void;
  /** Open the editor on a new prompt straight away. */
  startWithNew?: boolean;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const [editor, setEditor] = useState<AiPrompt | "new" | null>(startWithNew ? "new" : null);
  const [deleting, setDeleting] = useState<AiPrompt | null>(null);

  const remove = async (p: AiPrompt) => {
    setDeleting(null);
    try {
      await authed((t) => api.deleteAiPrompt(t, p.id));
      toast("Prompt deleted");
      onChanged();
    } catch {
      toast("Couldn't delete the prompt", "error");
    }
  };

  const duplicate = async (p: AiPrompt) => {
    try {
      await authed((t) => api.createAiPrompt(t, copyName(p.name, prompts.map((x) => x.name)), p.content));
      toast("Prompt duplicated");
      onChanged();
    } catch {
      toast("Couldn't duplicate the prompt", "error");
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <button
          type="button"
          onClick={() => setEditor("new")}
          className="group flex min-h-[15rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white text-center transition-colors hover:border-zinc-900 hover:bg-zinc-50"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-white transition-transform group-hover:scale-105">
            <Plus className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[0.9375rem] text-zinc-900">New prompt</span>
            <span className="block text-[0.8125rem] text-zinc-500">Start blank, or from a section</span>
          </span>
        </button>
        {prompts.map((p) => (
          <PromptCard
            key={p.id}
            prompt={p}
            onOpen={() => setEditor(p)}
            onDuplicate={() => void duplicate(p)}
            onDelete={() => setDeleting(p)}
          />
        ))}
      </div>
      {prompts.length === 0 ? (
        <p className="mt-6 max-w-lg text-[0.875rem] leading-[1.5] text-zinc-500">
          A system prompt tells the model who to be and how to answer, like &quot;You are a careful
          legal analyst. Keep answers short.&quot; Pick one when you start a chat.
        </p>
      ) : null}

      {editor !== null ? (
        <PromptEditor
          existing={editor === "new" ? null : editor}
          takenNames={prompts.filter((p) => editor === "new" || p.id !== editor.id).map((p) => p.name)}
          onClose={() => setEditor(null)}
          onSaved={onChanged}
        />
      ) : null}
      {deleting ? (
        <ConfirmModal
          title="Delete this prompt?"
          message={`“${promptSlug(deleting.name)}.md” will be permanently deleted.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </div>
  );
}

/** Index the drive with one of the saved keys. */
export function IndexingSection({
  keys,
  loading = false,
  initialKeyId,
}: {
  keys: AiKey[];
  /** Still fetching: show a placeholder, not "add a key first". */
  loading?: boolean;
  /** Preselect this key (the chat's current model). */
  initialKeyId?: string;
}) {
  const [keyId, setKeyId] = useState(
    (initialKeyId && keys.some((k) => k.id === initialKeyId) ? initialKeyId : null) ??
      keys.find((k) => k.embedding_model)?.id ??
      keys[0]?.id ??
      "",
  );
  // Keys can load after this mounts (Settings fetches them itself).
  const current =
    keys.find((k) => k.id === keyId) ??
    keys.find((k) => k.id === initialKeyId) ??
    keys.find((k) => k.embedding_model) ??
    keys[0];

  if (keys.length === 0) {
    if (loading) return <div className="h-48 animate-pulse rounded-2xl bg-zinc-100" />;
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
          <Database className="h-5 w-5" />
        </span>
        <p className="mt-4 text-[0.9375rem] font-medium text-zinc-900">Add a model key first</p>
        <p className="mt-1 max-w-sm text-[0.8125rem] leading-[1.5] text-zinc-500">
          Indexing needs a key with an embedding model, like text-embedding-3-small.
        </p>
        <Link href="/settings/models?new=1" className="pill-sm-filled mt-5 inline-flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Add a key
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {keys.length > 1 ? (
        <section>
          <h2 className="type-label mb-2">Index with</h2>
          {/* Each key as a card; the chosen one is filled. Keys without an
              embedding model can't index, so they say so. */}
          <div role="radiogroup" aria-label="Index with key" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {keys.map((k) => {
              const on = k.id === current?.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKeyId(k.id)}
                  className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                    on
                      ? "sel-fill"
                      : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      on ? "border-current" : "border-zinc-300"
                    }`}
                  >
                    {on ? <span className="h-2 w-2 rounded-full bg-current" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] font-medium">{k.name}</span>
                    <span className={`block truncate text-[0.75rem] ${on ? "opacity-70" : "text-zinc-500"}`}>
                      {k.embedding_model ?? "No embedding model"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      <IndexPanel keyId={current?.id ?? ""} keyHasEmbedding={!!current?.embedding_model} />
    </div>
  );
}
