"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Pos = { top?: number; bottom?: number; left?: number; right?: number };

/** Lightweight dropdown. Renders the panel in a portal with fixed positioning
 *  so it's never clipped by an ancestor's overflow (list container, scroll
 *  area). Closes on outside-click, Escape, scroll, or resize. */
export function Menu({
  trigger,
  children,
  align = "right",
  className = "",
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const horizontal: Pos =
      align === "right"
        ? { right: Math.max(8, window.innerWidth - r.right) }
        : { left: r.left };
    // Flip up when the trigger is in the lower part of the viewport.
    const openUp = r.bottom > window.innerHeight - 220;
    setPos(
      openUp
        ? { bottom: window.innerHeight - r.top + 4, ...horizontal }
        : { top: r.bottom + 4, ...horizontal },
    );
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={className.includes("w-full") ? "w-full" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!open) place();
          setOpen((o) => !o);
        }}
      >
        {trigger(open)}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}
              className="z-[100] min-w-[11rem] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
            >
              {children(() => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function MenuItem({
  label,
  onClick,
  danger,
  icon,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-zinc-50 ${
        danger ? "text-red-600" : "text-zinc-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
