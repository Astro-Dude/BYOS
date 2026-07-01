"use client";

import type { ProviderStatus } from "@byos/api-client";
import { useEffect, useState } from "react";

import { Menu, MenuItem } from "@/components/dashboard/menu";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

export type DriveView = "drive" | "starred" | "links" | "insights";

export function Sidebar({
  view,
  onView,
  onNewFolder,
  onUpload,
}: {
  view: DriveView;
  onView: (view: DriveView) => void;
  onNewFolder: () => void;
  onUpload: () => void;
}) {
  const authed = useAuthed();
  const [telegram, setTelegram] = useState<ProviderStatus | null>(null);

  useEffect(() => {
    authed((t) => api.listProviders(t))
      .then((ps) => setTelegram(ps.find((p) => p.provider === "telegram") ?? null))
      .catch(() => setTelegram(null));
  }, [authed]);

  const navItem = (id: DriveView, label: string, icon: string) => (
    <button
      onClick={() => onView(id)}
      className={`flex w-full items-center gap-3 rounded-r-full px-6 py-2.5 text-sm font-medium transition ${
        view === id ? "bg-indigo-100 text-indigo-800" : "text-zinc-700 hover:bg-zinc-100"
      }`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-zinc-200 bg-white pb-4 pr-2 pt-4">
      <div className="px-6 pb-2 text-xl font-semibold tracking-tight text-indigo-700">BYOS</div>

      <div className="px-4 pb-2">
        <Menu
          align="left"
          trigger={() => (
            <span className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-3.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:shadow-md">
              <span className="text-lg leading-none text-indigo-600" aria-hidden>
                +
              </span>
              New
            </span>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon="📁"
                label="New folder"
                onClick={() => {
                  close();
                  onNewFolder();
                }}
              />
              <MenuItem
                icon="⬆️"
                label="Upload files"
                onClick={() => {
                  close();
                  onUpload();
                }}
              />
            </>
          )}
        </Menu>
      </div>

      <nav className="space-y-1">
        {navItem("drive", "My Drive", "🗂️")}
        {navItem("starred", "Starred", "⭐")}
        {navItem("links", "Links", "🔗")}
        {navItem("insights", "Insights", "📊")}
      </nav>

      <div className="mt-auto mx-4 rounded-xl bg-zinc-50 p-3 text-xs">
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
