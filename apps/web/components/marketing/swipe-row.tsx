"use client";

import { Children, type ReactNode, useEffect, useRef, useState } from "react";

/** A row of cards you swipe through on a phone, and a plain grid from tablet
 *  width up (`grid` holds the md+ column classes, e.g. "md:grid-cols-3").
 *
 *  On phones each card takes most of the width so the next one peeks in from
 *  the edge, cards snap into place, and dots under the row say where you are
 *  (tap one to jump). The row bleeds to the screen edges so the peek reaches
 *  them, while the first card still lines up with the page's text. */
export function SwipeRow({
  children,
  grid,
  className = "",
  label,
}: {
  children: ReactNode;
  grid: string;
  className?: string;
  /** What the row holds, for screen readers ("Storage options"). */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = Children.count(children);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) return;
      const step = first.offsetWidth + 16; // card + gap-4
      setActive(Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / step))));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [count]);

  const go = (i: number) => {
    const el = ref.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft), behavior: "smooth" });
  };

  return (
    // min-w-0: inside a grid or flex column the row would otherwise widen the
    // column to fit every card side by side, and push the page past the screen.
    <div className={`min-w-0 ${className}`}>
      <div
        ref={ref}
        role="region"
        aria-label={label}
        className={`no-scrollbar -mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-6 px-6 pb-1 sm:-mx-10 sm:scroll-px-10 sm:px-10 md:mx-0 md:grid md:snap-none md:overflow-visible md:px-0 md:pb-0 [&>*]:w-[84%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-[62%] md:[&>*]:w-auto ${grid}`}
      >
        {children}
      </div>
      {count > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-1.5 md:hidden" aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              onClick={() => go(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? "w-5 bg-zinc-900" : "w-1.5 bg-zinc-300"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
