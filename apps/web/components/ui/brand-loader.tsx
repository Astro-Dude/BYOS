"use client";

import { useEffect, useState } from "react";

/** Circular percentage loader. For data fetches (no real progress) it eases
 *  toward ~90% while mounted; matches the premium neutral + teal UI. */
export function BrandLoader({ label, className = "" }: { label?: string; className?: string }) {
  const [pct, setPct] = useState(6);

  useEffect(() => {
    const id = setInterval(() => {
      setPct((p) => (p >= 90 ? p : p + Math.max(0.6, (90 - p) * 0.08)));
    }, 150);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <PercentRing value={pct} />
      {label ? <p className="text-sm text-zinc-400">{label}</p> : null}
    </div>
  );
}

/** Presentational circular progress ring with a centered percentage. */
export function PercentRing({ value, size = 60 }: { value: number; size?: number }) {
  const stroke = 3;
  const radius = size / 2 - stroke * 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E9E7E1" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#3C6E66"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.2s ease" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-zinc-700">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
