"use client";

import { ApiError, type AuditItem } from "@byos/api-client";
import { Ban, Dot, Globe, KeyRound, LogIn, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { BrandLoader } from "@/components/ui/brand-loader";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

const ICON = "h-4 w-4 shrink-0 text-zinc-500";
const ACTION_META: Record<string, { icon: ReactNode; label: string }> = {
  login: { icon: <LogIn className={ICON} />, label: "Signed in" },
  "file.delete": { icon: <Trash2 className={ICON} />, label: "Deleted a file" },
  "share.create": { icon: <Globe className={ICON} />, label: "Created a share link" },
  "api_key.create": { icon: <KeyRound className={ICON} />, label: "Created an API key" },
  "api_key.revoke": { icon: <Ban className={ICON} />, label: "Revoked an API key" },
};

function describe(action: string): { icon: ReactNode; label: string } {
  return ACTION_META[action] ?? { icon: <Dot className={ICON} />, label: action };
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
        <BrandLoader className="py-16" />
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
                  {meta.icon}
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
