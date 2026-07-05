import { LogoMark } from "@/components/logo";

/** On-brand loader: the BYOS monogram breathing inside a spinning ring. */
export function BrandLoader({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${className}`}>
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border border-zinc-200 border-t-indigo-600 [animation-duration:1.15s]" />
        <LogoMark className="h-8 w-8 animate-breathe" />
      </div>
      {label ? <p className="animate-pulse text-sm text-zinc-400">{label}</p> : null}
    </div>
  );
}
