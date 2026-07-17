"use client";

import { type AiPrompt, ApiError } from "@byos/api-client";
import { useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

const field =
  "w-full rounded-md border border-zinc-200 bg-black/[0.03] px-3 py-2 text-sm text-zinc-900 " +
  "outline-none placeholder:text-zinc-500 focus:border-indigo-500 " +
  "dark:border-white/10 dark:bg-white/5 dark:text-zinc-100";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

export function PromptEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: AiPrompt | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const authed = useAuthed();
  const [name, setName] = useState(existing?.name ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!name.trim() || !content.trim()) return setError("Name and content are required.");
    setBusy(true);
    try {
      await authed((t) =>
        existing
          ? api.updateAiPrompt(t, existing.id, name.trim(), content.trim())
          : api.createAiPrompt(t, name.trim(), content.trim()),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't save prompt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {existing ? "Edit prompt" : "Add a system prompt"}
        </h3>
        <div className="mt-4 space-y-3">
          <div>
            <span className={label}>Name</span>
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Legal analyst"
            />
          </div>
          <div>
            <span className={label}>System prompt</span>
            <textarea
              className={field}
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Set the assistant's behavior, tone, and rules…"
            />
          </div>
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-black/5 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
