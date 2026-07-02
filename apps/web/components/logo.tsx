/** BYOS logo — geometric "B" monogram + wordmark. The mark strokes use
 *  currentColor, so it inherits whatever text color it's placed in (theme teal
 *  by default). Set `markOnly` for a favicon-style square mark. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      {/* rounded-square frame */}
      <rect x="3" y="3" width="42" height="42" rx="12" />
      {/* diagonal accent (top-left) */}
      <path d="M9.5 23 L14 17.5" />
      {/* stem */}
      <path d="M16 13 V35" />
      {/* top bowl — chamfered block */}
      <path d="M16 13 H26 L30 17 V20 L26 24 H16" />
      {/* bottom bowl — chamfered block */}
      <path d="M16 24 H28 L32 28 V31 L28 35 H16" />
    </svg>
  );
}

export function Logo({
  className = "text-indigo-700",
  markClassName = "h-8 w-8",
  wordClassName = "text-2xl",
  markOnly = false,
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
  markOnly?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <LogoMark className={markClassName} />
      {markOnly ? null : (
        <>
          <span className="h-6 w-px bg-current opacity-25" aria-hidden />
          <span className={`font-brand font-bold tracking-tight ${wordClassName}`}>BYOS</span>
        </>
      )}
    </span>
  );
}
