"use client";

import {
  ApiError,
  type AnalyticsDayPoint,
  type AnalyticsOverview,
  type AnalyticsTopItem,
  type DuplicateGroup,
} from "@byos/api-client";
import { FileText, Globe, Link2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { BrandLoader } from "@/components/ui/brand-loader";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-zinc-400">{sub}</div> : null}
    </div>
  );
}

function ActivityChart({ points }: { points: AnalyticsDayPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No activity yet — views and downloads will show up here.
      </p>
    );
  }
  const max = Math.max(1, ...points.map((p) => p.views + p.downloads));
  return (
    <div>
      <div className="flex h-40 items-end gap-1 overflow-x-auto">
        {points.map((p) => {
          const total = p.views + p.downloads;
          const heightPct = (total / max) * 100;
          const dlPct = total ? (p.downloads / total) * 100 : 0;
          return (
            <div
              key={p.day}
              className="group flex min-w-[8px] flex-1 flex-col items-center justify-end"
              title={`${p.day} · ${p.views} views · ${p.downloads} downloads`}
            >
              <div
                className="flex w-full max-w-[24px] flex-col justify-end overflow-hidden rounded-t"
                style={{ height: `${Math.max(heightPct, 4)}%` }}
              >
                <div className="w-full bg-indigo-300" style={{ height: `${dlPct}%` }} />
                <div className="w-full flex-1 bg-indigo-400" />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-indigo-400" /> Views
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-indigo-300" /> Downloads
        </span>
      </div>
    </div>
  );
}

const TARGET_ICON: Record<string, ReactNode> = {
  file: <FileText className="h-4 w-4 text-zinc-500" />,
  alias: <Link2 className="h-4 w-4 text-zinc-500" />,
  share: <Globe className="h-4 w-4 text-zinc-500" />,
};

export function InsightsPanel() {
  const authed = useAuthed();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [series, setSeries] = useState<AnalyticsDayPoint[]>([]);
  const [top, setTop] = useState<AnalyticsTopItem[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, s, t, d] = await authed((token) =>
        Promise.all([
          api.getAnalyticsOverview(token),
          api.getAnalyticsTimeseries(token, 30),
          api.getAnalyticsTop(token, 8),
          api.listDuplicates(token),
        ]),
      );
      setOverview(o);
      setSeries(s);
      setTop(t);
      setDuplicates(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !overview) {
    return <BrandLoader className="py-24" label="Loading insights…" />;
  }
  if (error) {
    return <p className="py-10 text-center text-sm text-red-600">{error}</p>;
  }
  if (!overview) return null;

  return (
    <div className="space-y-6 pt-2">
      <h1 className="text-2xl font-normal text-zinc-800">Insights</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Storage used"
          value={formatBytes(overview.storage_bytes)}
          sub={`across ${overview.file_count.toLocaleString()} files · unlimited`}
        />
        <StatCard label="Files" value={overview.file_count.toLocaleString()} />
        <StatCard
          label="Views"
          value={overview.views_total.toLocaleString()}
          sub={`${overview.views_30d.toLocaleString()} in last 30d`}
        />
        <StatCard
          label="Downloads"
          value={overview.downloads_total.toLocaleString()}
          sub={`${overview.downloads_30d.toLocaleString()} in last 30d`}
        />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold text-zinc-900">Activity — last 30 days</h2>
        <div className="mt-4">
          <ActivityChart points={series} />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold text-zinc-900">Most accessed</h2>
        {top.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">Nothing accessed yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {top.map((item) => (
              <li
                key={`${item.target_type}:${item.target_id}`}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {TARGET_ICON[item.target_type] ?? <span aria-hidden>•</span>}
                  <span className="truncate text-sm text-zinc-800">{item.label}</span>
                </span>
                <span className="shrink-0 text-sm font-medium text-zinc-500">
                  {item.hits.toLocaleString()} hits
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold text-zinc-900">Duplicate files</h2>
        <p className="text-sm text-zinc-500">Files with identical content, grouped by hash.</p>
        {duplicates.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No duplicates found — nice and tidy.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {duplicates.map((group) => (
              <li key={group.hash} className="rounded-lg bg-zinc-50 p-3">
                <div className="mb-1 text-xs font-medium text-zinc-500">
                  {group.files.length} copies
                </div>
                <ul className="space-y-1">
                  {group.files.map((file) => (
                    <li key={file.id} className="flex items-center gap-2 text-sm text-zinc-700">
                      <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span className="truncate">{file.name}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
