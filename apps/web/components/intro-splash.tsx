"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const GRID_BASE =
  "linear-gradient(to right, var(--grid-line) 1px, transparent 1px)," +
  "linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)";
// Warms under the cursor — sienna on paper, blush on ink (see --grid-lit).
const GRID_GLOW =
  "linear-gradient(to right, var(--grid-lit) 1px, transparent 1px)," +
  "linear-gradient(to bottom, var(--grid-lit) 1px, transparent 1px)";
const CURSOR_MASK =
  "radial-gradient(220px circle at var(--mx, 50%) var(--my, -120px), " +
  "#000 0%, rgba(0,0,0,0.35) 45%, transparent 72%)";

/** Splashes already played in this page load. Kept on `window`, not in a
 *  module variable: dev re-evaluates page modules as routes compile, which reset
 *  a module flag and replayed the splash on every visit. A full reload clears it. */
function playedThisLoad(): Set<string> {
  const w = window as unknown as { __byosIntros?: Set<string> };
  return (w.__byosIntros ??= new Set());
}

/** Whether the `name` splash should play: on every full page load (a hard
 *  refresh or opening the URL), not when navigating inside the app. Marked once
 *  it has finished, so leaving mid-splash plays it again next time. */
export function useIntroOnce(name: string): [boolean, () => void] {
  // The server render always includes it; the set is empty on a full load, so
  // hydration agrees. Client navigations render fresh and read the set.
  const [show, setShow] = useState(
    () => typeof window === "undefined" || !playedThisLoad().has(name),
  );
  const finish = useCallback(() => {
    playedThisLoad().add(name);
    setShow(false);
  }, [name]);
  return [show, finish];
}

/** Cinematic wordmark splash: the word eases in with its full form below, then
 *  dissolves. Used as the BYOK intro and the BYOS boot splash, each on a full
 *  page load (`useIntroOnce`); both can be skipped with a click or Enter.
 *
 *  With `grid`, paints the BYOK grid wallpaper whose lines light up around the
 *  cursor — the /byok "world" feel, so the intro matches the page it opens.
 *
 *  Dissolves once BOTH a minimum on-screen time (`minMs`) has passed AND `ready`
 *  is true; then calls `onFinished` after the fade-out. */
export function IntroSplash({
  word,
  subtitle,
  skippable = false,
  grid = false,
  minMs = 1900,
  ready = true,
  onFinished,
}: {
  word: string;
  subtitle: string;
  skippable?: boolean;
  grid?: boolean;
  minMs?: number;
  ready?: boolean;
  onFinished: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [minElapsed, setMinElapsed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), minMs);
    return () => clearTimeout(t);
  }, [minMs]);

  useEffect(() => {
    if (minElapsed && ready) setLeaving(true);
  }, [minElapsed, ready]);

  useEffect(() => {
    if (!skippable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") setLeaving(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skippable]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onFinished, 700); // matches the dissolve transition
    return () => clearTimeout(t);
  }, [leaving, onFinished]);

  return (
    <div
      ref={rootRef}
      onClick={skippable ? () => setLeaving(true) : undefined}
      onMouseMove={
        grid
          ? (e) => {
              const el = rootRef.current;
              if (!el) return;
              el.style.setProperty("--mx", `${e.clientX}px`);
              el.style.setProperty("--my", `${e.clientY}px`);
            }
          : undefined
      }
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-white transition-all duration-700 ${
        skippable ? "cursor-pointer" : ""
      } ${leaving ? "scale-[1.04] opacity-0" : "opacity-100"}`}
    >
      {grid ? (
        <>
          <div
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: GRID_BASE, backgroundSize: "46px 46px" }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: GRID_GLOW,
              backgroundSize: "46px 46px",
              maskImage: CURSOR_MASK,
              WebkitMaskImage: CURSOR_MASK,
            }}
          />
        </>
      ) : null}
      {/* The blush wash — the system's single chromatic surface, spent here on
          the one hero moment rather than scattered as an accent. */}
      <div
        className="pointer-events-none absolute h-[34rem] w-[34rem] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--c-blush) / 0.85), transparent 70%)",
        }}
      />
      <h1 className="steep-settle relative z-10 font-display text-5xl font-normal text-zinc-900 sm:text-7xl">
        {word}
      </h1>
      <div
        aria-hidden
        className="steep-rule relative z-10 mt-6 h-px w-24 bg-zinc-900/25"
      />
      <p className="steep-rise relative z-10 mt-6 text-[0.9375rem] font-normal text-zinc-600">
        {subtitle}
      </p>
      {skippable ? (
        <p className="steep-rise absolute bottom-8 right-8 text-[0.8125rem] text-zinc-500">
          Press{" "}
          <span className="rounded-full border border-zinc-200 px-2 py-0.5">
            Enter
          </span>{" "}
          to skip
        </p>
      ) : null}
    </div>
  );
}
