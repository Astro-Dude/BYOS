"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/** A sienna light travelling round a hairline ring: a conic sweep spinning
 *  behind the element, seen only through the gap its padding leaves. Put it
 *  first inside an `overflow-hidden rounded-full` parent with a little padding. */
export function TravellingLight() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-[-150%] animate-[spin_5s_linear_infinite] motion-reduce:animate-none"
      style={{
        background:
          "conic-gradient(from 0deg, transparent 0deg 250deg, rgb(var(--c-blush-mid)) 305deg, rgb(var(--c-blush-ink)) 340deg, transparent 360deg)",
      }}
    />
  );
}

/** The round handle that straddles a sidebar's right edge to collapse or
 *  expand it. Its parent must be `relative`. Desktop only: on phones the
 *  sidebars are drawers with their own close control. */
export function RailToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={collapsed ? "Expand" : "Collapse"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className="group absolute -right-3.5 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 overflow-hidden rounded-full bg-zinc-200 p-[1.5px] transition-colors hover:bg-zinc-900 md:block"
    >
      <TravellingLight />
      <span className="relative flex h-full w-full items-center justify-center rounded-full bg-white text-zinc-500 transition-colors group-hover:bg-zinc-900 group-hover:text-white">
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-px" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-px" />
        )}
      </span>
    </button>
  );
}

/** The phone counterpart of RailToggle: a round, ringed button for opening or
 *  closing a drawer, so the control looks the same at every width. */
export function RingButton({
  label,
  onClick,
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`group relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-zinc-200 p-[1.5px] transition-colors hover:bg-zinc-900 ${className}`}
    >
      <TravellingLight />
      <span className="relative flex h-full w-full items-center justify-center rounded-full bg-white text-zinc-600 transition-colors group-hover:bg-zinc-900 group-hover:text-white">
        {children}
      </span>
    </button>
  );
}
