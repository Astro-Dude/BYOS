"use client";

import { isValidElement, type ReactNode } from "react";

/* Building blocks for Settings pages: a page header, a card of rows, a row
   with its control, and the two controls most settings need (a switch and a
   segmented choice). Quiet on purpose: hairlines and ink, per DESIGN.md. */

export function SettingsHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6 md:mb-8">
      {/* Phones show the title in the section's top bar instead. */}
      <h1 className="type-heading-sm hidden md:block">{title}</h1>
      {description ? (
        <p className="max-w-xl text-[0.9375rem] leading-[1.5] text-zinc-500 md:mt-2">{description}</p>
      ) : null}
    </header>
  );
}

/** A titled card holding a list of rows, separated by hairlines. */
export function SettingsGroup({
  title,
  description,
  children,
  footer,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="mb-8">
      {title ? <h2 className="type-label mb-1">{title}</h2> : null}
      {description ? <p className="mb-3 text-[0.8125rem] text-zinc-500">{description}</p> : null}
      <div className="rounded-2xl border border-zinc-200 bg-white px-5">
        <div className="divide-y divide-zinc-200">{children}</div>
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </section>
  );
}

/** One setting: what it is on the left, its control on the right. Wide
 *  controls stack under the label on phones; a switch stays on the right, as
 *  in any phone's settings. `disabled` greys it out with the not-allowed cursor. */
export function SettingRow({
  label,
  description,
  children,
  disabled = false,
  stack = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  /** Put the control under the label at every width (wide controls). */
  stack?: boolean;
}) {
  const isSwitch = isValidElement(children) && children.type === Toggle;
  const layout = stack
    ? "flex-col"
    : isSwitch
      ? "flex-row items-center justify-between gap-4 sm:gap-6"
      : "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6";
  return (
    <div
      className={`flex gap-3 py-4 ${layout} ${
        disabled ? "pointer-events-none cursor-not-allowed opacity-50" : ""
      }`}
      aria-disabled={disabled || undefined}
    >
      <div className="min-w-0">
        <p className="text-[0.9375rem] text-zinc-900">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[0.8125rem] leading-[1.45] text-zinc-500">{description}</p>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

/** An on/off switch. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** For screen readers; the row's visible label usually says it. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-zinc-900" : "bg-zinc-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; title?: string };

/** A row of pills where exactly one is chosen. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentOption<T>[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      // Pill-shaped on one line; a soft rectangle if it wraps on a narrow screen.
      className="inline-flex flex-wrap gap-1 rounded-[1.375rem] bg-zinc-100 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] transition-colors ${
            o.value === value
              ? "sel-fill shadow-sm"
              : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
