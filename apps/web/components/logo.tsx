/** BYOS wordmark — text only.
 *
 *  The image mark is gone: Steep is a typographic system, and a raster logo sits
 *  awkwardly beside a display serif. The wordmark is set in the display face at
 *  weight 400 with tightened tracking, matching every other heading.
 *
 *  `markClassName` / `markOnly` are kept as accepted-and-ignored props so the
 *  five existing call sites don't all need editing; they're no-ops now.
 */
/** The square mark — used where the full wordmark won't fit: the collapsed rail,
 *  the username screen.
 *
 *  An ink tile with the serif B reversed out of it. DESIGN.md lists Ink Black for
 *  "primary text, filled button background, nav logo", so a filled mark is
 *  on-system here even though nothing else in the rail is filled; it gives the
 *  collapsed rail an anchor. The letterform is the display serif, so the mark and
 *  the wordmark are visibly the same identity.
 */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-zinc-900 font-display text-[1.0625rem] font-normal leading-none text-white ${className}`}
      aria-label="BYOS"
      title="BYOS"
    >
      B
    </span>
  );
}

export function Logo({
  className = "",
  wordClassName = "text-2xl",
  markOnly = false,
}: {
  className?: string;
  /** No-op — retained so existing call sites keep type-checking. */
  markClassName?: string;
  wordClassName?: string;
  markOnly?: boolean;
}) {
  if (markOnly) return <LogoMark className={className} />;
  return (
    <span
      className={`font-display font-normal tracking-[-0.015em] text-zinc-900 ${wordClassName} ${className}`}
    >
      BYOS
    </span>
  );
}
