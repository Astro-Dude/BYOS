"use client";

import { useEffect, useRef, useState } from "react";

/** Charts for the admin dashboard.
 *
 *  Hand-drawn SVG rather than a charting library, for three reasons: the Steep
 *  reference specifies gestural marks with "no axes, no gridlines", which every
 *  library fights you on; the palette must come from the theme tokens rather than
 *  a library's defaults; and none of these shapes ships in a default chart kit.
 *
 *  All achromatic — ink on paper — with the blush pair as the single accent, and
 *  the same `steep-*` motion vocabulary as the rest of the app: marks draw
 *  themselves in rather than fading.
 */

const INK = "rgb(var(--c-900))";
const MUTED = "rgb(var(--c-500))";
const HAIR = "rgb(var(--c-200))";
const BLUSH = "var(--surface-blush)";
const BLUSH_INK = "var(--ink-on-blush)";

/** Each successive slice steps further from ink, so ordering reads without
 *  inventing a palette the system doesn't have. */
const shade = (i: number) => (i === 0 ? INK : `rgb(var(--c-900) / ${Math.max(0.1, 0.62 - i * 0.08)})`);

type Hover = { x: number; y: number; title: string; rows: { label: string; value: string }[] } | null;

/** The readout that follows the pointer.
 *
 *  One component for every chart so the shape of a hover is identical wherever
 *  you are. `pointer-events-none` matters: without it the card sits under the
 *  cursor and steals the very hover that produced it, which makes the whole
 *  thing flicker.
 */
function HoverCard({ hover }: { hover: Hover }) {
  if (!hover) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-white px-3 py-2"
      style={{ left: hover.x, top: hover.y - 10, boxShadow: "var(--shadow-popover)" }}
    >
      <p className="whitespace-nowrap text-[0.8125rem] text-zinc-900">{hover.title}</p>
      {hover.rows.map((r) => (
        <p key={r.label} className="whitespace-nowrap text-[0.8125rem] text-zinc-600">
          {r.label} <span className="tabular-nums text-zinc-900">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** "2026-08-12" → "12 Aug". The series is dense enough that the year is noise. */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })}`;
}

/* ── Ridgeline ───────────────────────────────────────────────────────────── */

/** Two overlapping hairline ridges — daily series as terrain, not bars.
 *  Overlaying rather than stacking is the point: you can see whether uploads
 *  follow signups at a glance. */
export function Ridgeline({
  series,
  height = 96,
}: {
  series: { label: string; points: { day: string; value: number }[]; accent?: boolean }[];
  height?: number;
}) {
  const W = 600;
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [at, setAt] = useState<number | null>(null);

  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const days = series[0]?.points ?? [];
  const yAt = (v: number) => height - (v / max) * (height - 10) - 2;

  const path = (points: { value: number }[]) => {
    const step = W / Math.max(1, points.length - 1);
    // Midpoint quadratics: soft without the overshoot a naive cubic gives on
    // spiky daily counts.
    return points
      .map((p, i) => {
        const x = i * step;
        if (i === 0) return `M ${x} ${yAt(p.value)}`;
        const px = (i - 1) * step;
        const mid = (px + x) / 2;
        const py = yAt(points[i - 1]!.value);
        return `Q ${mid} ${py} ${mid} ${(py + yAt(p.value)) / 2} T ${x} ${yAt(p.value)}`;
      })
      .join(" ");
  };

  /** Nearest day to the pointer. The SVG scales with `preserveAspectRatio="none"`,
   *  so pixel x maps linearly onto the index — no inverse transform needed. */
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || days.length === 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const i = Math.round(ratio * (days.length - 1));
    setAt(i);
    setHover({
      x: (i / Math.max(1, days.length - 1)) * box.width,
      y: box.height,
      title: shortDay(days[i]!.day),
      rows: series.map((sr) => ({ label: sr.label, value: String(sr.points[i]?.value ?? 0) })),
    });
  };

  const peak = days.reduce(
    (best, p, i) => {
      const total = series.reduce((n, sr) => Math.max(n, sr.points[i]?.value ?? 0), 0);
      return total > best.value ? { value: total, day: p.day } : best;
    },
    { value: 0, day: "" },
  );

  return (
    <div>
      <div
        ref={wrap}
        className="relative"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
          setAt(null);
        }}
      >
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" preserveAspectRatio="none">
          <line x1="0" y1={height - 1} x2={W} y2={height - 1} stroke={HAIR} strokeWidth="1" />
          {series.map((sr, i) => (
            <g key={sr.label}>
              <path
                d={`${path(sr.points)} L ${W} ${height} L 0 ${height} Z`}
                fill={sr.accent ? BLUSH : INK}
                opacity={sr.accent ? 0.55 : 0.06}
              />
              <path
                d={path(sr.points)}
                fill="none"
                stroke={sr.accent ? BLUSH_INK : INK}
                strokeWidth="1.5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="steep-draw"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            </g>
          ))}
          {/* Hover guide: a hairline through the day, plus a mark on each ridge. */}
          {at !== null ? (
            <g>
              <line
                x1={(at / Math.max(1, days.length - 1)) * W}
                y1="0"
                x2={(at / Math.max(1, days.length - 1)) * W}
                y2={height - 1}
                stroke={INK}
                strokeWidth="1"
                opacity="0.25"
                vectorEffect="non-scaling-stroke"
              />
              {series.map((sr) => (
                <circle
                  key={sr.label}
                  cx={(at / Math.max(1, days.length - 1)) * W}
                  cy={yAt(sr.points[at]?.value ?? 0)}
                  r="3"
                  fill={sr.accent ? BLUSH_INK : INK}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ) : null}
        </svg>
        <HoverCard hover={hover} />
      </div>

      {/* Axis labels. Only the ends and the peak are drawn: a 30-point series
          can't carry 30 labels, and the peak is the one value worth naming. */}
      <div className="mt-2 flex items-baseline justify-between text-[0.75rem] text-zinc-400">
        <span>{days[0] ? shortDay(days[0].day) : ""}</span>
        <span className="text-zinc-600">
          peak {peak.value}
          {peak.day ? ` · ${shortDay(peak.day)}` : ""}
        </span>
        <span>{days.at(-1) ? shortDay(days.at(-1)!.day) : ""}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        {series.map((sr) => (
          <span key={sr.label} className="flex items-center gap-2 text-[0.8125rem] text-zinc-600">
            <span
              className="h-[3px] w-5 rounded-full"
              style={{ background: sr.accent ? BLUSH_INK : INK }}
            />
            {sr.label}
            <span className="tabular-nums text-zinc-400">
              {sr.points.reduce((n, p) => n + p.value, 0)} total
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Radial clock ────────────────────────────────────────────────────────── */

/** Activity by hour as a 24-spoke polar plot. A clock is the honest shape for
 *  hour-of-day data: a bar chart implies a beginning and an end where the axis
 *  actually wraps around. */
export function RadialClock({ points }: { points: { hour: number; value: number }[] }) {
  const [hover, setHover] = useState<Hover>(null);
  // The viewBox has to leave room for the hour labels *outside* the outer ring.
  // At S=260 with labels at rMax+18 they sat at radius 126 of a 130 half-width,
  // so "00" at the top and "06" on the right were clipped by the edge.
  const S = 300;
  const c = S / 2;
  const rMin = 38;
  const rMax = 108;
  const rLabel = rMax + 22;
  const max = Math.max(1, ...points.map((p) => p.value));

  const total = points.reduce((n, p) => n + p.value, 0);
  const busiest = points.reduce((b, p) => (p.value > b.value ? p : b), points[0] ?? { hour: 0, value: 0 });

  return (
    <div className="relative">
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className="mx-auto w-full max-w-[17rem]"
      role="img"
      onMouseLeave={() => setHover(null)}
    >
      {[rMin, (rMin + rMax) / 2, rMax].map((r) => (
        <circle key={r} cx={c} cy={c} r={r} fill="none" stroke={HAIR} strokeWidth="1" />
      ))}
      {points.map((p) => {
        // -90° puts midnight at the top, like a clock face.
        const a = ((p.hour / 24) * 360 - 90) * (Math.PI / 180);
        const r = rMin + (p.value / max) * (rMax - rMin);
        const lit = p.value > 0;
        return (
          <g key={p.hour}>
            <line
              x1={c + Math.cos(a) * rMin}
              y1={c + Math.sin(a) * rMin}
              x2={c + Math.cos(a) * r}
              y2={c + Math.sin(a) * r}
              stroke={lit ? INK : HAIR}
              strokeWidth={lit ? 3.5 : 1}
              strokeLinecap="round"
              opacity={lit ? 0.85 : 1}
            />
            {lit ? (
              <circle cx={c + Math.cos(a) * r} cy={c + Math.sin(a) * r} r="2.5" fill={BLUSH_INK} />
            ) : null}
            {/* A wide transparent spoke is the hit target: a 3.5px line is
                almost impossible to hover, and a value of 0 has no line at all. */}
            <line
              x1={c + Math.cos(a) * rMin}
              y1={c + Math.sin(a) * rMin}
              x2={c + Math.cos(a) * rMax}
              y2={c + Math.sin(a) * rMax}
              stroke="transparent"
              strokeWidth="16"
              style={{ cursor: "default" }}
              onMouseEnter={(e) =>
                setHover({
                  // Positioned in element space, so the card tracks the spoke
                  // rather than the raw pointer — steadier on a thin target.
                  x: (e.currentTarget.ownerSVGElement?.clientWidth ?? S) *
                    ((c + Math.cos(a) * (r + 8)) / S),
                  y: (e.currentTarget.ownerSVGElement?.clientHeight ?? S) *
                    ((c + Math.sin(a) * (r + 8)) / S),
                  title: `${String(p.hour).padStart(2, "0")}:00 UTC`,
                  rows: [{ label: "actions", value: String(p.value) }],
                })
              }
            />
            {p.hour % 6 === 0 ? (
              <text
                x={c + Math.cos(a) * rLabel}
                y={c + Math.sin(a) * rLabel + 4}
                textAnchor="middle"
                fill={MUTED}
                style={{ fontSize: 10 }}
              >
                {String(p.hour).padStart(2, "0")}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
      <HoverCard hover={hover} />
      <p className="mt-3 text-center text-[0.8125rem] text-zinc-600">
        {total} action{total === 1 ? "" : "s"}
        {total > 0 ? (
          <>
            {" · busiest "}
            <span className="text-zinc-900">
              {String(busiest.hour).padStart(2, "0")}:00
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

/* ── Waffle ──────────────────────────────────────────────────────────────── */

/** 100 cells, one per percent. Makes "roughly two thirds" legible in a way a pie
 *  never does, and it degrades gracefully when one slice dominates. */
export function Waffle({ slices }: { slices: { ext: string; count: number }[] }) {
  const [hover, setHover] = useState<Hover>(null);
  const total = Math.max(1, slices.reduce((n, s) => n + s.count, 0));
  // Largest-remainder allocation so the cells sum to exactly 100 — flooring
  // alone leaves gaps and the grid looks broken.
  const cells = slices.map((s) => ({ ...s, exact: (s.count / total) * 100 })).map((s) => ({
    ...s,
    n: Math.floor(s.exact),
  }));
  let left = 100 - cells.reduce((n, s) => n + s.n, 0);
  [...cells]
    .sort((a, b) => (b.exact % 1) - (a.exact % 1))
    .forEach((s) => {
      if (left > 0) {
        s.n += 1;
        left -= 1;
      }
    });

  const flat: number[] = [];
  cells.forEach((s, si) => {
    for (let i = 0; i < s.n; i++) flat.push(si);
  });

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      {/* Capped: the cells are square, so an uncapped grid grows as tall as the
          card is wide — on a full-width three-column layout that made one
          panel twice the height of its neighbours. */}
      <div className="grid max-w-[15rem] grid-cols-10 gap-1">
        {flat.slice(0, 100).map((si, i) => (
          <span
            key={i}
            className="steep-rise aspect-square rounded-[3px]"
            style={{ background: shade(si), animationDelay: `${i * 6}ms` }}
            onMouseEnter={(e) => {
              const cell = cells[si];
              if (!cell) return;
              const box = e.currentTarget.getBoundingClientRect();
              const parent = e.currentTarget.parentElement!.parentElement!.getBoundingClientRect();
              setHover({
                x: box.left - parent.left + box.width / 2,
                y: box.top - parent.top,
                title: cell.ext,
                rows: [
                  { label: "files", value: String(cell.count) },
                  { label: "share", value: `${cell.n}%` },
                ],
              });
            }}
          />
        ))}
      </div>
      <HoverCard hover={hover} />
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {cells.map((s, i) => (
          <span key={s.ext} className="flex items-center gap-1.5 text-[0.8125rem] text-zinc-600">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: shade(i) }} />
            <span className="font-mono">{s.ext}</span>
            <span className="text-zinc-400">{s.n}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Lollipop ────────────────────────────────────────────────────────────── */

/** A stem and a dot. Bars at this scale are heavy furniture: the dot carries the
 *  value, the hairline carries the comparison. */
export function Lollipop({
  rows,
  format,
}: {
  rows: { label: string; value: number; sub?: string }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const [on, setOn] = useState<number | null>(null);
  return (
    <ul className="space-y-3.5" onMouseLeave={() => setOn(null)}>
      {rows.map((r, i) => (
        <li
          key={r.label + i}
          onMouseEnter={() => setOn(i)}
          className={`grid grid-cols-[6rem_1fr_auto] items-center gap-3 rounded-md transition-colors sm:grid-cols-[9rem_1fr_auto] ${
            on === i ? "bg-zinc-100" : ""
          }`}
        >
          <span className="truncate text-[0.9375rem] text-zinc-900">{r.label}</span>
          {/* Centring uses negative margins, not `-translate-*`: both animations
              below drive `transform`, and with `fill-mode: both` they overwrite
              any translate utility on the same element — which left the dot
              sitting off the line rather than centred on it. */}
          <span className="relative h-2.5">
            <span
              className="absolute left-0 w-full"
              style={{ background: HAIR, height: 1, top: "50%", marginTop: -0.5 }}
            />
            <span
              className="steep-grow absolute left-0"
              style={{
                background: INK,
                height: 1,
                top: "50%",
                marginTop: -0.5,
                width: `${(r.value / max) * 100}%`,
                animationDelay: `${i * 60}ms`,
              }}
            />
            <span
              className="steep-rise absolute rounded-full transition-[height,width,margin]"
              style={{
                background: INK,
                height: on === i ? 14 : 10,
                width: on === i ? 14 : 10,
                top: "50%",
                marginTop: on === i ? -7 : -5,
                left: `${(r.value / max) * 100}%`,
                marginLeft: on === i ? -7 : -5,
                animationDelay: `${i * 60 + 200}ms`,
              }}
            />
          </span>
          <span className="whitespace-nowrap text-right text-[0.8125rem] tabular-nums text-zinc-600">
            {format ? format(r.value) : r.value}
            {r.sub ? <span className="ml-2 text-zinc-400">{r.sub}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Bands ───────────────────────────────────────────────────────────────── */

/** Size distribution as proportional bands — reads as "where the mass sits".
 *  The last bucket takes the blush, because the biggest files are the ones worth
 *  noticing. */
export function Bands({ rows }: { rows: { bucket: string; count: number }[] }) {
  const total = Math.max(1, rows.reduce((n, r) => n + r.count, 0));
  const [on, setOn] = useState<number | null>(null);
  return (
    <ul className="space-y-2" onMouseLeave={() => setOn(null)}>
      {rows.map((r, i) => (
        <li
          key={r.bucket}
          onMouseEnter={() => setOn(i)}
          className="flex items-center gap-3"
        >
          <span className="w-[5.5rem] shrink-0 text-right text-[0.8125rem] text-zinc-500 sm:w-24">
            {r.bucket}
          </span>
          <span className="relative h-7 flex-1 overflow-hidden rounded-md bg-zinc-100">
            <span
              className="steep-grow absolute inset-y-0 left-0"
              style={{
                width: `${(r.count / total) * 100}%`,
                background: i === rows.length - 1 ? BLUSH : INK,
                opacity: i === rows.length - 1 ? 1 : 0.82,
                animationDelay: `${i * 70}ms`,
              }}
            />
          </span>
          {/* The share only appears on hover: showing both count and percent on
              every row doubles the numbers for no gain. */}
          <span className="w-20 shrink-0 text-[0.8125rem] tabular-nums text-zinc-600">
            {r.count}
            {on === i ? (
              <span className="ml-1.5 text-zinc-400">
                {Math.round((r.count / total) * 100)}%
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}


/* ── Step area ───────────────────────────────────────────────────────────── */

/** Cumulative totals as a stepped area. Stepped rather than smoothed on purpose:
 *  storage grows in discrete jumps when files land, and a curve would imply
 *  continuous growth that never happened. */
export function StepArea({
  points,
  format,
}: {
  points: { day: string; value: number }[];
  format: (n: number) => string;
}) {
  const W = 600;
  const H = 96;
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [at, setAt] = useState<number | null>(null);

  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 8) - 2;

  const d = points
    .map((p, i) => (i === 0 ? `M ${x(i)} ${y(p.value)}` : `L ${x(i)} ${y(points[i - 1]!.value)} L ${x(i)} ${y(p.value)}`))
    .join(" ");

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || !points.length) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const i = Math.round(ratio * (points.length - 1));
    setAt(i);
    setHover({
      x: (i / Math.max(1, points.length - 1)) * box.width,
      y: box.height,
      title: shortDay(points[i]!.day),
      rows: [{ label: "stored", value: format(points[i]!.value) }],
    });
  };

  const first = points[0]?.value ?? 0;
  const last = points.at(-1)?.value ?? 0;

  return (
    <div>
      <div
        ref={wrap}
        className="relative"
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
          setAt(null);
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
          <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke={HAIR} strokeWidth="1" />
          <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill={INK} opacity="0.07" />
          <path
            d={d}
            fill="none"
            stroke={INK}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            className="steep-draw"
          />
          {at !== null ? (
            <>
              <line
                x1={x(at)}
                y1="0"
                x2={x(at)}
                y2={H - 1}
                stroke={INK}
                strokeWidth="1"
                opacity="0.25"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={x(at)} cy={y(points[at]!.value)} r="3" fill={INK} />
            </>
          ) : null}
        </svg>
        <HoverCard hover={hover} />
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[0.75rem] text-zinc-400">
        <span>{points[0] ? shortDay(points[0].day) : ""}</span>
        <span className="text-zinc-600">
          +{format(Math.max(0, last - first))} this window
        </span>
        <span>{format(last)}</span>
      </div>
    </div>
  );
}

/* ── Punchcard ───────────────────────────────────────────────────────────── */

/** One dot per day, area proportional to the count. Reads as a rhythm — which
 *  days had anyone on the platform at all — where a bar chart of small integers
 *  is mostly whitespace. */
export function Punchcard({ points, unit }: { points: { day: string; value: number }[]; unit: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);
  // The biggest mark a single day can afford. Measured rather than assumed: at
  // 30 days on a phone each day gets ~12px, and a fixed 21px dot both overflows
  // its cell and drags the whole card wider than the viewport.
  const [cell, setCell] = useState(22);
  const max = Math.max(1, ...points.map((p) => p.value));

  useEffect(() => {
    const el = wrap.current;
    if (!el || !points.length) return;
    const measure = () => {
      const gaps = 3 * (points.length - 1);
      setCell(Math.max(5, (el.clientWidth - gaps) / points.length));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [points.length]);

  return (
    <div data-punchcard ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
      <div className="flex items-center gap-[3px]">
        {points.map((p, i) => {
          const quiet = p.value === 0;
          // Area, not diameter, tracks the value — diameter exaggerates.
          const size = Math.min(cell, quiet ? 7 : 7 + Math.sqrt(p.value / max) * 14);
          return (
            <span key={p.day} className="flex h-10 flex-1 items-center justify-center">
              <span
                className="steep-rise rounded-full"
                style={{
                  width: size,
                  height: size,
                  // A quiet day is a ring, not a faint dot: an empty mark reads
                  // as "nobody came" where a pale filled one reads as "a few".
                  background: quiet ? "transparent" : INK,
                  // Smoke, not hairline: the panel's own fill is c-100, so a
                  // c-200/300 ring all but disappears and a quiet day reads as
                  // missing data rather than as nobody turning up.
                  border: quiet ? "1px solid rgb(var(--c-400))" : undefined,
                  opacity: quiet ? 1 : 0.32 + (p.value / max) * 0.68,
                  animationDelay: `${i * 14}ms`,
                }}
                onMouseEnter={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  const root = e.currentTarget.closest("[data-punchcard]")?.getBoundingClientRect();
                  if (!root) return;
                  setHover({
                    x: box.left - root.left + box.width / 2,
                    y: box.top - root.top,
                    title: shortDay(p.day),
                    rows: [{ label: unit, value: String(p.value) }],
                  });
                }}
              />
            </span>
          );
        })}
      </div>
      <HoverCard hover={hover} />
      <div className="mt-1 flex items-baseline justify-between text-[0.75rem] text-zinc-400">
        <span>{points[0] ? shortDay(points[0].day) : ""}</span>
        <span className="text-zinc-600">peak {max}</span>
        <span>{points.at(-1) ? shortDay(points.at(-1)!.day) : ""}</span>
      </div>
    </div>
  );
}

/* ── Stacked pill ────────────────────────────────────────────────────────── */

/** Composition as one rounded bar. For three-to-five categories this beats both
 *  a pie (no angles to misjudge) and separate bars (the whole is the point). */
export function StackedPill({ rows }: { rows: { label: string; count: number }[] }) {
  const total = Math.max(1, rows.reduce((n, r) => n + r.count, 0));
  const [on, setOn] = useState<number | null>(null);

  return (
    <div>
      <div className="flex h-9 gap-1 overflow-hidden" onMouseLeave={() => setOn(null)}>
        {rows.map((r, i) => (
          <span
            key={r.label}
            onMouseEnter={() => setOn(i)}
            className="steep-grow first:rounded-l-full last:rounded-r-full"
            style={{
              flex: `${Math.max(r.count, 0.001)} 0 0`,
              background: shade(i),
              opacity: on === null || on === i ? 1 : 0.45,
              transition: "opacity 150ms",
              animationDelay: `${i * 80}ms`,
            }}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((r, i) => (
          <span
            key={r.label}
            onMouseEnter={() => setOn(i)}
            onMouseLeave={() => setOn(null)}
            className="flex items-center gap-1.5 text-[0.8125rem] text-zinc-600"
          >
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: shade(i) }} />
            {r.label}
            <span className="tabular-nums text-zinc-400">
              {r.count} · {Math.round((r.count / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Arc gauge ───────────────────────────────────────────────────────────── */

/** A single ratio as a 270° arc. Used where the interesting fact is "how far
 *  along", not the absolute pair — an arc makes the remaining gap visible in a
 *  way two numbers don't. */
export function ArcGauge({
  value,
  of,
  label,
}: {
  value: number;
  of: number;
  label: string;
}) {
  const S = 200;
  const c = S / 2;
  const r = 74;
  // The sweep opens at the bottom, so the lowest ink sits at y ≈ 157 — cropping
  // the viewBox there stops a third of the box being empty above the caption.
  const H = 164;
  const pct = of > 0 ? Math.min(1, value / of) : 0;
  // 270° sweep starting bottom-left, so the gap sits at the bottom where the
  // caption goes.
  const start = 135;
  const sweep = 270;
  const point = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };
  const arc = (fromPct: number, toPct: number) => {
    const [x1, y1] = point(start + sweep * fromPct);
    const [x2, y2] = point(start + sweep * toPct);
    const large = sweep * (toPct - fromPct) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${S} ${H}`} className="mx-auto w-full max-w-[13rem]" role="img">
        <path d={arc(0, 1)} fill="none" stroke={HAIR} strokeWidth="10" strokeLinecap="round" />
        {pct > 0 ? (
          <path
            d={arc(0, pct)}
            fill="none"
            stroke={INK}
            strokeWidth="10"
            strokeLinecap="round"
            className="steep-draw"
          />
        ) : null}
        <text x={c} y={c + 2} textAnchor="middle" fill={INK} style={{ fontSize: 30 }}>
          {Math.round(pct * 100)}%
        </text>
        <text x={c} y={c + 24} textAnchor="middle" fill={MUTED} style={{ fontSize: 11 }}>
          {value} / {of}
        </text>
      </svg>
      <p className="mt-1 text-center text-[0.8125rem] text-zinc-600">{label}</p>
    </div>
  );
}

/* ── Tag cloud ───────────────────────────────────────────────────────────── */

/** Type-scaled tags. In a system this typographic, size *is* the chart — and it
 *  handles a long tail of one-off tags without a legend. */
export function TagCloud({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const min = Math.min(...rows.map((r) => r.count), 0);
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
      {rows.map((r, i) => {
        const t = max === min ? 1 : (r.count - min) / (max - min);
        return (
          <span
            key={r.label}
            className="steep-rise"
            style={{
              fontSize: `${0.9375 + t * 1.1}rem`,
              color: `rgb(var(--c-900) / ${0.45 + t * 0.55})`,
              animationDelay: `${i * 40}ms`,
            }}
            title={`${r.count} file${r.count === 1 ? "" : "s"}`}
          >
            {r.label}
            <span className="ml-1 align-super text-[0.6875rem] text-zinc-400">{r.count}</span>
          </span>
        );
      })}
    </div>
  );
}
