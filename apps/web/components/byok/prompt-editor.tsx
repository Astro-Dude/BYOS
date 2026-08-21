"use client";

import { type AiPrompt, ApiError } from "@byos/api-client";
import { useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

const field =
  "w-full rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-[0.9375rem] text-zinc-900 " +
  "outline-none placeholder:text-zinc-500 focus:border-zinc-900 " +
  "";
const label = "mb-1 block text-[0.8125rem] font-medium text-zinc-500";

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
      className="modal-scrim z-[120]"
      onClick={onClose}
    >
      <div
        className="modal-surface max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="type-heading-sm">
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
          {error ? <p className="text-[0.9375rem] text-red-500">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="pill-sm-ghost"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="pill-sm-filled disabled:bg-transparent disabled:text-zinc-400 disabled:ring-1 disabled:ring-inset disabled:ring-zinc-200"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
