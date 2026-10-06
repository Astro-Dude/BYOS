"use client";

import { type AiKey, ApiError, type AiPrompt, type FileItem } from "@byos/api-client";
import { KeyRound, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Dropdown } from "@/components/byok/dropdown";
import { KeyForm } from "@/components/byok/key-form";
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
    "rounded-md border border-zinc-200 bg-white px-2 py-1 text-[0.8125rem] text-zinc-700 outline-none focus:border-zinc-900";

  if (!ready) {
    return (
      <div className="flex w-full items-center justify-center p-6 text-[0.9375rem] text-zinc-500 sm:w-96">
        Loading…
      </div>
    );
  }

  // No key yet: set one up right here rather than sending the user away and
  // making them find their way back to this document.
  if (keys.length === 0) {
    return (
      <div className="flex min-h-0 w-full flex-col border-t border-zinc-200 sm:w-96 sm:border-l sm:border-t-0">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
          <KeyRound className="h-4 w-4 text-zinc-900" />
          <span className="text-[0.9375rem] font-medium text-zinc-800">
            Bring your own key
          </span>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-4 text-[0.8125rem] leading-relaxed text-zinc-500">
            Add any OpenAI-compatible key to summarize and chat with this document using your own
            model. It&apos;s encrypted and only used for your requests. You can manage keys later
            in{" "}
            <Link href="/byok" className="font-medium text-zinc-900">
              BYOK
            </Link>
            .
          </p>
          <KeyForm
            existing={null}
            submitLabel="Save & use"
            onSaved={(saved) => {
              // Select it straight away so the panel is usable without a reload.
              setKeys([saved]);
              onKey(saved.id);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-col border-t border-zinc-200 sm:w-96 sm:border-l sm:border-t-0">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
        <span className="flex items-center gap-2 text-[0.9375rem] font-medium text-zinc-800">
          <Sparkles className="h-4 w-4 text-zinc-900" /> Ask AI
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

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2">
        <Dropdown
          value={keyId}
          onChange={onKey}
          ariaLabel="Model"
          options={keys.map((k) => ({ value: k.id, label: k.name }))}
          className={selectCls}
        />
        <Dropdown
          value={promptId}
          onChange={onPrompt}
          ariaLabel="System prompt"
          options={[
            { value: "", label: "Default prompt" },
            ...prompts.map((p) => ({ value: p.id, label: p.name })),
          ]}
          className={selectCls}
        />
        <label
          title="Long document mode. For books and big files, it finds the relevant parts."
          className="ml-auto flex cursor-pointer items-center gap-1.5 text-[0.8125rem] text-zinc-500"
        >
          <input
            type="checkbox"
            checked={longDoc}
            onChange={(e) => setLongDoc(e.target.checked)}
            className="h-3.5 w-3.5 accent-zinc-900"
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
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-[0.9375rem] text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
            >
              ✨ Summarize this document
            </button>
            <p className="px-1 text-[0.8125rem] text-zinc-400">…or ask anything about it below.</p>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="user-bubble max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-900 px-3 py-2 text-[0.9375rem] text-white">
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
        {error ? <p className="text-[0.9375rem] text-red-600">{error}</p> : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 border-t border-zinc-100 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this document…"
          className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-3 py-2 text-[0.9375rem] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
