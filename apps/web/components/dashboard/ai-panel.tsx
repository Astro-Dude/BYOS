"use client";

import { type AiKey, ApiError, type AiPrompt, type FileItem } from "@byos/api-client";
import { Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AssistantBubble } from "@/components/dashboard/chat-format";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

type Msg = { role: "user" | "assistant"; content: string };

const LAST_KEY = "byos:ai:key";
const LAST_PROMPT = "byos:ai:prompt";
// Single-doc chats are kept client-side (not stored on our servers).
const chatKey = (fileId: string) => `byos:ai:chat:${fileId}`;

function loadChat(fileId: string): Msg[] {
  try {
    const raw = localStorage.getItem(chatKey(fileId));
    return raw ? (JSON.parse(raw) as Msg[]) : [];
  } catch {
    return [];
  }
}

/** Single-document chat/summarize panel. Picks a key + prompt from the BYOK
 *  vault; stateful thread, streamed token-by-token. */
export function AiPanel({ file }: { file: FileItem }) {
  const authed = useAuthed();
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [keyId, setKeyId] = useState<string>("");
  const [promptId, setPromptId] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openThoughts, setOpenThoughts] = useState<Set<number>>(new Set());
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
    setMessages(loadChat(file.id)); // thread lives in localStorage
    (async () => {
      try {
        const [ks, ps] = await authed((t) =>
          Promise.all([api.listAiKeys(t), api.listAiPrompts(t)]),
        );
        if (cancelled) return;
        setKeys(ks);
        setPrompts(ps);
        const savedKey = localStorage.getItem(LAST_KEY);
        setKeyId(ks.find((k) => k.id === savedKey)?.id ?? ks[0]?.id ?? "");
        const savedPrompt = localStorage.getItem(LAST_PROMPT);
        setPromptId(ps.find((p) => p.id === savedPrompt)?.id ?? "");
      } catch {
        if (!cancelled) setKeys([]);
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

  // Persist the thread client-side once a turn settles (not mid-stream).
  useEffect(() => {
    if (!ready || busy) return;
    try {
      if (messages.length) localStorage.setItem(chatKey(file.id), JSON.stringify(messages));
      else localStorage.removeItem(chatKey(file.id));
    } catch {
      /* storage full / unavailable — thread just won't persist */
    }
  }, [messages, busy, ready, file.id]);

  const appendToLast = (chunk: string) =>
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant")
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
      return copy;
    });

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || !keyId) return;
    setError(null);
    setInput("");
    const history = messages; // prior turns, sent for context
    setMessages((p) => [...p, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await authed((t) =>
        api.chatStream(
          t,
          {
            fileId: file.id,
            keyId,
            promptId: promptId || null,
            message: q,
            retrieval: longDoc,
            history,
          },
          appendToLast,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong");
      setMessages((p) => (p[p.length - 1]?.content ? p : p.slice(0, -1)));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setMessages([]);
    try {
      localStorage.removeItem(chatKey(file.id));
    } catch {
      /* ignore */
    }
  };

  const onKey = (id: string) => {
    setKeyId(id);
    localStorage.setItem(LAST_KEY, id);
  };
  const onPrompt = (id: string) => {
    setPromptId(id);
    localStorage.setItem(LAST_PROMPT, id);
  };

  const selectCls =
    "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

  if (!ready) {
    return (
      <div className="flex w-full items-center justify-center p-6 text-sm text-zinc-500 sm:w-96">
        Loading…
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-2 p-6 text-center sm:w-96">
        <Sparkles className="h-7 w-7 text-indigo-400" />
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Bring your own key</p>
        <p className="text-sm text-zinc-500">
          Add a key in{" "}
          <Link href="/byok" className="font-medium text-indigo-600 dark:text-indigo-400">
            BYOK
          </Link>{" "}
          to summarize and chat with this document — using your own model.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-col border-t border-zinc-200 dark:border-zinc-800 sm:w-96 sm:border-l sm:border-t-0">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <Sparkles className="h-4 w-4 text-indigo-500" /> Ask AI
        </span>
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

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <select value={keyId} onChange={(e) => onKey(e.target.value)} className={selectCls}>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <select value={promptId} onChange={(e) => onPrompt(e.target.value)} className={selectCls}>
          <option value="">Default prompt</option>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label
          title="Long-document mode — for books/large files, retrieves the relevant sections"
          className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
        >
          <input
            type="checkbox"
            checked={longDoc}
            onChange={(e) => setLongDoc(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-600"
          />
          Long doc
        </label>
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
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-indigo-600 px-3 py-2 text-sm text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <AssistantBubble
                  content={m.content}
                  busy={busy}
                  open={openThoughts.has(i)}
                  onToggle={() => toggleThought(i)}
                />
              </div>
            ),
          )
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
