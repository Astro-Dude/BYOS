"use client";

import { type ElementType, type ReactNode, useEffect, useRef, useState } from "react";

/** Reveals its children when they scroll into view.
 *
 *  The Steep entrance gestures (`steep-settle`, `steep-rise`) are CSS animations,
 *  which fire on mount — so on a long page everything below the fold would have
 *  finished animating before you ever got there. This gates the class on an
 *  IntersectionObserver so each block animates as it arrives.
 *
 *  Chosen over `animation-timeline: view()` deliberately: scroll-driven CSS
 *  animations still aren't in Safari, and this page is the first thing a visitor
 *  sees.
 */
export function Reveal({
  children,
  as: Tag = "div",
  animation = "steep-rise",
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  /** Any element — the wrapper is presentational, so the caller picks the tag
   *  that keeps the document outline correct (h2 for a section heading, li in a
   *  list, and so on). */
  as?: ElementType;
  animation?: "steep-rise" | "steep-settle" | "steep-rule";
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Already in view on load (the hero) — animate immediately.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`${shown ? animation : "opacity-0"} ${className}`}
      style={shown && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
