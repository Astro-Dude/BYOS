"use client";

import { ApiError, type FileItem } from "@byos/api-client";
import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

export function TagsModal({
  file,
  onClose,
  onChanged,
}: {
  file: FileItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const [tags, setTags] = useState<string[]>(file.tags);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<FileItem>) => {
    setError(null);
    setBusy(true);
    (async () => {
      try {
        const updated = await fn();
        setTags(updated.tags);
        onChanged();
        toast("Tags updated");
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : "Action failed");
      } finally {
        setBusy(false);
      }
    })();
  };

  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    setName("");
    act(() => authed((t) => api.addTag(t, file.id, clean)));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Tags</h3>
        <p className="mt-1 truncate text-sm text-zinc-500">for {file.name}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <span className="text-sm text-zinc-400">No tags yet.</span>
          ) : (
            tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
              >
                {tag}
                <button
                  disabled={busy}
                  onClick={() => act(() => authed((t) => api.removeTag(t, file.id, tag)))}
                  className="text-indigo-400 hover:text-indigo-700"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add a tag…"
          />
          <Button onClick={add} disabled={busy || !name.trim()}>
            Add
          </Button>
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        <div className="mt-4 flex justify-end">
          <Button onClick={onClose} className="bg-zinc-900 hover:bg-zinc-700">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
