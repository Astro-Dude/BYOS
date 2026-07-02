"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/** Lightweight dropdown: closes on outside-click or Escape. */
export function Menu({
  trigger,
  children,
  align = "right",
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger(open)}
      </button>
      {open ? (
        <div
          className={`absolute ${
            align === "right" ? "right-0" : "left-0"
          } z-30 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
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
