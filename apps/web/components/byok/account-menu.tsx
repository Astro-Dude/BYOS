"use client";

import { ArrowLeft, LogOut, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

export function initialsOf(label: string): string {
  return (
    label
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/** Account chip at the bottom of the BYOK sidebar — shows who's signed in and
 *  opens a menu (Settings / back to Drive / Log out), ChatGPT-style. */
export function AccountMenu({ onSettings }: { onSettings: () => void }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const name = user?.display_name || user?.username || "Account";
  const subtitle = user?.email || (user?.username ? `@${user.username}` : "");

  return (
    <div ref={ref} className="relative">
      {open ? (
        <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 py-1 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-zinc-200">
              {initialsOf(name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-100">{name}</p>
              {subtitle ? <p className="truncate text-xs text-zinc-500">{subtitle}</p> : null}
            </div>
          </div>
          <div className="my-1 border-t border-white/10" />
          <button
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/5"
          >
            <SettingsIcon className="h-4 w-4 text-zinc-400" /> Settings
          </button>
          <Link
            href="/dashboard"
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4 text-zinc-400" /> Back to Drive
          </Link>
          <div className="my-1 border-t border-white/10" />
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-400 transition hover:bg-red-500/10"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      ) : null}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-zinc-200">
          {initialsOf(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-zinc-100">{name}</p>
          {subtitle ? <p className="truncate text-xs text-zinc-500">{subtitle}</p> : null}
        </div>
      </button>
    </div>
  );
}
