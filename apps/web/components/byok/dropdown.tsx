"use client";

import { Check, ChevronDown, Loader2, Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** `keywords` is extra text the search box matches on but never shows (a
 *  country's full name behind "IN +91", say). */
export type DropdownOption = {
  value: string;
  label: string;
  keywords?: string;
  /** Shown before the label, in the menu and on the trigger. */
  icon?: ReactNode;
  /** A quieter second line under the label, in the menu only. */
  hint?: string;
};

/** A row shown instead of "No options" when the list is empty, so an empty
 *  picker points somewhere useful (e.g. "Add a key"). */
export type DropdownAction = { label: string; onClick: () => void };

/** Themed replacement for a native <select>: glassy menu, check on the selected
 *  row. Works from the keyboard like a select does (arrows, Enter, Escape), so it
 *  can stand in on forms. `block` stretches it to fill a form row; `searchable`
 *  adds a filter box for long lists; `creatable` also accepts whatever is typed
 *  (for model names the provider didn't list). */
export function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select",
  className = "",
  align = "left",
  emptyAction,
  block = false,
  searchable = false,
  creatable = false,
  loading = false,
  emptyText = "No options",
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  align?: "left" | "right";
  emptyAction?: DropdownAction;
  block?: boolean;
  searchable?: boolean;
  creatable?: boolean;
  loading?: boolean;
  /** Shown when there are no options at all (and no `emptyAction`). */
  emptyText?: string;
  ariaLabel?: string;
  /** Greyed out with the not-allowed cursor, e.g. a setting the model lacks. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Where the menu opens: at least as wide as the trigger, and upward when
  // there isn't room below. Measured before paint so it never jumps.
  const [place, setPlace] = useState({ up: false, minWidth: 0 });
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setPlace({ up: below < 320 && r.top > below, minWidth: r.width });
  }, [open]);
  const id = useId();

  const withSearch = searchable || creatable;
  const typed = query.trim();
  const q = typed.toLowerCase();
  const matches =
    withSearch && q
      ? options.filter((o) => `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(q))
      : options;
  // Last, so Enter on a partial name picks the first real match.
  const custom =
    creatable && typed && !options.some((o) => o.value.toLowerCase() === q)
      ? { value: typed, label: `Use “${typed}”` }
      : null;
  const shown: DropdownOption[] = custom ? [...matches, custom] : matches;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Opening starts on the selected row, the way a native select does.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    if (withSearch) searchRef.current?.focus();
    // Only on open: re-running when options change would yank the highlight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (v: string) => {
    onChange(v);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const last = shown.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(Math.max(0, last));
        break;
      case "Enter":
        e.preventDefault();
        if (shown[active]) pick(shown[active].value);
        else if (options.length === 0 && emptyAction) {
          close(false);
          emptyAction.onClick();
        }
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // don't also close a modal this sits in
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const selected = options.find((o) => o.value === value);
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div ref={ref} className={`relative ${block ? "w-full" : ""}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        // The label takes the spare width, so in a trigger wider than its text
        // (a min-width, or `block`) the arrow sits at the right edge.
        className={`flex items-center justify-between gap-2 text-left transition-colors aria-expanded:border-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 ${block ? "w-full" : ""} ${className}`}
      >
        {selected?.icon ? <span className="flex shrink-0 items-center text-zinc-600">{selected.icon}</span> : null}
        <span className={`min-w-0 flex-1 truncate ${selected || (creatable && value) ? "" : "text-zinc-500"}`}>
          {selected?.label ?? (creatable && value ? value : placeholder)}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          className={`dropdown-menu absolute z-30 flex max-h-80 min-w-[12rem] flex-col rounded-2xl p-1.5 ${
            place.up ? "dropdown-up bottom-full mb-2" : "top-full mt-2"
          } ${align === "right" ? "right-0" : "left-0"}`}
          style={{ minWidth: Math.max(place.minWidth, 192) }}
        >
          {withSearch ? (
            <div className="mb-1.5 flex shrink-0 items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={creatable ? "Search or type a name" : "Search"}
                aria-label="Search options"
                aria-controls={listId}
                aria-activedescendant={shown[active] ? optionId(active) : undefined}
                className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-zinc-900 outline-none placeholder:text-zinc-500"
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="thin-scroll min-h-0 overflow-y-auto"
          >
            {loading ? (
              <p className="flex items-center gap-2 px-3 py-2 text-[0.875rem] text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading
              </p>
            ) : null}
            {loading && shown.length === 0 ? null : options.length === 0 && emptyAction ? (
              <button
                type="button"
                onClick={() => {
                  close(false);
                  emptyAction.onClick();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[0.875rem] text-zinc-900 transition-colors hover:bg-zinc-100"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
                  <Plus className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{emptyAction.label}</span>
              </button>
            ) : shown.length === 0 ? (
              <p className="px-3 py-2 text-[0.875rem] text-zinc-500">
                {options.length === 0 ? emptyText : "No matches"}
              </p>
            ) : (
              shown.map((o, i) => (
                <button
                  key={o.value}
                  id={optionId(i)}
                  data-index={i}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  tabIndex={-1}
                  onClick={() => pick(o.value)}
                  onMouseEnter={() => setActive(i)}
                  className={`group/opt flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[0.875rem] transition-colors ${
                    i === active ? "bg-zinc-100 text-zinc-900" : "text-zinc-700"
                  } ${o.value === value ? "font-medium text-zinc-900" : ""}`}
                >
                  {o.icon ? (
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        i === active ? "bg-white text-zinc-900" : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {o.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint ? (
                      <span className="block truncate text-[0.75rem] font-normal text-zinc-500">{o.hint}</span>
                    ) : null}
                  </span>
                  <Check
                    className={`h-4 w-4 shrink-0 text-zinc-900 transition-opacity ${
                      o.value === value ? "opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
