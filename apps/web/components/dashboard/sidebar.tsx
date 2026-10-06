"use client";

import type { StorageAccount } from "@byos/api-client";
import {
  Code2,
  Copy,
  FileWarning,
  FolderPlus,
  HardDrive,
  Link2,
  Plus,
  Sparkles,
  Star,
  Upload,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Menu, MenuItem } from "@/components/dashboard/menu";
import { Logo, LogoMark } from "@/components/logo";
import { StorageIcon, inDays, providerName, storageHealth } from "@/components/storage-icon";
import { RailToggle, TravellingLight } from "@/components/ui/rail-toggle";
import { formatBytes } from "@/lib/utils";


export type DriveView =
  | "drive"
  | "starred"
  | "links"
  | "duplicates"
  | "missing"
  | "developer";

const BYOK_CELL = "18px";
const BYOK_GRID_BASE =
  "linear-gradient(to right, var(--grid-line) 1px, transparent 1px)," +
  "linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)";
// Warms under the cursor — sienna on paper, blush on ink (see --grid-lit).
const BYOK_GRID_GLOW =
  "linear-gradient(to right, var(--grid-lit) 1px, transparent 1px)," +
  "linear-gradient(to bottom, var(--grid-lit) 1px, transparent 1px)";
const RAIL_KEY = "byos:rail";
const BYOK_MASK =
  "radial-gradient(70px circle at var(--bx, 50%) var(--by, -60px), #000 0%, transparent 70%)";

/** The BYOK nav entry — its own little "world": a hairline ring with a sienna
 *  light travelling round it, which inks in on hover, over a grid whose lines
 *  warm to sienna under the cursor (matching /byok). The sweep uses the one
 *  accent pair Steep allows (sienna on blush). */
function ByokNavLink({ collapsed }: { collapsed: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <div className="pt-1">
      <Link
        href="/byok"
        title={collapsed ? "BYOK" : undefined}
        className="group relative block overflow-hidden rounded-full bg-zinc-200 p-[1.5px] transition-colors hover:bg-zinc-900"
      >
        <TravellingLight />
        <span
          ref={ref}
          onMouseMove={(e) => {
            const el = ref.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            el.style.setProperty("--bx", `${e.clientX - r.left}px`);
            el.style.setProperty("--by", `${e.clientY - r.top}px`);
          }}
          className={`relative flex items-center overflow-hidden rounded-full bg-white py-2 text-[0.9375rem] text-zinc-900 ${
            collapsed ? "justify-center px-2" : "justify-center px-2 md:justify-start md:gap-3 md:px-3.5"
          }`}
        >
          {/* Faint static grid */}
          <span
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: BYOK_GRID_BASE, backgroundSize: `${BYOK_CELL} ${BYOK_CELL}` }}
          />
          {/* Brighter grid revealed around the cursor */}
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: BYOK_GRID_GLOW,
              backgroundSize: `${BYOK_CELL} ${BYOK_CELL}`,
              maskImage: BYOK_MASK,
              WebkitMaskImage: BYOK_MASK,
            }}
          />
          <Sparkles className="relative h-[17px] w-[17px] shrink-0" />
          <span className={collapsed ? "hidden" : "relative hidden md:inline"}>BYOK</span>
        </span>
      </Link>
    </div>
  );
}

export function Sidebar({
  view,
  onView,
  onNewFolder,
  onUpload,
  onUploadTo,
  storages,
}: {
  view: DriveView;
  onView: (view: DriveView) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  /** Upload, choosing the storage first. Offered with more than one connected. */
  onUploadTo?: () => void;
  /** Connected storages, or null while they load. */
  storages: StorageAccount[] | null;
}) {
  // Collapsed by default: the drive itself is the point, and the rail's labels
  // are learnable. The choice is remembered per browser.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_KEY) === "open") setCollapsed(false);
    } catch {
      /* storage unavailable — stay collapsed */
    }
  }, []);

  const toggleRail = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(RAIL_KEY, next ? "closed" : "open");
      } catch {
        /* ignore */
      }
      return next;
    });

  const navItem = (id: DriveView, label: string, icon: ReactNode) => (
    <button
      onClick={() => onView(id)}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={`${view === id ? "nav-item-active" : "nav-item"} ${
        collapsed ? "justify-center px-0" : "justify-center md:justify-start md:px-3.5"
      }`}
      aria-current={view === id ? "page" : undefined}
    >
      {icon}
      <span className={collapsed ? "hidden" : "hidden md:inline"}>{label}</span>
    </button>
  );

  const iconClass = "h-[17px] w-[17px] shrink-0";

  // Hidden on phones: navigation moves to the floating tab bar, which frees the
  // whole width for content instead of spending 4.5rem on an icon strip.
  return (
    <aside
      className={`relative hidden shrink-0 flex-col gap-2 border-r border-zinc-200 bg-white px-3 pb-5 pt-6 transition-[width] duration-300 ease-out md:flex ${
        collapsed ? "w-[4.5rem]" : "w-64"
      }`}
    >
      {/* The handle straddles the rail's edge rather than living inside it, so
          the rail's own space stays for navigation. It wears the same travelling
          sienna ring as the BYOK entry, so it's easy to spot on the seam; a
          chevron says which way it goes more plainly than a panel glyph. */}
      <RailToggle collapsed={collapsed} onToggle={toggleRail} />

      <div className={`flex items-center pb-4 ${collapsed ? "justify-center" : "px-2"}`}>
        {collapsed ? (
          <LogoMark className="h-9 w-9" />
        ) : (
          <>
            <LogoMark className="h-9 w-9 md:hidden" />
            <span className="hidden md:block">
              <Logo wordClassName="text-xl" />
            </span>
          </>
        )}
      </div>

      <div className="pb-3">
        <Menu
          align="left"
          className="w-full"
          trigger={() => (
            <span
              title={collapsed ? "New" : undefined}
              className={`flex items-center justify-center gap-2 rounded-full border border-zinc-900 bg-white text-[0.9375rem] text-zinc-900 transition-colors hover:bg-zinc-900 hover:text-white ${
                collapsed
                  ? "mx-auto h-10 w-10"
                  : "mx-auto h-10 w-10 md:mx-0 md:h-auto md:w-full md:px-5 md:py-3"
              }`}
            >
              <Plus className="h-4 w-4" />
              <span className={collapsed ? "hidden" : "hidden md:inline"}>New</span>
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
              {onUploadTo ? (
                <MenuItem
                  icon={<UploadCloud className="h-4 w-4" />}
                  label="Upload to…"
                  onClick={() => {
                    close();
                    onUploadTo();
                  }}
                />
              ) : null}
            </>
          )}
        </Menu>
      </div>

      <nav className="space-y-0.5">
        {navItem("drive", "My Drive", <HardDrive className={iconClass} />)}
        {navItem("starred", "Starred", <Star className={iconClass} />)}
        {navItem("links", "Links", <Link2 className={iconClass} />)}
        {navItem("duplicates", "Duplicates", <Copy className={iconClass} />)}
        {navItem("missing", "Missing", <FileWarning className={iconClass} />)}
        <ByokNavLink collapsed={collapsed} />
      </nav>

      {/* Developer + storage pinned to the bottom. */}
      <div className="mt-auto space-y-2">
        <nav className="space-y-0.5">
          {navItem("developer", "Developer", <Code2 className={iconClass} />)}
        </nav>
        <div className={collapsed ? "hidden" : "hidden md:block"}>
          <StorageCard storages={storages} />
        </div>
      </div>
    </aside>
  );
}

// One tone per storage, in the order they're listed: the bar's segments and
// the rows' dots share them.
const TONES = ["bg-zinc-900", "bg-amber-500", "bg-zinc-400"];

/** Where the bytes live: the total, a bar split by storage, and a row for each
 *  storage with its own usage. Storages that lost their credentials but still
 *  hold files stay listed, flagged, since those files are still in the drive. */
function StorageCard({ storages }: { storages: StorageAccount[] | null }) {
  const shown = (storages ?? []).filter((s) => s.status === "connected" || s.files > 0);
  const total = shown.reduce((n, s) => n + s.bytes, 0);
  const manage = "/settings/storage?from=drive";

  if (storages === null) {
    return (
      <div className="surface-card mt-2 space-y-2.5 p-4" aria-busy="true">
        <div className="byok-shimmer h-4 w-20 rounded" />
        <div className="byok-shimmer h-1.5 w-full rounded-full" />
        <div className="byok-shimmer h-3.5 w-32 rounded" />
      </div>
    );
  }

  if (shown.length === 0) {
    return (
      <Link href={manage} className="surface-card mt-2 block p-4 transition-colors hover:bg-zinc-200/60">
        <p className="text-[0.9375rem] text-zinc-900">No storage yet</p>
        <p className="mt-0.5 text-[0.8125rem] text-zinc-500">Connect Telegram, GitHub or S3</p>
      </Link>
    );
  }

  return (
    <div className="surface-card mt-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.9375rem] text-zinc-900">
          {formatBytes(total)} <span className="text-[0.8125rem] text-zinc-500">used</span>
        </p>
        <Link href={manage} className="text-[0.8125rem] text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline">
          Manage
        </Link>
      </div>

      {shown.length > 1 ? (
        <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white">
          {shown.map((s, i) =>
            s.bytes > 0 ? (
              <span
                key={s.id}
                className={`h-full rounded-full ${TONES[i % TONES.length]}`}
                style={{ width: `${(s.bytes / total) * 100}%`, minWidth: 6 }}
              />
            ) : null,
          )}
        </div>
      ) : null}

      <ul className={`thin-scroll max-h-44 space-y-2.5 overflow-y-auto ${shown.length > 1 ? "mt-3" : "mt-2"}`}>
        {shown.map((s, i) => {
          const health = storageHealth(s);
          const ok = health.state === "ok" || health.state === "expiring";
          const where = s.label || s.bucket;
          const fix = `/settings/storage?from=drive&reconnect=${s.id}`;
          return (
            <li
              key={s.id}
              title={`${providerName(s.provider)}${where ? ` · ${where}` : ""}: ${s.files} ${s.files === 1 ? "file" : "files"}`}
              className="flex items-center gap-2.5"
            >
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700">
                <StorageIcon provider={s.provider} className="h-3.5 w-3.5" />
                {shown.length > 1 ? (
                  <span
                    className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-zinc-100 ${TONES[i % TONES.length]}`}
                    aria-hidden
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
                  <span className="truncate text-zinc-900">{providerName(s.provider)}</span>
                  {ok ? (
                    <span className="shrink-0 tabular-nums text-zinc-500">{formatBytes(s.bytes)}</span>
                  ) : (
                    <Link href={s.provider === "telegram" ? manage : fix} className="shrink-0 text-amber-700 hover:underline">
                      Reconnect
                    </Link>
                  )}
                </span>
                {health.state === "expiring" ? (
                  <Link href={fix} className="block truncate text-[0.75rem] text-amber-700 hover:underline">
                    Token expires {inDays(health.days)}
                  </Link>
                ) : where ? (
                  <span className="block truncate text-[0.75rem] text-zinc-500">{where}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
