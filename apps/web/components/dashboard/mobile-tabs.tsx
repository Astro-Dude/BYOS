"use client";

import {
  Code2,
  Coffee,
  Copy,
  FileWarning,
  FolderPlus,
  HardDrive,
  Link2,
  MoreHorizontal,
  Plus,
  Settings as SettingsIcon,
  Star,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Menu, MenuItem } from "@/components/dashboard/menu";
import { ModeAvatar } from "@/components/mode-avatar";

import type { DriveView } from "@/components/dashboard/sidebar";
import { openSupport } from "@/components/support-fab";
import { supportEnabled } from "@/components/support-modal";

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
  { id: "duplicates", label: "Duplicates", icon: Copy },
  { id: "missing", label: "Missing", icon: FileWarning },
  { id: "developer", label: "Developer", icon: Code2 },
];

export function MobileTabs({
  view,
  onView,
}: {
  view: DriveView;
  onView: (v: DriveView) => void;
}) {
  // The "more" sheet hangs off the last tab. (New lives at the top of the
  // drive now, under List/Grid; see MobileNewMenu.)
  const [sheet, setSheet] = useState<"more" | null>(null);
  const shape = useBarShape();
  const inMore = MORE.some((m) => m.id === view);

  const sheetItem =
    "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[0.9375rem] text-zinc-700";

  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 text-[0.625rem] transition-colors ${
      active ? "text-zinc-900" : "text-zinc-500"
    }`;

  return (
    <>
      {/* Tapping outside closes the sheet; it sits under the sheet but over the
          page so a stray tap can't hit the list behind. */}
      {sheet ? (
        <div className="fixed inset-0 z-[39] md:hidden" onClick={() => setSheet(null)} />
      ) : null}

      {sheet === "more" ? (
        <div className="glass fixed bottom-[6.75rem] left-3 right-3 z-[41] rounded-3xl p-2 md:hidden">
          {MORE.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onView(m.id);
                setSheet(null);
              }}
              className={`${sheetItem} ${view === m.id ? "bg-zinc-900/[0.06] text-zinc-900" : ""}`}
            >
              <m.icon className="h-[18px] w-[18px] shrink-0" />
              {m.label}
            </button>
          ))}
          <div className="mx-4 my-1 border-t border-zinc-900/10" />
          <Link href="/settings?from=drive" className={sheetItem}>
            <SettingsIcon className="h-[18px] w-[18px] shrink-0" />
            Settings
          </Link>
          {supportEnabled ? (
            <button
              onClick={() => {
                setSheet(null);
                openSupport();
              }}
              className={sheetItem}
            >
              <Coffee className="h-[18px] w-[18px] shrink-0" />
              Buy me a coffee
            </button>
          ) : null}
        </div>
      ) : null}

      {/* The bar: glass, with its top edge rising in a curve around the raised
          BYOK button. The shape is a clip path drawn to the bar's measured size,
          so the blur follows the curve too; a hairline traces the same path. */}
      <nav
        ref={shape.ref}
        aria-label="Sections"
        className="fixed bottom-3 left-3 right-3 z-40 pt-[22px] md:hidden"
      >
        {shape.path ? (
          <>
            {/* The lift: a soft shadow masked to fall only outside the shape,
                so it doesn't grey the clear glass from underneath. */}
            <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <filter id="tabbar-shadow" x="-20%" y="-40%" width="140%" height="200%">
                  <feGaussianBlur stdDeviation="10" />
                </filter>
                <mask id="tabbar-outside" maskUnits="userSpaceOnUse" x="-100" y="-100" width="10000" height="1000">
                  <rect x="-100" y="-100" width="10000" height="1000" fill="white" />
                  <path d={shape.path} fill="black" />
                </mask>
              </defs>
              <g mask="url(#tabbar-outside)">
                <path d={shape.path} fill="rgb(0 0 0 / 0.22)" filter="url(#tabbar-shadow)" transform="translate(0 8)" />
              </g>
            </svg>
            <div
              aria-hidden
              className="glass-fill pointer-events-none absolute inset-0"
              style={{ clipPath: `path("${shape.path}")` }}
            />
            {/* The rim: white light along the edge, over a hairline that keeps
                the shape defined on a white page. */}
            <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <path d={shape.path} fill="none" stroke="rgb(0 0 0 / 0.1)" strokeWidth="1" />
              <path d={shape.path} fill="none" stroke="rgb(255 255 255 / 0.9)" strokeWidth="1.5" transform="translate(0 0.75)" />
            </svg>
          </>
        ) : null}

        <div className="safe-bottom relative flex items-stretch gap-1 px-2 pt-1.5">
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

          {/* BYOK, centre stage and raised into the bar's curve. */}
          <Link
            href="/byok"
            aria-label="BYOK, chat with your drive"
            className="group mx-1 flex w-16 shrink-0 flex-col items-center justify-end gap-1 text-[0.625rem] font-medium text-zinc-900"
          >
            <span className="-mt-[30px] flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 shadow-[0_6px_16px_rgb(0_0_0/0.18)] ring-4 ring-[rgb(var(--c-paper)/0.7)] transition-transform group-active:scale-95">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--c-paper))]">
                <ModeAvatar mode="ask" className="h-9 w-9" />
              </span>
            </span>
            BYOK
          </Link>

          <button
            onClick={() => onView("links")}
            aria-current={view === "links" ? "page" : undefined}
            className={tab(view === "links")}
          >
            <Link2 className="h-[19px] w-[19px]" />
            Links
          </button>
          <button
            onClick={() => setSheet((v) => (v === "more" ? null : "more"))}
            aria-expanded={sheet === "more"}
            className={tab(inMore || sheet === "more")}
          >
            {sheet === "more" ? (
              <X className="h-[19px] w-[19px]" />
            ) : (
              <MoreHorizontal className="h-[19px] w-[19px]" />
            )}
            More
          </button>
        </div>
      </nav>
    </>
  );
}

/** The bar's outline: a rounded rectangle whose top edge swells into a smooth
 *  bump around the centre button. Recomputed when the bar resizes. */
function useBarShape() {
  const ref = useRef<HTMLElement>(null);
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const top = 22; // the bar's top edge; the bump rises above it to 0
      const r = 26; // corner radius
      const cx = w / 2;
      const a = 50; // half the bump's width where it meets the edge
      setPath(
        [
          `M ${r} ${top}`,
          `L ${cx - a} ${top}`,
          `C ${cx - a + 20} ${top} ${cx - 30} 0 ${cx} 0`,
          `C ${cx + 30} 0 ${cx + a - 20} ${top} ${cx + a} ${top}`,
          `L ${w - r} ${top}`,
          `A ${r} ${r} 0 0 1 ${w} ${top + r}`,
          `L ${w} ${h - r}`,
          `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
          `L ${r} ${h}`,
          `A ${r} ${r} 0 0 1 0 ${h - r}`,
          `L 0 ${top + r}`,
          `A ${r} ${r} 0 0 1 ${r} ${top}`,
          "Z",
        ].join(" "),
      );
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, path };
}

/** Phones: the New button at the top of the drive, under List/Grid. Upload,
 *  upload to a chosen storage, or a new folder, the same as the rail's New. */
export function MobileNewMenu({
  onNewFolder,
  onUpload,
  onUploadTo,
}: {
  onNewFolder: () => void;
  onUpload: () => void;
  onUploadTo?: () => void;
}) {
  return (
    <Menu
      label="New"
      className="ml-auto md:hidden"
      trigger={(open) => (
        <span
          className={`flex h-9 items-center gap-1.5 rounded-full bg-zinc-900 px-3.5 text-[0.875rem] font-medium text-white transition-transform active:scale-95 ${
            open ? "ring-2 ring-zinc-900/20" : ""
          }`}
        >
          <Plus className={`h-4 w-4 transition-transform ${open ? "rotate-45" : ""}`} /> New
        </span>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<Upload className="h-4 w-4" />} label="Upload files" onClick={() => { close(); onUpload(); }} />
          {onUploadTo ? (
            <MenuItem icon={<UploadCloud className="h-4 w-4" />} label="Upload to…" onClick={() => { close(); onUploadTo(); }} />
          ) : null}
          <MenuItem icon={<FolderPlus className="h-4 w-4" />} label="New folder" onClick={() => { close(); onNewFolder(); }} />
        </>
      )}
    </Menu>
  );
}
