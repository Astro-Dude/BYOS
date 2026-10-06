import { Check, Database, FileText, Link2, Loader2, Star } from "lucide-react";

import { StorageIcon } from "@/components/storage-icon";

/** Steep's "floating product artifact": cropped fragments of the real product,
 *  on white, 20px radius, with the only genuine shadow in the system.
 *
 *  These are built as live markup rather than screenshots — the reference calls
 *  for cropped UI fragments, and real markup stays sharp at any density, respects
 *  the type scale, and can't drift out of date when the app changes.
 */
function Artifact({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`surface-artifact p-4 ${className}`}>{children}</div>;
}

const ROWS = [
  { name: "Lisbon_Boarding_Pass.pdf", meta: "PDF · 240 KB", starred: true, on: "telegram" },
  { name: "portfolio_2026.pdf", meta: "PDF · 90 KB", starred: false, on: "github" },
  { name: "Q3 Report.pdf", meta: "PDF · 1.2 MB", starred: true, on: "s3" },
  { name: "holiday.jpg", meta: "JPG · 3.4 MB", starred: false, on: "telegram" },
];

/** The Drive list — the app's densest surface, cropped to four rows. */
export function DriveArtifact({ className = "" }: { className?: string }) {
  return (
    <Artifact className={className}>
      <div className="flex items-baseline justify-between px-1 pb-3">
        <span className="font-display text-[1.0625rem]">My Drive</span>
        <span className="type-label">4 of 128</span>
      </div>
      <ul className="divide-y divide-zinc-200">
        {ROWS.map((r) => (
          <li key={r.name} className="flex items-center gap-3 px-1 py-2.5">
            <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-zinc-900">
              {r.name}
            </span>
            <span className="hidden shrink-0 text-[0.8125rem] text-zinc-500 sm:inline">
              {r.meta}
            </span>
            <StorageIcon provider={r.on} className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <Star
              className={`h-3.5 w-3.5 shrink-0 ${
 r.starred ? "fill-zinc-900 text-zinc-900" : "text-zinc-300"
              }`}
            />
          </li>
        ))}
      </ul>
    </Artifact>
  );
}

/** A permanent alias — the flagship feature, shown as the thing it produces. */
export function AliasArtifact({ className = "" }: { className?: string }) {
  return (
    <Artifact className={className}>
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-zinc-900" />
        <span className="type-label">Permanent link</span>
      </div>
      <p className="mt-3 font-display text-[1.375rem] tracking-[-0.009em]">byos.link/a/portfolio</p>
      <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3">
        <div className="flex items-center gap-2 text-[0.8125rem] text-zinc-500 line-through">
          <FileText className="h-3.5 w-3.5" /> portfolio_v1.pdf
        </div>
        <div className="flex items-center gap-2 text-[0.8125rem] text-zinc-900">
          <FileText className="h-3.5 w-3.5" /> portfolio_2026.pdf
          <Check className="ml-auto h-3.5 w-3.5" />
        </div>
      </div>
      <p className="mt-3 text-[0.8125rem] text-zinc-600">Same link. New file. Nobody re-shares.</p>
    </Artifact>
  );
}

/** The indexing card, mid-run — the app's actual progress surface. */
export function IndexingArtifact({ className = "" }: { className?: string }) {
  return (
    <Artifact className={className}>
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-900" />
        <span className="flex-1 text-[0.9375rem] text-zinc-900">Indexing 34 of 128</span>
      </div>
      <div className="relative mt-3 h-px overflow-hidden bg-zinc-200">
        <div className="h-full bg-zinc-900" style={{ width: "27%" }} />
      </div>
      <p className="mt-2 truncate text-[0.8125rem] text-zinc-600">Banana_bread.docx</p>
    </Artifact>
  );
}

/** Stat card with a gestural line — no axes, no gridlines, sienna stroke. */
export function StatArtifact({ className = "" }: { className?: string }) {
  return (
    <Artifact className={className}>
      <div className="flex items-center gap-2">
        <Database className="h-3.5 w-3.5 text-zinc-500" />
        <span className="type-label">Indexed</span>
      </div>
      <p className="mt-2 text-[1.25rem] font-medium text-zinc-900">128 files</p>
      <p className="text-[0.8125rem] text-zinc-600">↑ 5.5× vs last week</p>
      {/* Stretched to the card's width: a wide card used to show the line as a
          small squiggle in the middle. */}
      <svg viewBox="0 0 120 34" preserveAspectRatio="none" className="mt-3 h-12 w-full" aria-hidden>
        <path
          vectorEffect="non-scaling-stroke"
          d="M2 30 C 18 28, 26 20, 38 21 S 58 12, 72 14 S 96 5, 118 3"
          fill="none"
          stroke="var(--ink-on-blush)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </Artifact>
  );
}

const STORES = [
  { provider: "telegram", name: "Telegram", where: "Saved Messages", used: 61 },
  { provider: "github", name: "GitHub", where: "you/byos-storage", used: 24 },
  { provider: "s3", name: "S3", where: "r2 · my-archive", used: 15 },
];

/** The sidebar's storage card: one drive, several places its bytes live. */
export function StorageArtifact({ className = "" }: { className?: string }) {
  return (
    <Artifact className={className}>
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[0.9375rem] text-zinc-900">
          48.2 GB <span className="text-zinc-500">across 3 storages</span>
        </span>
        <span className="type-label">Default: Telegram</span>
      </div>
      <div className="mx-1 mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {STORES.map((s, i) => (
          <span
            key={s.provider}
            className="h-full rounded-full"
            style={{ width: `${s.used}%`, background: ["rgb(var(--c-900))", "rgb(var(--c-500))", "var(--ink-on-blush)"][i] }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1">
        {STORES.map((s) => (
          <li key={s.provider} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
              <StorageIcon provider={s.provider} className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] text-zinc-900">{s.name}</span>
              <span className="block truncate text-[0.8125rem] text-zinc-500">{s.where}</span>
            </span>
            <span className="shrink-0 text-[0.8125rem] tabular-nums text-zinc-500">{s.used}%</span>
          </li>
        ))}
      </ul>
    </Artifact>
  );
}
