"use client";

import {
  type AiConversation,
  type AiKey,
  ApiError,
  type AiPrompt,
  type RagStrategies,
} from "@byos/api-client";
import { Loader2, Plus, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Dropdown } from "@/components/byok/dropdown";
import { DriveMessage, type Source } from "@/components/byok/drive-message";
import { FileCanvas } from "@/components/byok/file-canvas";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

type Msg = { role: "user" | "assistant"; content: string };

const LAST_KEY = "byos:byok:key";
const LAST_PROMPT = "byos:byok:prompt";

const STRATEGY_INFO: { key: keyof RagStrategies; label: string; hint: string }[] = [
  { key: "rewrite", label: "Query rewriting", hint: "Rewrite the question into a better search query" },
  { key: "hyde", label: "HyDE", hint: "Draft a hypothetical answer and retrieve with that" },
  { key: "rerank", label: "Rerank (LLM judge)", hint: "Reorder/keep the best retrieved chunks" },
  { key: "crag", label: "CRAG (corrective)", hint: "If retrieval is weak, rewrite + retrieve again" },
];

// Shimmering placeholder bubbles while a conversation's messages load.
const SKELETON_ROWS: { right: boolean; w: string; h: string }[] = [
  { right: true, w: "w-40", h: "h-10" },
  { right: false, w: "w-72", h: "h-24" },
  { right: true, w: "w-28", h: "h-10" },
  { right: false, w: "w-64", h: "h-20" },
  { right: true, w: "w-48", h: "h-10" },
  { right: false, w: "w-80", h: "h-28" },
];

function ConversationSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      {SKELETON_ROWS.map((r, i) => (
        <div key={i} className={`flex ${r.right ? "justify-end" : "justify-start"}`}>
          <div
            className={`byok-shimmer max-w-[85%] rounded-2xl ${r.w} ${r.h}`}
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        </div>
      ))}
    </div>
  );
}

/** ChatGPT-style chat pane. `conversationId` is null for a fresh "home" chat;
 *  the first message lazily creates a conversation. Model picker sits top-left;
 *  RAG strategies + prompt live behind the composer's "+" add-ons menu. */
export function DriveChat({
  conversationId,
  keys,
  prompts,
  onActivate,
  onActivity,
}: {
  conversationId: string | null;
  keys: AiKey[];
  prompts: AiPrompt[];
  onActivate: (c: AiConversation) => void;
  onActivity: () => void;
}) {
  const authed = useAuthed();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveIdx, setLiveIdx] = useState<number | null>(null); // message being typed out
  const [keyId, setKeyId] = useState("");
  const [promptId, setPromptId] = useState("");
  const [strategies, setStrategies] = useState<RagStrategies>({
    rewrite: false,
    hyde: false,
    rerank: false,
    crag: false,
  });
  const [addOpen, setAddOpen] = useState(false);
  const [idxStatus, setIdxStatus] = useState<{ indexed: number; total: number } | null>(null);
  const [openFile, setOpenFile] = useState<Source | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const justCreated = useRef<string | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem(LAST_KEY);
    setKeyId(keys.find((k) => k.id === savedKey)?.id ?? keys[0]?.id ?? "");
    const savedPrompt = localStorage.getItem(LAST_PROMPT);
    setPromptId(prompts.find((p) => p.id === savedPrompt)?.id ?? "");
  }, [keys, prompts]);

  // Load history when the active conversation changes — but skip the one we
  // just created mid-send (so the optimistic messages aren't wiped).
  useEffect(() => {
    if (conversationId && justCreated.current === conversationId) {
      justCreated.current = null;
      return;
    }
    let cancelled = false;
    setMessages([]);
    setLiveIdx(null); // restored messages render fully, no typing
    setOpenFile(null);
    if (!conversationId) {
      setLoadingMsgs(false);
      return;
    }
    setLoadingMsgs(true);
    authed((t) => api.getConversationMessages(t, conversationId))
      .then((h) => {
        if (!cancelled) setMessages(h.map((m) => ({ role: m.role, content: m.content })));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingMsgs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Indexing coverage for the selected model, so users see what the chat can see.
  useEffect(() => {
    const key = keys.find((k) => k.id === keyId);
    if (!key?.embedding_model) {
      setIdxStatus(null);
      return;
    }
    let cancelled = false;
    authed((t) => api.indexStatus(t, keyId))
      .then((s) => {
        if (!cancelled) setIdxStatus({ indexed: s.indexed_file_ids.length, total: s.total });
      })
      .catch(() => {
        if (!cancelled) setIdxStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, keyId, keys]);

  const appendToLast = (chunk: string) =>
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant")
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
      return copy;
    });

  const send = async () => {
    const q = input.trim();
    if (!q || busy || !keyId) return;
    setError(null);
    setInput("");
    setAddOpen(false);
    setMessages((p) => {
      setLiveIdx(p.length + 1); // the assistant placeholder — type this one out
      return [...p, { role: "user", content: q }, { role: "assistant", content: "" }];
    });
    setBusy(true);
    try {
      let cid = conversationId;
      if (!cid) {
        const convo = await authed((t) => api.createConversation(t));
        justCreated.current = convo.id;
        cid = convo.id;
        onActivate(convo); // add to sidebar + mark active (no remount)
      }
      await authed((t) =>
        api.driveChatStream(
          t,
          { conversationId: cid, keyId, promptId: promptId || null, message: q, strategies },
          appendToLast,
        ),
      );
      onActivity();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong");
      setMessages((p) => (p[p.length - 1]?.content ? p : p.slice(0, -1)));
    } finally {
      setBusy(false);
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

  const activeStrategies = STRATEGY_INFO.filter((s) => strategies[s.key]).length;

  const composer = (
    <div className="relative w-full">
      {addOpen ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
          <div className="absolute bottom-14 left-0 z-20 w-72 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95">
            <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">System prompt</p>
            <Dropdown
              value={promptId}
              onChange={onPrompt}
              options={[
                { value: "", label: "Default" },
                ...prompts.map((p) => ({ value: p.id, label: p.name })),
              ]}
              className="w-full justify-between rounded-md border border-zinc-200 bg-black/[0.03] px-2 py-1.5 text-sm text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
            />
            <p className="mb-1 mt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">Retrieval add-ons</p>
            <div className="space-y-0.5">
              {STRATEGY_INFO.map((s) => (
                <label
                  key={s.key}
                  title={s.hint}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-zinc-800 hover:bg-black/5 dark:text-zinc-200 dark:hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={strategies[s.key]}
                    onChange={() => setStrategies((p) => ({ ...p, [s.key]: !p[s.key] }))}
                    className="h-3.5 w-3.5 accent-indigo-600"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-black/[0.03] p-2 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]"
      >
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-black/10 dark:text-zinc-300 dark:hover:bg-white/10 ${
            activeStrategies ? "ring-1 ring-indigo-400/50" : ""
          }`}
          aria-label="Add-ons"
        >
          <Plus className="h-4 w-4" />
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Ask across your drive…"
          className="max-h-40 min-h-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || !keyId}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Chat column (shifts left / narrows when a source canvas is open) */}
      <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar: model picker (top-left, ChatGPT-style) */}
      <div className="flex items-center gap-3 px-4 py-3">
        <Dropdown
          value={keyId}
          onChange={onKey}
          options={keys.map((k) => ({ value: k.id, label: k.name }))}
          placeholder={keys.length ? "Select model" : "No keys — add one in Settings"}
          className="rounded-lg px-2 py-1 text-sm font-medium text-zinc-900 hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/5"
        />
        {idxStatus ? (
          <span
            title="Files embedded for this model — the chat can draw on these"
            className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400"
          >
            {idxStatus.indexed}/{idxStatus.total} files indexed
          </span>
        ) : null}
      </div>

      {loadingMsgs ? (
        <>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <ConversationSkeleton />
          </div>
          <div className="mx-auto w-full max-w-3xl px-4 pb-5 opacity-50">{composer}</div>
        </>
      ) : messages.length === 0 ? (
        /* Home state */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <h2 className="mb-6 text-2xl font-medium text-zinc-900 dark:text-zinc-100">What do you want to know?</h2>
          <div className="w-full max-w-2xl">{composer}</div>
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">Answers are grounded in your indexed files.</p>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm text-white">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <DriveMessage
                      content={m.content}
                      busy={busy}
                      animate={i === liveIdx}
                      onOpenFile={setOpenFile}
                    />
                  </div>
                ),
              )}
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl px-4 pb-5">{composer}</div>
        </>
      )}
      </div>

      {openFile ? <FileCanvas source={openFile} onClose={() => setOpenFile(null)} /> : null}
    </div>
  );
}
