"use client";

import { useEffect, useRef, useState } from "react";

const GRID_BASE =
  "linear-gradient(to right, rgba(113,113,122,0.15) 1px, transparent 1px)," +
  "linear-gradient(to bottom, rgba(113,113,122,0.15) 1px, transparent 1px)";
const GRID_GLOW =
  "linear-gradient(to right, rgba(74,129,119,0.55) 1px, transparent 1px)," +
  "linear-gradient(to bottom, rgba(74,129,119,0.55) 1px, transparent 1px)";
const CURSOR_MASK =
  "radial-gradient(220px circle at var(--mx, 50%) var(--my, -120px), " +
  "#000 0%, rgba(0,0,0,0.35) 45%, transparent 72%)";

/** Cinematic wordmark splash: the word eases in with its full form below, then
 *  dissolves. Used as the BYOK intro (skippable, timed) and the BYOS boot splash
 *  (not skippable — stays until `ready`, masking the initial load).
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
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-white dark:bg-black transition-all duration-700 ${
        skippable ? "cursor-pointer" : ""
      } ${leaving ? "scale-110 opacity-0" : "opacity-100"}`}
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
      <div
        className="pointer-events-none absolute h-[36rem] w-[36rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(74,129,119,0.35), transparent 68%)" }}
      />
      <h1 className="animate-byok-zoom relative z-10 font-brand text-6xl font-bold tracking-[0.3em] text-zinc-900 dark:text-white sm:text-8xl">
        {word}
      </h1>
      <p className="animate-byok-fade-up relative z-10 mt-5 text-[0.7rem] uppercase tracking-[0.45em] text-zinc-500 dark:text-zinc-400 sm:text-xs">
        {subtitle}
      </p>
      {skippable ? (
        <p className="absolute bottom-8 right-8 text-[0.65rem] uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-600">
          Press <span className="rounded border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5">Enter</span> to skip
        </p>
      ) : null}
    </div>
  );
}
