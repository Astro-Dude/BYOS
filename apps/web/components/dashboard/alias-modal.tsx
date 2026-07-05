"use client";

import { ApiError, type AliasItem, type FileItem } from "@byos/api-client";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

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
  const toast = useToast();
  const { user } = useAuth();
  const username = user?.username ?? "";
  const [existing, setExisting] = useState<AliasItem | null>(null);
  const [slug, setSlug] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authed((t) => api.listAliases(t))
      .then((aliases) => {
        const found = aliases.find((a) => a.file_id === file.id);
        if (found) setExisting(found);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [authed, file.id]);

  const linkUrl = existing ? api.aliasUrl(username, existing.slug) : null;

  const submit = async () => {
    const clean = slug.trim();
    if (!clean) return;
    setError(null);
    setBusy(true);
    try {
      if (editing && existing) {
        const updated = await authed((t) => api.updateAlias(t, existing.id, { slug: clean }));
        setExisting(updated);
        setEditing(false);
        toast("Link updated");
      } else {
        const created = await authed((t) => api.createAlias(t, clean, file.id));
        setExisting(created);
        toast("Link created");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!linkUrl) return;
    await navigator.clipboard.writeText(linkUrl);
    setCopied(true);
    toast("Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const showEditor = editing || !existing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Share link</h3>
        <p className="mt-1 truncate text-sm text-zinc-500">for {file.name}</p>

        {loading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : showEditor ? (
          <div className="mt-4">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {editing ? "Rename link" : "Choose a link name"}
            </label>
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
                onClick={() => (editing ? setEditing(false) : onClose())}
                className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !slug.trim()}>
                {busy ? "Saving…" : editing ? "Save" : "Create link"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-zinc-600">
              This is the file&apos;s permanent link. It always opens the current version —
              replace the file or restore a version (⋮ → Versions) to change what it serves.
            </p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={linkUrl ?? ""} onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            <div className="mt-4 flex justify-between">
              <Button
                onClick={() => {
                  setSlug(existing?.slug ?? "");
                  setError(null);
                  setEditing(true);
                }}
                className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Rename
              </Button>
              <Button onClick={onClose} className="bg-zinc-900 hover:bg-zinc-700">
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
