import { ArrowRight, Check, Database, FileText, Link2, Loader2, Star } from "lucide-react";

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
  { name: "Payslip_Jun_2026.pdf", meta: "PDF · 240 KB", starred: true },
  { name: "Shaurya_resume.pdf", meta: "PDF · 90 KB", starred: false },
  { name: "Q3 Report.pdf", meta: "PDF · 1.2 MB", starred: true },
  { name: "holiday.jpg", meta: "JPG · 3.4 MB", starred: false },
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
      <p className="mt-3 font-display text-[1.375rem] tracking-[-0.009em]">byos.link/a/resume</p>
      <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3">
        <div className="flex items-center gap-2 text-[0.8125rem] text-zinc-500 line-through">
          <FileText className="h-3.5 w-3.5" /> resume_v1.pdf
        </div>
        <div className="flex items-center gap-2 text-[0.8125rem] text-zinc-900">
          <FileText className="h-3.5 w-3.5" /> resume_2026.pdf
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
      <p className="mt-2 truncate text-[0.8125rem] text-zinc-600">Payslip_Jun_2026.pdf</p>
    </Artifact>
  );
}

/** The AI composer — Steep names this component explicitly. */
export function ComposerArtifact({ className = "" }: { className?: string }) {
  return (
    <div className={`surface-artifact p-3 ${className}`}>
      <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
        <span className="flex-1 text-[0.9375rem] text-zinc-400">
          When does my lease end?
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900">
          <ArrowRight className="h-4 w-4 text-white" />
        </span>
      </div>
      <p className="px-2 pt-3 text-[0.9375rem] leading-[1.35] text-zinc-900">
        Your agreement runs to <mark>31 March 2027</mark>, with two months&apos; notice.
      </p>
      <div className="flex items-center gap-1.5 px-2 pt-2 text-[0.8125rem] text-zinc-500">
        <FileText className="h-3 w-3" /> Rental_Agreement_2025.pdf
      </div>
    </div>
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
      <svg viewBox="0 0 120 34" className="mt-3 h-9 w-full" aria-hidden>
        <path
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
