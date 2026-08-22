"use client";

import type { ProviderStatus } from "@byos/api-client";
import {
  ChevronLeft,
  ChevronRight,
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
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Menu, MenuItem } from "@/components/dashboard/menu";
import { Logo, LogoMark } from "@/components/logo";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

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

export type DriveView =
  | "drive"
  | "starred"
  | "links"
  | "duplicates"
  | "missing"
  | "developer"
  | "profile";

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

/** The BYOK nav entry — its own little "world": a hairline that inks in on
 *  hover, over a grid whose lines warm to sienna under the cursor (matching
 *  /byok). The rotating coloured border is gone; Steep has no accent to spin. */
function ByokNavLink({ collapsed }: { collapsed: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <div className="pt-1">
      <Link
        href="/byok"
        title={collapsed ? "BYOK" : undefined}
        className="group relative block overflow-hidden rounded-full bg-zinc-200 p-px transition-colors hover:bg-zinc-900"
      >
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
}: {
  view: DriveView;
  onView: (view: DriveView) => void;
  onNewFolder: () => void;
  onUpload: () => void;
}) {
  const authed = useAuthed();
  const [telegram, setTelegram] = useState<ProviderStatus | null>(null);
  const [used, setUsed] = useState<number | null>(null);
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
          the rail's own space stays for navigation. Paper fill with a hairline
          reads on the seam between the white rail and the fog canvas; a chevron
          says which way it goes more plainly than a panel glyph. */}
      <button
        onClick={toggleRail}
        title={collapsed ? "Expand" : "Collapse"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        className="absolute -right-3 top-1/2 z-20 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-900 hover:bg-zinc-900 hover:text-white md:flex"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>

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
        <div className={`surface-card mt-2 p-4 ${collapsed ? "hidden" : "hidden md:block"}`}>
          <div className="flex items-baseline justify-between">
            <span className="text-[0.9375rem] text-zinc-900">
              {used != null ? formatBytes(used) : "Storage"}
            </span>
            <span className="type-label">Unlimited</span>
          </div>
          <p className="mt-1 type-label">
            {telegram
              ? `Telegram${telegram.label ? ` · ${telegram.label}` : ""}`
              : "Connecting…"}
          </p>
        </div>
      </div>
    </aside>
  );
}
