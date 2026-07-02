/** BYOS logo — geometric "B" monogram + wordmark. The mark strokes use
 *  currentColor, so it inherits whatever text color it's placed in (theme teal
 *  by default). Set `markOnly` for a favicon-style square mark. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/byos-logo.png" alt="BYOS" className={`${className} object-contain`} />;
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
