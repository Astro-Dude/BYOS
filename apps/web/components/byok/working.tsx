"use client";

import { useEffect, useState } from "react";

/** Rotating labels for a turn in progress. Drive-flavoured on purpose — the point
 *  is that the app is visibly doing something specific, not just "Loading…". */
const WORDS = [
  "Rummaging",
  "Sifting",
  "Leafing through",
  "Cross-checking",
  "Filing",
  "Untangling",
  "Cataloguing",
  "Skimming",
  "Alphabetising",
  "Joining dots",
  "Tidying up",
  "Second-guessing",
  "Sorting the pile",
  "Reading the fine print",
];

/** Labels shown while a specific tool is running, so the words track reality
 *  instead of drifting at random. */
const FOR_TOOL: Record<string, string> = {
  list_files: "Combing the drive",
  list_folders: "Mapping folders",
  list_tags: "Checking tags",
  find_duplicates: "Spotting duplicates",
  read_file_text: "Reading",
  search_content: "Searching inside files",
};

const PERIOD_MS = 2400;

export function Working({ step, className = "" }: { step?: string; className?: string }) {
  const [i, setI] = useState(0);

  // Rotate only while no tool is running — a real step name beats a random verb.
  useEffect(() => {
    if (step) return;
    const timer = setInterval(() => setI((n) => n + 1), PERIOD_MS);
    return () => clearInterval(timer);
  }, [step]);

  const label = (step && FOR_TOOL[step]) ?? WORDS[i % WORDS.length];

  return (
    <span className={`inline-flex items-center gap-2 text-[0.9375rem] text-zinc-600 ${className}`}>
      <span className="byok-word">{label}</span>
      <span className="inline-flex items-baseline gap-1" aria-hidden>
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="byok-dot inline-block h-[3px] w-[3px] rounded-full bg-zinc-900/50"
            style={{ animationDelay: `${d * 0.16}s` }}
          />
        ))}
      </span>
      <span className="sr-only">Working…</span>
    </span>
  );
}
