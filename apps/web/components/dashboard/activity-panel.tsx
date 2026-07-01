"use client";

import { ApiError, type AuditItem } from "@byos/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

const ACTION_META: Record<string, { icon: string; label: string }> = {
  login: { icon: "🔓", label: "Signed in" },
  "file.delete": { icon: "🗑", label: "Deleted a file" },
  "share.create": { icon: "🌐", label: "Created a share link" },
  "api_key.create": { icon: "🔑", label: "Created an API key" },
  "api_key.revoke": { icon: "🚫", label: "Revoked an API key" },
};

function describe(action: string): { icon: string; label: string } {
  return ACTION_META[action] ?? { icon: "•", label: action };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityPanel() {
  const authed = useAuthed();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await authed((t) => api.getAuditLog(t, { limit: 100 })));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h1 className="text-2xl font-normal text-zinc-800">Activity</h1>
        <p className="text-sm text-zinc-500">Recent security-relevant actions on your account.</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-400">
          No activity recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {items.map((item) => {
            const meta = describe(item.action);
            return (
              <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden>{meta.icon}</span>
                  <span className="truncate text-sm text-zinc-800">{meta.label}</span>
                </span>
                <span className="shrink-0 text-xs text-zinc-400">{when(item.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
