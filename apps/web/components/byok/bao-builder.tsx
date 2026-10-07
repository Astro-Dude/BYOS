"use client";

import type { AgentMode } from "@byos/api-client";
import { type RefObject, useEffect, useRef, useState } from "react";

import { FileText, PencilLine, Sparkles } from "lucide-react";

import { stepLabel } from "@/lib/step-labels";
import { ModeAvatar } from "@/components/mode-avatar";

/** How each Bao works, matching what the mode may do: Bookish only looks
 *  (magnifier, slow), Butler notes proposals for approval (pencil and ticks),
 *  Busy builds (hammer, quick), Boss signs things off (stamp, brisk). `walk`
 *  is the stroll between rows, `stay` how long he spends at one. */
const PACE: Record<AgentMode, { walk: number; stay: number }> = {
  read_only: { walk: 1300, stay: 3600 },
  ask: { walk: 950, stay: 2800 },
  auto: { walk: 600, stay: 1700 },
  full: { walk: 700, stay: 2100 },
};

/** Bao at work on a plan, Clash-of-Clans-builder style: he walks onto the card,
 *  goes from row to row swinging a hammer (sparks, the row lit up under him),
 *  with what he's doing in a little speech bubble. When the new plan is ready
 *  he hops and cheers before it takes the card's place.
 *
 *  Rows are found in the card itself (`.plan-row` in the diagram, `li` in the
 *  list), re-measured on every move, so it follows the layout as it is. Sits on
 *  top with pointer events off; under reduced motion he just stands and works. */
export function BaoBuilder({
  mode,
  status,
  done,
  startedAt,
  onStop,
  areaRef,
  follow = "tour",
}: {
  mode: AgentMode;
  status: string;
  done: boolean;
  startedAt: number;
  onStop?: () => void;
  areaRef: RefObject<HTMLDivElement | null>;
  /** "tour": work across the rows (a plan being revised); "newest": go to the
   *  latest row each time (a reply being built). */
  follow?: "tour" | "newest";
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const [spot, setSpot] = useState<{ x: number; y: number; row: DOMRect | null } | null>(null);
  const [walking, setWalking] = useState(false);
  const [facingLeft, setFacingLeft] = useState(false);
  const lastX = useRef<number | null>(null);
  const lastY = useRef<number | null>(null);
  const step = useRef(0);
  const doneRef = useRef(done);
  doneRef.current = done; // once the plan is in, he stays put and cheers

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const move = () => {
      if (doneRef.current && lastX.current !== null) return; // done: stay put, but walk on first
      const box = area.getBoundingClientRect();
      // Single rows only: the diagram's lines, or the list's items when shown
      // as a list (a folder's <li> in the diagram wraps its whole subtree).
      const lines = area.querySelectorAll<HTMLElement>(".plan-row");
      // Each row with where its content actually ends, so he stands just after
      // the words instead of on top of them.
      const rows = [...(lines.length ? lines : area.querySelectorAll<HTMLElement>("ul > li"))]
        .map((el) => {
          const r = el.getBoundingClientRect();
          const ends = [...el.children].map((c) => c.getBoundingClientRect().right).filter((v) => v > 0);
          return { r, end: ends.length ? Math.max(...ends) : r.right };
        })
        .filter(({ r }) => r.height > 0 && r.top >= box.top && r.bottom <= box.bottom);
      // Work down the rows, skipping a few at a time so he covers the card.
      const target = !rows.length
        ? null
        : follow === "newest"
          ? rows[rows.length - 1]!
          : rows[(step.current * 3) % rows.length]!;
      step.current += 1;
      const size = 52;
      const x = target ? Math.min(target.end - box.left + 6, box.width - size - 4) : box.width - size - 12;
      // Level with the row (centred on it), so the rows around stay readable.
      const y = target ? target.r.top - box.top + target.r.height / 2 - size / 2 - 4 : 12;
      const row = target
        ? new DOMRect(
            target.r.left - box.left - 4,
            target.r.top - box.top,
            Math.max(24, target.end - target.r.left) + 8,
            target.r.height,
          )
        : null;
      // Same spot as before (the newest row hasn't changed): keep working
      // rather than walking on the spot.
      const moved = lastY.current === null || Math.hypot(x - (lastX.current ?? x), y - lastY.current) > 3;
      if (lastX.current !== null && moved) setFacingLeft(x < lastX.current);
      lastX.current = x;
      lastY.current = y;
      setSpot({ x, y, row });
      if (!still && moved) {
        setWalking(true);
        window.setTimeout(() => setWalking(false), PACE[mode].walk);
      }
    };

    // Walk in from just off the card's left edge.
    setSpot({ x: -56, y: 8, row: null });
    const first = window.setTimeout(move, 60);
    const pace = PACE[mode];
    const timer = still
      ? 0
      : window.setInterval(move, follow === "newest" ? pace.walk + 600 : pace.walk + pace.stay);
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [areaRef, follow, mode]);

  if (!spot) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      role="status"
      aria-live="polite"
    >
      {spot.row && !walking && !done ? (
        <div
          className={`bao-worksite bao-worksite-${mode} absolute rounded-md`}
          style={{ left: spot.row.x, top: spot.row.y, width: spot.row.width, height: spot.row.height }}
        />
      ) : null}
      <div
        className="bao-walker absolute left-0 top-0"
        style={{
          transform: `translate(${spot.x}px, ${spot.y}px)`,
          transitionDuration: `${PACE[mode].walk}ms`,
        }}
      >
        {/* What he's doing, like a builder's "upgrading" tag. */}
        <div
          className={
            follow === "newest"
              ? "absolute left-full top-1/2 ml-1 -translate-y-1/2" // beside him: rows above stay readable
              : "absolute bottom-full left-1/2 mb-1 -translate-x-1/2"
          }
        >
          <div className="bao-bubble pointer-events-auto flex max-w-[20rem] items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200 bg-white py-0.5 pl-2.5 pr-1 text-[0.6875rem] text-zinc-700 shadow-[var(--shadow-popover)]">
            <span className="min-w-0 truncate">{done ? "Done! Here's the new plan" : status}</span>
            {done ? null : (
              <>
                <span className="shrink-0 tabular-nums text-zinc-400">{elapsed}</span>
                {onStop ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="shrink-0 rounded-full px-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                    aria-label="Stop revising"
                  >
                    Stop
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
        {/* Facing and motion live on separate boxes: both use transform. */}
        <div style={{ transform: facingLeft ? "scaleX(-1)" : undefined }}>
          <div
            className={`relative h-[3.25rem] w-[3.25rem] ${walking ? "bao-walking" : done ? "bao-cheer" : "bao-working"}`}
          >
            <ModeAvatar mode={mode} live className="h-[3.25rem] w-[3.25rem]" />
            {!walking && !done ? <Tool mode={mode} /> : null}
            {done ? <Confetti /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** What Bao works the row with, by mode. */
function Tool({ mode }: { mode: AgentMode }) {
  if (mode === "read_only") return <Magnifier />;
  if (mode === "ask") return <Pencil />;
  if (mode === "full") return <Stamp />;
  return <Hammer />;
}

/** Bookish Bao: a magnifying glass sweeping along the row. Looks, never touches. */
function Magnifier() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="absolute -right-4 top-3 h-7 w-7 overflow-visible">
      <g className="bao-magnify">
        <circle
          cx="10"
          cy="10"
          r="6"
          strokeWidth="1.8"
          style={{ fill: "rgb(255 255 255 / 0.55)", stroke: "rgb(246 196 92)" }}
        />
        <path
          d="M7.5 8 q1.5 -2 4 -1.5"
          fill="none"
          strokeWidth="1"
          strokeLinecap="round"
          style={{ stroke: "white" }}
        />
        <path
          d="M14.5 14.5 L20 20"
          strokeWidth="2.6"
          strokeLinecap="round"
          style={{ stroke: "rgb(var(--c-blush-ink))" }}
        />
      </g>
    </svg>
  );
}

/** Butler Bao: a pencil tapping the row, and a green tick for "noted, for you to approve". */
function Pencil() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="absolute -right-3 top-4 h-6 w-6 overflow-visible">
      <g className="bao-pencil">
        <path
          d="M5 19 L16 8 L19 11 L8 22 Z"
          strokeWidth="1"
          strokeLinejoin="round"
          style={{ fill: "rgb(246 196 92)", stroke: "rgb(var(--c-blush-ink))" }}
        />
        <path d="M5 19 L4 23 L8 22 Z" style={{ fill: "rgb(var(--c-blush-ink))" }} />
        <path d="M16 8 L17.5 6.5 L20.5 9.5 L19 11 Z" style={{ fill: "rgb(var(--c-danger-500))" }} />
      </g>
      <g className="bao-tick">
        <circle
          cx="21"
          cy="21"
          r="4.2"
          style={{ fill: "rgb(var(--c-go-50))", stroke: "rgb(var(--c-go-500))" }}
          strokeWidth="1"
        />
        <path
          d="M19 21 l1.4 1.4 l2.6 -2.8"
          fill="none"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: "rgb(var(--c-go-500))" }}
        />
      </g>
    </svg>
  );
}

/** Boss Bao: a seal stamped down on the row with a thump. */
function Stamp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="absolute -right-4 top-2 h-7 w-7 overflow-visible">
      <g className="bao-stamp">
        <rect x="9" y="2" width="5" height="7" rx="2" style={{ fill: "rgb(var(--c-blush-ink))" }} />
        <rect x="5" y="9" width="13" height="4" rx="1" style={{ fill: "rgb(var(--c-danger-500))" }} />
      </g>
      <ellipse
        className="bao-thump"
        cx="11.5"
        cy="16"
        rx="8"
        ry="2.4"
        fill="none"
        strokeWidth="1.2"
        style={{ stroke: "rgb(var(--c-danger-500))" }}
      />
    </svg>
  );
}

/** Busy Bao: a little hammer swinging down onto the row, with sparks. */
function Hammer() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="absolute -right-3 top-4 h-6 w-6 overflow-visible">
      <g className="bao-hammer">
        <path
          d="M6 20 L14 9"
          strokeWidth="2.4"
          strokeLinecap="round"
          style={{ stroke: "rgb(var(--c-blush-ink))" }}
        />
        <rect
          x="11"
          y="4"
          width="9"
          height="5.5"
          rx="1.2"
          transform="rotate(35 15.5 6.75)"
          style={{ fill: "rgb(var(--c-400))", stroke: "rgb(var(--c-800))" }}
          strokeWidth="1"
        />
      </g>
      <g className="bao-sparks">
        <circle cx="20" cy="19" r="1.3" style={{ fill: "rgb(246 196 92)" }} />
        <circle cx="23" cy="15" r="1" style={{ fill: "rgb(246 196 92)" }} />
        <circle cx="17" cy="22" r="0.9" style={{ fill: "rgb(var(--c-danger-500))" }} />
      </g>
    </svg>
  );
}

function Confetti() {
  return (
    <svg
      viewBox="0 0 44 44"
      aria-hidden
      className="absolute -inset-3 h-[4.25rem] w-[4.25rem] overflow-visible"
    >
      {[
        [6, 8, "rgb(246 196 92)"],
        [38, 6, "rgb(var(--c-go-500))"],
        [2, 26, "rgb(var(--c-danger-500))"],
        [42, 28, "rgb(246 196 92)"],
        [22, 0, "rgb(var(--c-blush-mid))"],
      ].map(([x, y, c], i) => (
        <circle
          key={i}
          className="bao-confetti"
          cx={x as number}
          cy={y as number}
          r="1.8"
          style={{ fill: c as string, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </svg>
  );
}

type ProgressItem = { kind: "read" | "change" | "think"; text: string };

/** What a streaming agent reply has done so far, from its progress events: the
 *  rows Bao works on and the line in his bubble. */
export function progressOf(buffer: string): { status: string; items: ProgressItem[] } {
  const items: ProgressItem[] = [];
  let status = "On it…";
  for (const line of buffer.split("\n")) {
    if (!line.startsWith("\x1e")) {
      if (line.trim()) status = "Writing it up…";
      continue;
    }
    try {
      const evt = JSON.parse(line.slice(1));
      if (evt.kind === "step") {
        status = String(evt.detail || stepLabel(evt.label));
        items.push({ kind: "read", text: status });
      } else if (evt.kind === "thinking") {
        status = "Thinking…";
      } else if (evt.kind === "proposed") {
        status = `${evt.count} change${evt.count === 1 ? "" : "s"} · ${evt.label}`;
        items.push({ kind: "change", text: String(evt.label) });
      } else if (evt.kind === "plan") {
        status = "Putting the plan together…";
      }
    } catch {
      /* a partial line still arriving */
    }
  }
  if (status === "Thinking…" || status === "On it…") items.push({ kind: "think", text: status });
  return { status, items };
}

const ROWS_SHOWN = 4;

/** A reply under construction: the last few things Bao has done, as rows, with
 *  Bao walking to the newest and hammering it. Replaced by the answer as soon
 *  as it starts arriving. */
export function BaoWorksite({
  mode,
  buffer,
  startedAt,
  onStop,
}: {
  mode: AgentMode;
  buffer: string;
  startedAt: number;
  onStop?: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const { status, items } = progressOf(buffer);
  const shown = items.slice(-ROWS_SHOWN);
  return (
    <div ref={area} className="relative min-h-[6.5rem] w-[min(36rem,80vw)] pb-1 pt-2">
      <ul className="space-y-0.5 pr-4">
        {shown.map((it, i) => (
          <li
            key={`${items.length - shown.length + i}`}
            className={i === shown.length - 1 ? "" : "opacity-60"}
          >
            <span className="plan-row plan-node-in text-zinc-700">
              {it.kind === "read" ? (
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              ) : it.kind === "change" ? (
                <PencilLine className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              )}
              <span className="min-w-0 truncate">{it.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <BaoBuilder
        mode={mode}
        status={status}
        done={false}
        startedAt={startedAt}
        onStop={onStop}
        areaRef={area}
        follow="newest"
      />
    </div>
  );
}
