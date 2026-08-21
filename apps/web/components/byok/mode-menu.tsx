"use client";

import type { AgentMode } from "@byos/api-client";
import { Check, Eye, ShieldAlert, ShieldCheck, Wand2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Mirrors the API's Mode: a gradient of how much the model may do unattended.
 *  Read-only is both the default and the floor — it can search file contents and
 *  browse the drive (with sources), it just can't change anything. */
export type ChatMode = AgentMode;

type Entry = {
  value: ChatMode;
  label: string;
  hint: string;
  icon: ReactNode;
  /** Tints the button so a permissive mode is visible without opening the menu. */
  tone?: "warn" | "danger";
};

const ICON = "h-4 w-4 shrink-0";

const READ_ONLY: Entry = {
  value: "read_only",
  label: "Read only",
  hint: "Searches and reads your files to answer questions. Changes nothing.",
  icon: <Eye className={ICON} />,
};

export const MODES: Entry[] = [
  READ_ONLY,
  {
    value: "ask",
    label: "Ask first",
    hint: "Proposes every change and waits for you to confirm.",
    icon: <ShieldCheck className={ICON} />,
  },
  {
    value: "auto",
    label: "Auto-organize",
    hint: "Moves, renames, tags and stars on its own. Asks before deleting or sharing.",
    icon: <Wand2 className={ICON} />,
    tone: "warn",
  },
  {
    value: "full",
    label: "Full access",
    hint: "Applies everything itself, including deletes and public links.",
    icon: <ShieldAlert className={ICON} />,
    tone: "danger",
  },
];

const TONE = {
  warn: "text-amber-600 ring-1 ring-amber-400/40 dark:text-amber-400",
  danger: "text-red-600 ring-1 ring-red-400/50 dark:text-red-400",
} as const;

const TEXT_TONE = { warn: "text-amber-600 dark:text-amber-400", danger: "text-red-500" } as const;

/** Permission-mode picker for the composer: one click shows what the model is
 *  allowed to do this turn, and how much of it happens without asking. */
export function ModeMenu({
  value,
  onChange,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = MODES.find((m) => m.value === value) ?? READ_ONLY;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${active.label} — ${active.hint}`}
        aria-label={`Permission mode: ${active.label}`}
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-xs font-medium transition hover:bg-black/10 dark:hover:bg-white/10 ${
          active.tone ? TONE[active.tone] : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {active.icon}
        <span className="hidden sm:inline">{active.label}</span>
      </button>

      {open ? (
        <div className="absolute bottom-11 right-0 z-30 w-80 rounded-xl border border-zinc-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95">
          <p className="px-2 py-1 text-[0.65rem] uppercase tracking-wide text-zinc-500">
            What the model may do
          </p>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                onChange(m.value);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              <span className={`mt-0.5 ${m.tone ? TEXT_TONE[m.tone] : "text-indigo-500"}`}>
                {m.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm text-zinc-900 dark:text-zinc-100">
                  {m.label}
                  {m.value === value ? <Check className="h-3.5 w-3.5 text-indigo-500" /> : null}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                  {m.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
