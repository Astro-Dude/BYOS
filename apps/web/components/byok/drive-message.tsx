"use client";

import { ChevronRight, FileText, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MD_CLASS, splitThought } from "@/components/dashboard/chat-format";

export type Source = { id: string; name: string };
type Step = { label: string; detail: string };

/** Pull control events (`\x1e{json}\n`) out of the stream wherever they appear —
 *  steps come before the answer, the sources event after it — and treat the
 *  remaining text as the answer. */
function parseStream(content: string): {
  steps: Step[];
  sources: Source[];
  answer: string;
  error?: string;
} {
  const steps: Step[] = [];
  let sources: Source[] = [];
  let error: string | undefined;
  let answer = "";
  let i = 0;
  while (i < content.length) {
    if (content[i] === "\x1e") {
      const nl = content.indexOf("\n", i);
      if (nl === -1) break; // trailing event still arriving
      try {
        const evt = JSON.parse(content.slice(i + 1, nl));
        if (evt.kind === "step") steps.push({ label: evt.label, detail: evt.detail ?? "" });
        else if (evt.kind === "sources") sources = evt.sources ?? [];
        else if (evt.kind === "error") error = evt.detail;
      } catch {
        /* ignore a malformed event */
      }
      i = nl + 1;
    } else {
      const next = content.indexOf("\x1e", i);
      const end = next === -1 ? content.length : next;
      answer += content.slice(i, end);
      i = end;
    }
  }
  return { steps, sources, answer, error };
}

/** Reveal `target` progressively for a typing feel. When disabled (history/
 *  restored messages) the full text shows immediately. Keeps up with fast
 *  streams by stepping proportionally to how far behind it is. */
function useTypewriter(target: string, enabled: boolean): string {
  const [len, setLen] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const tick = () => {
      let done = false;
      setLen((l) => {
        if (l >= target.length) {
          done = true;
          return l;
        }
        return Math.min(target.length, l + Math.max(1, Math.floor((target.length - l) / 18)));
      });
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, target]);
  return enabled ? target.slice(0, len) : target;
}

function Disclosure({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-zinc-400 transition hover:text-zinc-200"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {icon}
        {label}
      </button>
      {open ? <div className="mt-1 border-l-2 border-white/10 pl-2.5">{children}</div> : null}
    </div>
  );
}

/** A drive-chat assistant message: a live "How I searched" disclosure, the
 *  model's collapsible thought, the answer typed out as markdown, and clickable
 *  source chips beneath it. */
export function DriveMessage({
  content,
  busy,
  animate,
  onOpenFile,
}: {
  content: string;
  busy: boolean;
  animate: boolean;
  onOpenFile: (source: Source) => void;
}) {
  const { steps, sources, answer: body, error } = parseStream(content);
  const typed = useTypewriter(body, animate);
  const { thought, answer, thinking } = splitThought(typed);
  const [openThought, setOpenThought] = useState(false);
  const showThought = !!thought && (thinking || openThought);
  const stillTyping = animate && typed.length < body.length;
  const waiting = !body && !error && busy;

  return (
    <div className="max-w-[85%] rounded-2xl bg-white/[0.06] px-3 py-2 text-sm text-zinc-100">
      {steps.length ? (
        <Disclosure icon={<Sparkles className="h-3 w-3" />} label="How I searched">
          <ol className="space-y-1 text-xs text-zinc-400">
            {steps.map((st, i) => (
              <li key={i}>
                <span className="text-zinc-300">{st.label}</span>
                {st.detail ? <span className="text-zinc-500"> — “{st.detail}”</span> : null}
              </li>
            ))}
          </ol>
        </Disclosure>
      ) : null}

      {thought ? (
        <div className="mb-1">
          <button
            onClick={() => setOpenThought((v) => !v)}
            className="flex items-center gap-1 text-xs text-zinc-400 transition hover:text-zinc-200"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${showThought ? "rotate-90" : ""}`}
            />
            {thinking ? "Thinking…" : "Thoughts"}
          </button>
          {showThought ? (
            <div className="mt-1 whitespace-pre-wrap border-l-2 border-white/10 pl-2.5 text-xs text-zinc-400">
              {thought}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {answer ? (
        <div className={MD_CLASS}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
          {stillTyping ? (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-indigo-400 align-middle" />
          ) : null}
        </div>
      ) : waiting ? (
        <span className="inline-block h-3.5 w-1.5 animate-pulse bg-indigo-400 align-middle" />
      ) : null}

      {sources.length ? (
        <div className="mt-2.5 border-t border-white/10 pt-2">
          <p className="mb-1 text-[0.65rem] uppercase tracking-wide text-zinc-500">Sources</p>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenFile(s)}
                title={`Open ${s.name}`}
                className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 transition hover:border-indigo-400/40 hover:bg-white/10 hover:text-zinc-100"
              >
                <FileText className="h-3 w-3 shrink-0 text-indigo-400" />
                <span className="max-w-[12rem] truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
