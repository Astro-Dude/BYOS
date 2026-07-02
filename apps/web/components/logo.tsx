/** BYOS logo — geometric "B" monogram + wordmark. The mark strokes use
 *  currentColor, so it inherits whatever text color it's placed in (theme teal
 *  by default). Set `markOnly` for a favicon-style square mark. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={18}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* outer frame */}
      <rect x="58" y="58" width="396" height="396" rx="56" />
      {/* diagonal accent */}
      <path d="M150 145 L205 90" />
      {/* top module */}
      <path d="M185 145 L315 145 L365 195 L315 245 L220 245 L185 280 L185 145 Z" />
      {/* lower module */}
      <path d="M220 280 L320 280 L355 315 L355 365 L315 405 L185 405 L185 330 L220 295 Z" />
      {/* inner cut top */}
      <path d="M230 190 L300 190 L325 215 L300 240 L230 240" />
      {/* inner cut bottom */}
      <path d="M230 325 L300 325 L325 350 L300 375 L230 375" />
    </svg>
  );
}

export function Logo({
  className = "text-indigo-600",
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
