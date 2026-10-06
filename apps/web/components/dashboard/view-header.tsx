import type { ReactNode } from "react";

/** The top of a Drive tool page (Links, Duplicates, Missing): a small label, the
 *  title, one line on what the page is for, the page's actions on the right,
 *  and a row of figures under it so the state reads at a glance. */
export function ViewHeader({
  label,
  title,
  description,
  actions,
  stats,
}: {
  label: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  stats?: { value: ReactNode; label: string }[];
}) {
  return (
    <header className="pb-6 pt-6 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="type-label">{label}</p>
          <h1 className="type-heading mt-2">{title}</h1>
          <p className="mt-3 text-[0.9375rem] leading-[1.5] text-zinc-500">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {stats?.length ? (
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-white px-5 py-4">
              <dd className="font-display text-[1.75rem] leading-none text-zinc-900 tabular-nums">{s.value}</dd>
              <dt className="mt-1.5 text-[0.8125rem] text-zinc-500">{s.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

/** A friendly "nothing here" block: an icon, a line, and what to do about it. */
export function ViewEmpty({
  icon,
  title,
  body,
  tone = "zinc",
  children,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  tone?: "zinc" | "go";
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center">
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
          tone === "go"
            ? "bg-[rgb(var(--c-go-50))] text-[rgb(var(--c-go-500))] ring-1 ring-inset ring-[rgb(var(--c-go-300))]"
            : "bg-zinc-100 text-zinc-600"
        }`}
      >
        {icon}
      </span>
      <p className="mt-4 text-[1rem] font-medium text-zinc-900">{title}</p>
      <p className="mt-1 max-w-md text-[0.875rem] leading-[1.5] text-zinc-500">{body}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
