"use client";

import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Split streamed content into the model's inline reasoning (<think>/<thought>)
// and the actual answer. `thinking` is true while the thought is still open
// (mid-stream) — shown live, then collapsed once the answer starts.
export function splitThought(content: string): {
  thought: string;
  answer: string;
  thinking: boolean;
} {
  const closed = content.match(/<(think|thought)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (closed) {
    const answer = content
      .slice((closed.index ?? 0) + (closed[0]?.length ?? 0))
      .replace(/^\s+/, "");
    return { thought: (closed[2] ?? "").trim(), answer, thinking: false };
  }
  const open = content.match(/<(think|thought)\b[^>]*>([\s\S]*)$/i);
  if (open) return { thought: (open[2] ?? "").trim(), answer: "", thinking: true };
  return { thought: "", answer: content, thinking: false };
}

// Compact markdown styling for assistant bubbles (no typography plugin needed).
export const MD_CLASS =
  "text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_h1]:my-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-1 [&_h2]:text-base " +
  "[&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-base [&_h3]:font-semibold [&_strong]:font-semibold " +
  "[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 " +
  "[&_a]:underline [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 " +
  "dark:[&_pre]:bg-white/10";

/** An assistant message: collapsible "Thinking…" block + streamed markdown. */
export function AssistantBubble({
  content,
  busy,
  open,
  onToggle,
  className = "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100",
}: {
  content: string;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { thought, answer, thinking } = splitThought(content);
  const showThought = !!thought && (thinking || open);
  return (
    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${className}`}>
      {thought ? (
        <div className="mb-1">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${showThought ? "rotate-90" : ""}`}
            />
            {thinking ? "Thinking…" : "Thoughts"}
          </button>
          {showThought ? (
            <div className="mt-1 whitespace-pre-wrap border-l-2 border-zinc-200 pl-2 text-xs text-zinc-400 dark:border-zinc-700">
              {thought}
            </div>
          ) : null}
        </div>
      ) : null}
      {answer ? (
        <div className={MD_CLASS}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      ) : !thought && busy ? (
        "…"
      ) : null}
    </div>
  );
}
