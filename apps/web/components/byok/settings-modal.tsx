"use client";

import { type AiKey, type AiPrompt } from "@byos/api-client";
import {
  Database,
  KeyRound,
  MessageSquareText,
  Pencil,
  Plus,
  type LucideIcon,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import { IndexPanel } from "@/components/byok/index-panel";
import { KeyEditor } from "@/components/byok/key-editor";
import { PromptEditor } from "@/components/byok/prompt-editor";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

type Tab = "keys" | "prompts" | "index";

const SECTIONS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "keys", label: "Keys", icon: KeyRound },
  { id: "prompts", label: "System prompts", icon: MessageSquareText },
  { id: "index", label: "Indexing", icon: Database },
];

/** BYOK settings: manage saved keys, system prompts, and index the drive. */
export function SettingsModal({
  keys,
  prompts,
  onClose,
  onChanged,
}: {
  keys: AiKey[];
  prompts: AiPrompt[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const authed = useAuthed();
  const [tab, setTab] = useState<Tab>("keys");
  const [keyEditor, setKeyEditor] = useState<AiKey | "new" | null>(null);
  const [promptEditor, setPromptEditor] = useState<AiPrompt | "new" | null>(null);
  const [indexKeyId, setIndexKeyId] = useState(
    keys.find((k) => k.embedding_model)?.id ?? keys[0]?.id ?? "",
  );

  const removeKey = async (id: string) => {
    await authed((t) => api.deleteAiKey(t, id));
    onChanged();
  };
  const removePrompt = async (id: string) => {
    await authed((t) => api.deleteAiPrompt(t, id));
    onChanged();
  };

  const indexKey = keys.find((k) => k.id === indexKeyId) ?? null;
  const activeLabel = SECTIONS.find((s) => s.id === tab)?.label ?? "";

  return (
    <div
      className="modal-scrim z-[110]"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:h-[80vh] sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left rail */}
        <aside className="flex shrink-0 flex-row items-center gap-2 border-b border-zinc-200 bg-zinc-100 p-3 sm:w-56 sm:flex-col sm:items-stretch sm:border-b-0 sm:border-r">
          <button
            onClick={onClose}
            className="btn-icon-sm order-last shrink-0 sm:order-first sm:mb-3 sm:self-start"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <nav className="thin-scroll -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 sm:mx-0 sm:flex-col sm:space-y-0.5 sm:overflow-visible sm:px-0">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setTab(s.id)}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[0.9375rem] transition-colors sm:w-full sm:rounded-lg sm:px-3 sm:py-2 ${
                  tab === s.id
                    ? "bg-white text-zinc-900 sm:bg-white"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Right pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-zinc-200 px-4 py-3 sm:px-6 sm:py-4">
            <h2 className="type-heading-sm">{activeLabel}</h2>
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "keys" ? (
            <div className="space-y-2">
              <button
                onClick={() => setKeyEditor("new")}
                className="mb-1 flex items-center gap-1.5 pill-sm-filled"
              >
                <Plus className="h-4 w-4" /> Add key
              </button>
              {keys.length === 0 ? (
                <p className="text-[0.9375rem] text-zinc-500">No keys yet — add your first model key.</p>
              ) : (
                keys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2"
                  >
                    <KeyRound className="h-4 w-4 shrink-0 text-zinc-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] text-zinc-900">{k.name}</p>
                      <p className="truncate text-[0.8125rem] text-zinc-500">
                        {k.model}
                        {k.embedding_model ? ` · ${k.embedding_model}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => setKeyEditor(k)}
                      className="text-zinc-500 hover:text-zinc-800"
                      aria-label="Edit key"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void removeKey(k.id)}
                      className="text-zinc-500 hover:text-red-500"
                      aria-label="Delete key"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === "prompts" ? (
            <div className="space-y-2">
              <button
                onClick={() => setPromptEditor("new")}
                className="mb-1 flex items-center gap-1.5 pill-sm-filled"
              >
                <Plus className="h-4 w-4" /> Add prompt
              </button>
              {prompts.length === 0 ? (
                <p className="text-[0.9375rem] text-zinc-500">No saved prompts.</p>
              ) : (
                prompts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2"
                  >
                    <MessageSquareText className="h-4 w-4 shrink-0 text-zinc-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] text-zinc-900">{p.name}</p>
                      <p className="truncate text-[0.8125rem] text-zinc-500">{p.content}</p>
                    </div>
                    <button
                      onClick={() => setPromptEditor(p)}
                      className="text-zinc-500 hover:text-zinc-800"
                      aria-label="Edit prompt"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void removePrompt(p.id)}
                      className="text-zinc-500 hover:text-red-500"
                      aria-label="Delete prompt"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === "index" ? (
            <div className="space-y-3">
              {keys.length > 1 ? (
                <label className="block text-[0.8125rem] text-zinc-500">
                  Index with key
                  <select
                    value={indexKeyId}
                    onChange={(e) => setIndexKeyId(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-zinc-200 bg-zinc-100 px-2 py-1.5 text-[0.9375rem] text-zinc-900 outline-none focus:border-zinc-900"
                  >
                    {keys.map((k) => (
                      <option key={k.id} value={k.id} className="bg-white">
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <IndexPanel keyId={indexKeyId} keyHasEmbedding={!!indexKey?.embedding_model} />
            </div>
          ) : null}
          </div>
        </div>
      </div>

      {keyEditor !== null ? (
        <KeyEditor
          existing={keyEditor === "new" ? null : keyEditor}
          onClose={() => setKeyEditor(null)}
          onSaved={onChanged}
        />
      ) : null}
      {promptEditor !== null ? (
        <PromptEditor
          existing={promptEditor === "new" ? null : promptEditor}
          onClose={() => setPromptEditor(null)}
          onSaved={onChanged}
        />
      ) : null}
    </div>
  );
}
