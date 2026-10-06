"use client";

import type { AgentMode } from "@byos/api-client";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ModeAvatar } from "@/components/mode-avatar";
import { AVATAR_TINT, AVATARS } from "@/lib/avatars";

/** Mirrors the API's Mode: a gradient of how much the model may do unattended.
 *  Read-only is both the default and the floor — it can search file contents and
 *  browse the drive (with sources), it just can't change anything. */
export type ChatMode = AgentMode;

type Entry = {
  value: ChatMode;
  label: string;
  /** Composer-button label — the full one doesn't fit next to the send button. */
  short: string;
  hint: string;
};

const READ_ONLY: Entry = {
  value: "read_only",
  label: "Read only",
  short: "Read",
  hint: "Searches and reads your files to answer questions. Changes nothing.",
};

export const MODES: Entry[] = [
  READ_ONLY,
  {
    value: "ask",
    label: "Ask first",
    short: "Ask",
    hint: "Proposes every change and waits for you to confirm.",
  },
  {
    value: "auto",
    label: "Auto-organize",
    short: "Auto",
    hint: "Moves, renames, tags and stars on its own. Asks before deleting or sharing.",
  },
  {
    value: "full",
    label: "Full access",
    short: "Full",
    hint: "Applies everything itself, including deletes and public links.",
  },
];

/** Permission-mode picker for the composer: one click shows what the model is
 *  allowed to do this turn, and how much of it happens without asking. */
export function ModeMenu({ value, onChange }: { value: ChatMode; onChange: (mode: ChatMode) => void }) {
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
        title={`${active.label} (${AVATARS[active.value].name}): ${active.hint}`}
        aria-label={`Permission mode: ${active.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
          AVATAR_TINT[active.value]
        } ${open ? "!border-zinc-900" : ""}`}
      >
        <ModeAvatar mode={active.value} live={open} className="h-7 w-7" />
      </button>

      {open ? (
        <div
          role="menu"
          className="menu-surface absolute bottom-11 right-0 z-30 w-[min(20rem,calc(100vw-2rem))] p-1.5"
        >
          <p className="px-2 py-1 text-[0.65rem] uppercase tracking-wide text-zinc-500">
            What the model may do
          </p>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="menuitemradio"
              aria-checked={m.value === value}
              onClick={() => {
                onChange(m.value);
                setOpen(false);
              }}
              className={`group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition ${
                m.value === value ? "bg-zinc-100" : "hover:bg-zinc-50"
              }`}
            >
              <ModeAvatar mode={m.value} live={m.value === value} className="-mt-0.5 h-7 w-7" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[0.9375rem] text-zinc-900">
                  {m.label}
                  <span className="font-display text-[0.8125rem] italic text-zinc-400">
                    {AVATARS[m.value].name}
                  </span>
                  {m.value === value ? <Check className="ml-auto h-3.5 w-3.5 text-zinc-900" /> : null}
                </span>
                <span className="mt-0.5 block text-[0.8125rem] leading-snug text-zinc-500">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
