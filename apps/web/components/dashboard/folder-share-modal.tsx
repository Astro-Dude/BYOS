"use client";

import { ApiError, type AliasItem } from "@byos/api-client";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

export function FolderShareModal({
  folder,
  onClose,
  onCreated,
}: {
  folder: { id: string; name: string };
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
        const found = aliases.find(
          (a) => a.target_type === "folder" && a.folder_id === folder.id,
        );
        if (found) setExisting(found);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [authed, folder.id]);

  // Folder links are browsable pages served by the web app, not the API.
  const linkUrl = existing ? `${window.location.origin}/${username}/${existing.slug}` : null;

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
        const created = await authed((t) => api.createFolderAlias(t, clean, folder.id));
        setExisting(created);
        toast("Folder shared");
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
      className="modal-scrim z-50"
      onClick={onClose}
    >
      <div className="modal-surface max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="type-heading-sm">Share folder</h3>
        <p className="mt-1 truncate text-[0.9375rem] text-zinc-500">📁 {folder.name}</p>

        {loading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : showEditor ? (
          <div className="mt-4">
            <label className="text-[0.9375rem] font-medium text-zinc-700">
              {editing ? "Rename link" : "Choose a link name"}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[0.9375rem] text-zinc-400">/{username}/</span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="design-assets"
                autoFocus
              />
            </div>
            <p className="mt-1 text-[0.8125rem] text-zinc-400">
              Anyone with this link can browse and download this folder&apos;s contents.
            </p>
            {error ? <p className="mt-2 text-[0.9375rem] text-red-600">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                onClick={() => (editing ? setEditing(false) : onClose())}
                className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
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
            <p className="text-[0.9375rem] text-zinc-600">
              This is the folder&apos;s permanent share link. Recipients get a browsable page —
              adding or removing files updates it automatically.
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
                className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
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
