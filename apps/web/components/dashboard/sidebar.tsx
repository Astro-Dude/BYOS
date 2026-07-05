"use client";

import type { ProviderStatus } from "@byos/api-client";
import {
  BarChart3,
  Code2,
  FolderPlus,
  HardDrive,
  Link2,
  Moon,
  Plus,
  Star,
  Sun,
  Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Menu, MenuItem } from "@/components/dashboard/menu";
import { Logo } from "@/components/logo";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export type DriveView = "drive" | "starred" | "links" | "insights" | "developer";

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
  const { theme, toggle } = useTheme();
  const [telegram, setTelegram] = useState<ProviderStatus | null>(null);
  const [used, setUsed] = useState<number | null>(null);

  useEffect(() => {
    authed((t) => api.listProviders(t))
      .then((ps) => setTelegram(ps.find((p) => p.provider === "telegram") ?? null))
      .catch(() => setTelegram(null));
    authed((t) => api.getAnalyticsOverview(t))
      .then((o) => setUsed(o.storage_bytes))
      .catch(() => setUsed(null));
  }, [authed]);

  const navItem = (id: DriveView, label: string, icon: ReactNode) => (
    <button
      onClick={() => onView(id)}
      className={`flex w-full items-center gap-3 rounded-r-full px-6 py-2.5 text-sm font-medium transition ${
        view === id
          ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const iconClass = "h-[18px] w-[18px] shrink-0";

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-zinc-200 bg-white pb-4 pr-2 pt-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="px-5 pb-2">
        <Logo markClassName="h-10 w-10" wordClassName="text-xl" />
      </div>

      <div className="px-4 pb-2">
        <Menu
          align="left"
          className="w-full"
          trigger={() => (
            <span className="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-3.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
              <Plus className="h-4 w-4 text-indigo-600" />
              New
            </span>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={<FolderPlus className="h-4 w-4" />}
                label="New folder"
                onClick={() => {
                  close();
                  onNewFolder();
                }}
              />
              <MenuItem
                icon={<Upload className="h-4 w-4" />}
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
        {navItem("drive", "My Drive", <HardDrive className={iconClass} />)}
        {navItem("starred", "Starred", <Star className={iconClass} />)}
        {navItem("links", "Links", <Link2 className={iconClass} />)}
        {navItem("insights", "Insights", <BarChart3 className={iconClass} />)}
      </nav>

      {/* Developer + theme toggle + storage pinned to the bottom. */}
      <div className="mt-auto space-y-2">
        <nav>{navItem("developer", "Developer", <Code2 className={iconClass} />)}</nav>
        <div className="px-4">
          <button
            onClick={toggle}
            className="flex w-full items-center gap-3 rounded-full px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {theme === "dark" ? (
              <Sun className={iconClass} />
            ) : (
              <Moon className={iconClass} />
            )}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
        <div className="mx-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {used != null ? `${formatBytes(used)} used` : "Storage"}
            </span>
            <span className="font-medium text-indigo-700 dark:text-indigo-400">Unlimited</span>
          </div>
          <div className="mt-1 text-zinc-500">
            {telegram
              ? `Telegram${telegram.label ? ` · ${telegram.label}` : ""}`
              : "Connecting…"}
          </div>
        </div>
      </div>
    </aside>
  );
}
