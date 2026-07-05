"use client";

import { ApiError, type ShareItem } from "@byos/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

function summary(share: ShareItem): string {
  const parts: string[] = [];
  if (share.has_password) parts.push("password");
  if (share.view_only) parts.push("view-only");
  if (share.expires_at) parts.push(`expires ${new Date(share.expires_at).toLocaleDateString()}`);
  if (share.max_downloads) parts.push(`${share.download_count}/${share.max_downloads} downloads`);
  else parts.push(`${share.download_count} downloads`);
  return parts.join(" · ");
}

export function SharesPanel({ refreshKey }: { refreshKey: number }) {
  const authed = useAuthed();
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setShares(await authed((t) => api.listShares(t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const revoke = async (share: ShareItem) => {
    try {
      await authed((t) => api.deleteShare(t, share.id));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Revoke failed");
    }
  };

  const copy = async (share: ShareItem) => {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${share.token}`);
    setCopied(share.id);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!loading && shares.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">Shared links</h2>
      <p className="text-sm text-zinc-500">Links with access controls (password, expiry, limits).</p>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <ul className="mt-4 divide-y divide-zinc-100">
        {shares.map((share) => (
          <li key={share.id} className="flex items-center justify-between gap-4 py-2">
            <div className="min-w-0">
              <code className="truncate text-sm text-indigo-600">/s/{share.token}</code>
              <p className="text-xs text-zinc-500">{summary(share)}</p>
            </div>
            <div className="flex shrink-0 gap-3 text-sm font-medium">
              <button onClick={() => copy(share)} className="text-zinc-600 hover:text-zinc-900">
                {copied === share.id ? "Copied" : "Copy URL"}
              </button>
              <button onClick={() => revoke(share)} className="text-red-600 hover:text-red-500">
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
