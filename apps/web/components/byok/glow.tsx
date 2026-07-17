"use client";

import { type ReactNode, useRef } from "react";

const CELL = "46px";
const GRID_BASE =
  "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px)," +
  "linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)";
const GRID_GLOW =
  "linear-gradient(to right, rgba(74,129,119,0.55) 1px, transparent 1px)," +
  "linear-gradient(to bottom, rgba(74,129,119,0.55) 1px, transparent 1px)";
const CURSOR_MASK =
  "radial-gradient(220px circle at var(--mx, 50%) var(--my, -100px), " +
  "#000 0%, rgba(0,0,0,0.35) 45%, transparent 72%)";

/** Wraps content in the BYOK "world": a faint grid wallpaper whose lines light
 *  up teal in a radius around the cursor. Cursor position is written to CSS vars
 *  and used to mask the glowing grid layer. */
export function Glow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      className={`relative ${className}`}
    >
      {/* Faint static grid wallpaper */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{ backgroundImage: GRID_BASE, backgroundSize: `${CELL} ${CELL}` }}
      />
      {/* Same grid, brighter teal, revealed only around the cursor */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: GRID_GLOW,
          backgroundSize: `${CELL} ${CELL}`,
          maskImage: CURSOR_MASK,
          WebkitMaskImage: CURSOR_MASK,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** Shared glass-card classes for the BYOK world. */
export const GLASS =
  "rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-xl shadow-black/20";
