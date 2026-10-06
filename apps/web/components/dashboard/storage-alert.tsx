"use client";

import type { StorageAccount } from "@byos/api-client";
import { AlertTriangle, Clock, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { credentialName, inDays, providerName, storageHealth } from "@/components/storage-icon";

const DISMISSED_KEY = "byos:storage-alerts-dismissed";

type Alert = { id: string; tone: "soon" | "broken"; text: string; action: string; href: string };

/** Above the Drive: a storage whose token or keys stopped working (its files
 *  can't be opened until it's reconnected), or a GitHub token about to expire.
 *  Dismissing hides that alert for the rest of the browser session; a new
 *  problem with the same storage shows again. */
export function StorageAlerts({ storages }: { storages: StorageAccount[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    try {
      setDismissed(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
    } catch {
      /* storage unavailable: show everything */
    }
  }, []);

  const uploadsGoTo = storages.find((s) => s.is_default);
  const alerts = storages.flatMap((s): Alert[] => {
    // Telegram is also the login, so a dead session already sends people to
    // sign in again; nothing to say here.
    if (s.provider === "telegram") return [];
    const health = storageHealth(s);
    const name = providerName(s.provider);
    const where = s.label || s.bucket || name;
    const what = credentialName(s.provider);
    const fix = `/settings/storage?from=drive&reconnect=${s.id}`;
    if (health.state === "expiring") {
      return [
        {
          id: `${s.id}:expiring`,
          tone: "soon",
          text: `Your ${name} token for ${where} expires ${inDays(health.days)}. Add a new one before then so its files keep working.`,
          action: "Update token",
          href: fix,
        },
      ];
    }
    if (health.state === "expired" || (health.state === "disconnected" && s.files > 0)) {
      const lost = health.state === "expired" ? `The ${name} ${what} for ${where} stopped working` : `${where} is disconnected`;
      const elsewhere =
        uploadsGoTo && uploadsGoTo.id !== s.id ? ` New uploads go to ${providerName(uploadsGoTo.provider)} meanwhile.` : "";
      return [
        {
          id: `${s.id}:${health.state}`,
          tone: "broken",
          text: `${lost}, so its ${s.files.toLocaleString()} ${s.files === 1 ? "file" : "files"} can't be opened until you reconnect.${elsewhere}`,
          action: "Reconnect",
          href: fix,
        },
      ];
    }
    return [];
  });

  const shown = alerts.filter((a) => !dismissed.includes(a.id));
  if (shown.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* fine: it just comes back on reload */
    }
  };

  return (
    <div className="mb-4 space-y-2">
      {shown.map((a) => (
        <div
          key={a.id}
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-amber-400/60 bg-amber-50 px-4 py-3 text-[0.875rem] text-amber-700"
        >
          {a.tone === "broken" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="min-w-0 flex-1 leading-[1.5]">{a.text}</p>
          <Link
            href={a.href}
            className="shrink-0 rounded-full bg-amber-700 px-3 py-1 text-[0.8125rem] text-amber-50 transition-opacity hover:opacity-90"
          >
            {a.action}
          </Link>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(a.id)}
            className="-mr-1 shrink-0 rounded-full p-1 text-amber-700 transition-colors hover:bg-amber-400/30"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
