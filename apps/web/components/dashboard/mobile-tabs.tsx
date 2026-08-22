"use client";

import { Copy, FileWarning, HardDrive, Link2, MoreHorizontal, Plus, Sparkles, Star, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { DriveView } from "@/components/dashboard/sidebar";

/** Floating bottom tab bar — phone only.
 *
 *  On a phone the left rail cost 4.5rem of a 360px viewport and still only fitted
 *  icons, so below `md` the rail is hidden entirely and navigation moves down
 *  here, within thumb reach.
 *
 *  This is the one place the app uses glass. It's an iOS convention and it earns
 *  the exception: a bar floating over scrolling content needs to read as *above*
 *  that content, and on a flat white system a solid bar just looks like a stuck
 *  row. Everything above phone width stays flat — see `.glass` in globals.css.
 */
const TABS: { id: DriveView; label: string; icon: typeof HardDrive }[] = [
  { id: "drive", label: "Drive", icon: HardDrive },
  { id: "starred", label: "Starred", icon: Star },
];

const MORE: { id: DriveView; label: string; icon: typeof HardDrive }[] = [
  { id: "links", label: "Links", icon: Link2 },
  { id: "duplicates", label: "Duplicates", icon: Copy },
  { id: "missing", label: "Missing", icon: FileWarning },
];

export function MobileTabs({
  view,
  onView,
  onNew,
}: {
  view: DriveView;
  onView: (v: DriveView) => void;
  onNew: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  const inMore = MORE.some((m) => m.id === view) || view === "developer";

  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 text-[0.625rem] transition-colors ${
      active ? "text-zinc-900" : "text-zinc-500"
    }`;

  return (
    <>
      {/* Tapping outside closes the sheet; it sits under the sheet but over the
          page so a stray tap can't hit the list behind. */}
      {sheet ? (
        <div className="fixed inset-0 z-[94] md:hidden" onClick={() => setSheet(false)} />
      ) : null}

      {sheet ? (
        <div className="glass safe-bottom fixed bottom-20 left-3 right-3 z-[96] rounded-3xl p-2 shadow-lg md:hidden">
          {MORE.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onView(m.id);
                setSheet(false);
              }}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-[0.9375rem] ${
                view === m.id ? "bg-zinc-900/[0.06] text-zinc-900" : "text-zinc-700"
              }`}
            >
              <m.icon className="h-[18px] w-[18px] shrink-0" />
              {m.label}
            </button>
          ))}
          <Link
            href="/byok"
            className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-[0.9375rem] text-zinc-700"
          >
            <Sparkles className="h-[18px] w-[18px] shrink-0" />
            BYOK
          </Link>
        </div>
      ) : null}

      <nav
        aria-label="Sections"
        className="glass safe-bottom fixed bottom-3 left-3 right-3 z-[95] flex items-stretch gap-1 rounded-3xl px-2 pt-1.5 shadow-lg md:hidden"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onView(t.id)}
            aria-current={view === t.id ? "page" : undefined}
            className={tab(view === t.id)}
          >
            <t.icon className="h-[19px] w-[19px]" />
            {t.label}
          </button>
        ))}

        {/* Primary action, centre stage — the iOS pattern, and it keeps New
            reachable now that the rail is gone. */}
        <button
          onClick={onNew}
          aria-label="New"
          className="mx-1 flex h-11 w-11 shrink-0 -translate-y-1.5 items-center justify-center self-center rounded-full bg-zinc-900 text-white shadow-md transition-transform active:scale-95"
        >
          <Plus className="h-5 w-5" />
        </button>

        <button
          onClick={() => onView("links")}
          aria-current={view === "links" ? "page" : undefined}
          className={tab(view === "links")}
        >
          <Link2 className="h-[19px] w-[19px]" />
          Links
        </button>
        <button
          onClick={() => setSheet((v) => !v)}
          aria-expanded={sheet}
          className={tab(inMore || sheet)}
        >
          {sheet ? <X className="h-[19px] w-[19px]" /> : <MoreHorizontal className="h-[19px] w-[19px]" />}
          More
        </button>
      </nav>
    </>
  );
}
