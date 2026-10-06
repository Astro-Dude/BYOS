"use client";

import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Working } from "@/components/byok/working";

// Split streamed content into the model's inline reasoning (<think>/<thought>)
// and the actual answer. `thinking` is true while the thought is still open
// (mid-stream) — shown live, then collapsed once the answer starts.
export function splitThought(content: string): {
  thought: string;
  answer: string;
  thinking: boolean;
  /** "reasoning" is working the user asked to see (Show reasoning); "think" is
   *  the model's own scratch thinking. */
  kind: "think" | "reasoning";
} {
  const closed = content.match(/<(think|thought|reasoning)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (closed) {
    const answer = (
      content.slice(0, closed.index ?? 0) + content.slice((closed.index ?? 0) + (closed[0]?.length ?? 0))
    ).replace(/^\s+/, "");
    return { thought: (closed[2] ?? "").trim(), answer, thinking: false, kind: kindOf(closed[1]) };
  }
  const open = content.match(/<(think|thought|reasoning)\b[^>]*>([\s\S]*)$/i);
  if (open) return { thought: (open[2] ?? "").trim(), answer: "", thinking: true, kind: kindOf(open[1]) };
  return { thought: "", answer: content, thinking: false, kind: "think" };
}

const kindOf = (tag: string | undefined) => (tag?.toLowerCase() === "reasoning" ? "reasoning" : "think");

/* ── Highlighting the direct answer ────────────────────────────────────────
 * Models are asked to wrap the one value the question was actually about in
 * `==double equals==`. We turn that into a <mark> so the figure pops out of the
 * surrounding explanation instead of being buried in a sentence.
 *
 * Done as a remark plugin over the mdast rather than a regex over the raw string,
 * so `==` inside code spans and fenced blocks is left alone (those are `inlineCode`
 * / `code` nodes, never `text`). `data.hName` renames the output element, which
 * is why no rehype-raw / extra dependency is needed. */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

const MARK_RE = /==([^=\n]+)==/g;

/** Split one text node into text / <mark> / text pieces, or null if it has none. */
function splitMarks(node: MdNode): MdNode[] | null {
  const value = node.value;
  if (node.type !== "text" || !value || !value.includes("==")) return null;
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(MARK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", value: value.slice(last, at) });
    out.push({
      // Any inline container will do — hName is what decides the tag.
      type: "emphasis",
      data: { hName: "mark" },
      children: [{ type: "text", value: m[1] ?? "" }],
    });
    last = at + m[0].length;
  }
  if (!out.length) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    const parts = splitMarks(child);
    if (parts) {
      next.push(...parts);
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

function remarkHighlight() {
  return (tree: MdNode) => walk(tree);
}

/** Remark plugins every assistant bubble renders with. */
export const MD_PLUGINS = [remarkGfm, remarkHighlight];

// Compact markdown styling for assistant bubbles (no typography plugin needed).
export const MD_CLASS =
  "text-[0.9375rem] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_h1]:my-1 [&_h1]:text-base [&_h1]:font-medium [&_h2]:my-1 [&_h2]:text-base " +
  "[&_h2]:font-medium [&_h3]:my-1 [&_h3]:text-base [&_h3]:font-medium [&_strong]:font-medium " +
  "[&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:text-[0.85em] " +
  "[&_a]:underline [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-100 [&_pre]:p-2 " +
  "";
// <mark> is styled globally (see globals.css) so the answer highlight looks the
// same in markdown and in hand-written markup.

/** An assistant message: collapsible "Thinking…" block + streamed markdown. */
export function AssistantBubble({
  content,
  busy,
  open,
  onToggle,
  className = "bg-zinc-100 text-zinc-800",
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
    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[0.9375rem] ${className}`}>
      {thought ? (
        <div className="mb-1">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-[0.8125rem] text-zinc-400 hover:text-zinc-600"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${showThought ? "rotate-90" : ""}`}
            />
            {thinking ? <Working /> : "Thoughts"}
          </button>
          {showThought ? (
            <div className="mt-1 whitespace-pre-wrap border-l-2 border-zinc-200 pl-2 text-[0.8125rem] text-zinc-400">
              {thought}
            </div>
          ) : null}
        </div>
      ) : null}
      {answer ? (
        <div className={MD_CLASS}>
          <ReactMarkdown remarkPlugins={MD_PLUGINS}>{answer}</ReactMarkdown>
        </div>
      ) : !thought && busy ? (
        <Working />
      ) : null}
    </div>
  );
}
