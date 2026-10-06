"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { usePreferences } from "@/lib/preferences";

/** The landing page's light/dark switch. The knob slides across with a little
 *  spring, the sun turns into a moon, and a few stars come out on the track.
 *
 *  It shows whichever theme is on screen (light by default); flipping it picks
 *  Light or Dark, the same setting as Settings → Appearance → Theme, saved on
 *  this device. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { setPrefs, ready } = usePreferences();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const read = () => setDark(document.documentElement.dataset.theme === "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light" : "Switch to dark"}
      onClick={() => {
        const next = !dark;
        const html = document.documentElement;
        // Flip the knob and the page in one go. Where the browser has view
        // transitions, the page cross-fades on the GPU and the knob slides
        // between its two places; elsewhere the knob's own CSS transition runs
        // and the page changes at once (animating every colour on the page is
        // what made it stutter).
        const apply = () => {
          flushSync(() => setDark(next));
          html.dataset.theme = next ? "dark" : "light";
          setPrefs({ theme: next ? "dark" : "light" });
        };
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduced && typeof document.startViewTransition === "function") {
          html.classList.add("theme-vt");
          document.startViewTransition(apply).finished.finally(() => html.classList.remove("theme-vt"));
        } else {
          apply();
        }
      }}
      className={`theme-switch relative h-8 w-[3.75rem] shrink-0 rounded-full border border-zinc-200 bg-zinc-100 transition-colors duration-500 hover:border-zinc-400 ${
        ready ? "" : "opacity-0"
      } ${className}`}
      data-on={dark ? "" : undefined}
    >
      {/* Stars: out only at night. */}
      <span aria-hidden className="theme-switch-stars absolute inset-0">
        <span className="absolute left-[0.6rem] top-[0.45rem] h-[3px] w-[3px] rounded-full bg-zinc-900" />
        <span className="absolute left-[1.25rem] top-[1.15rem] h-[2px] w-[2px] rounded-full bg-zinc-900" />
        <span className="absolute left-[1.55rem] top-[0.55rem] h-[2px] w-[2px] rounded-full bg-zinc-900" />
      </span>
      {/* The knob, carrying a sun that turns into a moon. */}
      <span
        aria-hidden
        className="theme-switch-knob absolute left-[3px] top-[3px] flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--c-paper))] text-zinc-900 shadow-[0_1px_3px_rgb(0_0_0/0.18)]"
      >
        <Sun className="theme-switch-sun absolute h-3.5 w-3.5" />
        <Moon className="theme-switch-moon absolute h-3.5 w-3.5" />
      </span>
    </button>
  );
}
