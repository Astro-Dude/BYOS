"use client";

import { useEffect, useState } from "react";

/** Line percentage loader. For data fetches (no real progress) it eases toward
 *  ~90% while mounted; matches the premium neutral + teal UI. */
export function BrandLoader({ label, className = "" }: { label?: string; className?: string }) {
  const [pct, setPct] = useState(6);

  useEffect(() => {
    const id = setInterval(() => {
      setPct((p) => (p >= 90 ? p : p + Math.max(0.6, (90 - p) * 0.08)));
    }, 150);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="w-56 max-w-[70vw]">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{label ?? "Loading"}</span>
          <span className="tabular-nums text-zinc-400">{Math.round(pct)}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
