"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type DropdownOption = { value: string; label: string };

/** Themed replacement for a native <select> — glassy menu, teal check on the
 *  selected row. Closes on outside-click, Escape, or selection. */
export function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select",
  className = "",
  align = "left",
}: {
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 ${className}`}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
      </button>
      {open ? (
        <div
          className={`menu-surface thin-scroll absolute z-30 mt-1 max-h-72 min-w-[10rem] overflow-y-auto p-1 ${
 align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[0.8125rem] text-zinc-500">No options</p>
          ) : (
            options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.8125rem] transition ${
 o.value === value
                    ? "bg-zinc-900/10 text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                <Check
                  className={`h-3 w-3 shrink-0 ${
 o.value === value ? "text-zinc-600" : "opacity-0"
                  }`}
                />
                <span className="truncate">{o.label}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
