export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-200/80 dark:bg-zinc-800 ${className}`} />;
}
