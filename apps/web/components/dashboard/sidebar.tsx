"use client";

import type { ProviderStatus } from "@byos/api-client";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

export type DriveView = "drive" | "links";

export function Sidebar({
  view,
  onView,
}: {
  view: DriveView;
  onView: (view: DriveView) => void;
}) {
  const authed = useAuthed();
  const [telegram, setTelegram] = useState<ProviderStatus | null>(null);

  useEffect(() => {
    authed((t) => api.listProviders(t))
      .then((ps) => setTelegram(ps.find((p) => p.provider === "telegram") ?? null))
      .catch(() => setTelegram(null));
  }, [authed]);

  const item = (id: DriveView, label: string, icon: string) => (
    <button
      onClick={() => onView(id)}
      className={`flex w-full items-center gap-3 rounded-full px-4 py-2 text-sm font-medium transition ${
        view === id ? "bg-indigo-100 text-indigo-800" : "text-zinc-700 hover:bg-zinc-100"
      }`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white p-4">
      <div className="px-3 pb-6 text-xl font-semibold tracking-tight">BYOS</div>
      <nav className="space-y-1">
        {item("drive", "My Drive", "🗂️")}
        {item("links", "Links", "🔗")}
      </nav>
      <div className="mt-auto rounded-lg bg-zinc-50 p-3 text-xs">
        <div className="font-medium text-zinc-700">Storage</div>
        <div className="mt-1 text-zinc-500">
          {telegram
            ? `Telegram${telegram.label ? ` · ${telegram.label}` : ""}`
            : "Connecting…"}
        </div>
      </div>
    </aside>
  );
}
