"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Ink terminal — the one dark surface the docs are allowed.
 *
 *  Steep keeps ink for text and filled actions, but a shell has to read as a
 *  shell: light-on-dark, monospace, and a prompt. The colouring stays achromatic
 *  (white command, slate comments, smoke output) so it doesn't smuggle a syntax
 *  palette into a 97%-achromatic system.
 */
export type Line =
  /** A command: gets the `$` prompt. */
  | { kind: "cmd"; text: string }
  /** A continuation of the command above — indented, no second prompt. Lets a
   *  long curl wrap across lines instead of scrolling out of a narrow column. */
  | { kind: "cont"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "out"; text: string };

export function Terminal({
  title,
  lines,
  className = "",
}: {
  title?: string;
  lines: Line[];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Copy the commands only — nobody wants the prompts or the sample output.
  // Commands and their continuations, so a wrapped curl copies as one runnable
  // block. Prompts and sample output are left behind.
  const copyable = lines
    .filter((l) => l.kind === "cmd" || l.kind === "cont")
    .map((l) => (l.kind === "cont" ? "  " + l.text : l.text))
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyable);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the text is selectable anyway */
    }
  };

  return (
    <div className={`overflow-hidden rounded-xl bg-ink ${className}`}>
      <div className="flex items-center gap-2 border-b border-paper/10 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-paper/20" />
          <span className="h-2 w-2 rounded-full bg-paper/20" />
          <span className="h-2 w-2 rounded-full bg-paper/20" />
        </span>
        {title ? (
          <span className="ml-1 font-mono text-[0.75rem] text-paper/55">{title}</span>
        ) : null}
        {copyable ? (
          <button
            onClick={() => void copy()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.6875rem] text-paper/55 transition-colors hover:bg-paper/10 hover:text-paper"
            aria-label="Copy commands"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy"}
          </button>
        ) : null}
      </div>
      <pre className="thin-scroll overflow-x-auto px-4 py-3.5 font-mono text-[0.8125rem] leading-[1.7]">
        <code>
          {lines.map((l, i) =>
            l.kind === "cmd" ? (
              <span key={i} className="block text-paper">
                <span className="select-none text-paper/40">$ </span>
                {l.text}
              </span>
            ) : l.kind === "cont" ? (
              <span key={i} className="block pl-4 text-paper">
                {l.text}
              </span>
            ) : l.kind === "comment" ? (
              <span key={i} className="block text-paper/40">
                {l.text}
              </span>
            ) : (
              <span key={i} className="block text-paper/60">
                {l.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  );
}

const METHOD_WIDTH = "w-[3.75rem]";

/** An endpoint row: method, path, one line of prose. Reads as a reference table
 *  without becoming a table — hairlines and monospace do the work. */
export function Endpoint({
  method,
  path,
  children,
}: {
  method: string;
  path: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-zinc-200 py-3">
      <span
        className={`${METHOD_WIDTH} shrink-0 font-mono text-[0.75rem] uppercase tracking-wide text-zinc-500`}
      >
        {method}
      </span>
      <code className="font-mono text-[0.875rem] text-zinc-900">{path}</code>
      {children ? (
        <span className="w-full text-[0.9375rem] text-zinc-600 sm:ml-auto sm:w-auto sm:text-right">
          {children}
        </span>
      ) : null}
    </div>
  );
}
