"use client";

import { ApiError, type FileItem } from "@byos/api-client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";

export function AliasModal({
  file,
  onClose,
  onCreated,
}: {
  file: FileItem;
  onClose: () => void;
  onCreated: () => void;
}) {
  const authed = useAuthed();
  const { user } = useAuth();
  const username = user?.username ?? "";
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!slug.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const alias = await authed((t) => api.createAlias(t, slug.trim(), file.id));
      setCreatedUrl(api.aliasUrl(username, alias.slug));
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Could not create link");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-zinc-900">Permanent link</h3>
        <p className="mt-1 truncate text-sm text-zinc-500">for {file.name}</p>

        {createdUrl ? (
          <div className="mt-4">
            <p className="text-sm text-zinc-600">
              Share this link. Replace the file anytime — the URL never changes.
            </p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={createdUrl} onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={onClose} className="bg-zinc-900 hover:bg-zinc-700">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <label className="text-sm font-medium text-zinc-700">Alias</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-zinc-400">/{username}/</span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="resume"
                autoFocus
              />
            </div>
            <p className="mt-1 text-xs text-zinc-400">lowercase letters, digits, and hyphens</p>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                onClick={onClose}
                className="border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !slug.trim()}>
                {busy ? "Creating…" : "Create link"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
