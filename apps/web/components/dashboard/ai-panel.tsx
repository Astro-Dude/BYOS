"use client";

import { type AiConfig, ApiError, type FileItem } from "@byos/api-client";
import { ChevronRight, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

type Msg = { role: "user" | "assistant"; content: string };

// Split streamed content into the model's inline reasoning (<think>/<thought>)
// and the actual answer. `thinking` is true while the thought is still open
// (mid-stream) — the UI shows it live, then collapses it once the answer starts.
function splitThought(content: string): { thought: string; answer: string; thinking: boolean } {
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
const MD_CLASS =
  "text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_h1]:my-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-1 [&_h2]:text-base " +
  "[&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-base [&_h3]:font-semibold [&_strong]:font-semibold " +
  "[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 " +
  "[&_a]:underline [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-black/10 [&_pre]:p-2 " +
  "dark:[&_pre]:bg-white/10";

/** BYOM chat/summarize panel for a single document. Stateful thread (persisted
 *  server-side), streamed token-by-token. */
export function AiPanel({ file }: { file: FileItem }) {
  const authed = useAuthed();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openThoughts, setOpenThoughts] = useState<Set<number>>(new Set());
  // Long-document mode: default on for large files (chunk + retrieve instead of
  // truncating the whole thing into context).
  const [longDoc, setLongDoc] = useState(() => (file.size ?? 0) > 400_000);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleThought = (i: number) =>
    setOpenThoughts((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, history] = await authed((t) =>
          Promise.all([api.getAiConfig(t), api.getChatHistory(t, file.id)]),
        );
        if (cancelled) return;
        setConfig(cfg);
        setMessages(history.map((m) => ({ role: m.role, content: m.content })));
      } catch {
        if (!cancelled) setConfig(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, file.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const appendToLast = (chunk: string) =>
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + chunk };
      return copy;
    });

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    setMessages((p) => [...p, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await authed((t) => api.chatStream(t, file.id, q, appendToLast, longDoc));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong");
      // Drop the empty assistant placeholder if nothing streamed.
      setMessages((p) => (p[p.length - 1]?.content ? p : p.slice(0, -1)));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await authed((t) => api.clearChat(t, file.id));
      setMessages([]);
    } catch {
      // ignore
    }
  };

  if (!ready) {
    return (
      <div className="flex w-full items-center justify-center p-6 text-sm text-zinc-500 sm:w-96">
        Loading…
      </div>
    );
  }

  if (!config?.configured) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-2 p-6 text-center sm:w-96">
        <Sparkles className="h-7 w-7 text-indigo-400" />
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Bring your own key
        </p>
        <p className="text-sm text-zinc-500">
          Add your LLM key in <span className="font-medium">Profile → AI model</span> to summarize
          and chat with this document — using your own key.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full min-h-0 flex-col border-t border-zinc-200 dark:border-zinc-800 sm:w-96 sm:border-l sm:border-t-0">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <Sparkles className="h-4 w-4 text-indigo-500" /> Ask AI
        </span>
        <div className="flex items-center gap-2">
          <label
            title="Long-document mode — for books/large files, finds the relevant sections instead of sending the whole file"
            className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
          >
            <input
              type="checkbox"
              checked={longDoc}
              onChange={(e) => setLongDoc(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            Long doc
          </label>
          {messages.length > 0 ? (
            <button
              onClick={clear}
              className="text-zinc-400 hover:text-red-600"
              aria-label="Clear conversation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <button
              onClick={() => send("Summarize this document concisely, with the key points.")}
              disabled={busy}
              className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-sm text-indigo-800 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
            >
              ✨ Summarize this document
            </button>
            <p className="px-1 text-xs text-zinc-400">…or ask anything about it below.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-indigo-600 px-3 py-2 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              );
            }
            const { thought, answer, thinking } = splitThought(m.content);
            const showThought = !!thought && (thinking || openThoughts.has(i));
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                  {thought ? (
                    <div className="mb-1">
                      <button
                        onClick={() => toggleThought(i)}
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
              </div>
            );
          })
        )}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this document…"
          className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
