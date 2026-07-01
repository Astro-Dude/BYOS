"use client";

import { ApiError, type FileItem, type ShareInput } from "@byos/api-client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

export function ShareModal({
  file,
  onClose,
  onCreated,
}: {
  file: FileItem;
  onClose: () => void;
  onCreated: () => void;
}) {
  const authed = useAuthed();
  const [password, setPassword] = useState("");
  const [expiry, setExpiry] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [viewOnly, setViewOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const input: ShareInput = { file_id: file.id, view_only: viewOnly };
      if (password.trim()) input.password = password.trim();
      if (expiry.trim()) input.expires_in_days = Number(expiry);
      if (maxDownloads.trim()) input.max_downloads = Number(maxDownloads);
      const share = await authed((t) => api.createShare(t, input));
      setUrl(api.shareUrl(share.token));
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Could not create share");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-zinc-900">Share link</h3>
        <p className="mt-1 truncate text-sm text-zinc-500">for {file.name}</p>

        {url ? (
          <div className="mt-4">
            <p className="text-sm text-zinc-600">Anyone with this link (and password, if set) can open it.</p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={onClose} className="bg-zinc-900 hover:bg-zinc-700">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-zinc-700">Password (optional)</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank for no password"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-sm font-medium text-zinc-700">Expires (days)</label>
                <Input
                  type="number"
                  min={1}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder="Never"
                />
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium text-zinc-700">Max downloads</label>
                <Input
                  type="number"
                  min={1}
                  value={maxDownloads}
                  onChange={(e) => setMaxDownloads(e.target.value)}
                  placeholder="Unlimited"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={viewOnly}
                onChange={(e) => setViewOnly(e.target.checked)}
              />
              View-only (preview, no download)
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                onClick={onClose}
                className="border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? "Creating…" : "Create link"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
