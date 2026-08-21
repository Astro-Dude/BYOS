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

import ReactMarkdown from "react-markdown";

import { Dropdown } from "@/components/byok/dropdown";
import { DriveMessage, type Source } from "@/components/byok/drive-message";
import { type ChatMode, ModeMenu } from "@/components/byok/mode-menu";
import type { PlanState } from "@/components/byok/plan-card";
import { FileCanvas } from "@/components/byok/file-canvas";
import { MD_PLUGINS } from "@/components/dashboard/chat-format";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useIndexing } from "@/lib/indexing";

/** "system" messages are local notices from a slash command — never sent to the
 *  model and never persisted, so they don't pollute the conversation's context. */
type Msg = { role: "user" | "assistant" | "system"; content: string };

/** A slash command runs deterministically against the API — no model call, no
 *  tokens, no confirmation round-trip. Anything destructive stays in Settings,
 *  where its confirm step already lives. */
type Command = {
  name: string;
  args?: string;
  hint: string;
  run: (rest: string) => Promise<string> | string;
};

const LAST_KEY = "byos:byok:key";
const LAST_PROMPT = "byos:byok:prompt";
const LAST_MODE = "byos:byok:mode";

const MODE_VALUES: ChatMode[] = ["read_only", "ask", "auto", "full"];

// How tall the composer may grow before it starts scrolling instead — about five
// lines. A textarea won't do this on its own: with rows=1 it keeps a one-line box
// and scrolls the rest out of sight.
const COMPOSER_MAX_PX = 128;

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
  // Shared with the settings panel, so /index drives the same run and the same
  // progress card.
  const indexing = useIndexing();
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
  const [mode, setMode] = useState<ChatMode>("read_only");
  // Live plan state per plan id, so applying one updates its card without
  // reloading the conversation (the stream only carries proposal-time state).
  const [plans, setPlans] = useState<Record<string, PlanState>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [idxStatus, setIdxStatus] = useState<{ indexed: number; total: number } | null>(null);
  const [openFile, setOpenFile] = useState<Source | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const justCreated = useRef<string | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem(LAST_KEY);
    setKeyId(keys.find((k) => k.id === savedKey)?.id ?? keys[0]?.id ?? "");
    const savedPrompt = localStorage.getItem(LAST_PROMPT);
    setPromptId(prompts.find((p) => p.id === savedPrompt)?.id ?? "");
    const savedMode = localStorage.getItem(LAST_MODE) as ChatMode | null;
    // Never restore a permissive mode from a value we don't recognise.
    if (savedMode && MODE_VALUES.includes(savedMode)) setMode(savedMode);
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
    setPlans({});
    authed((t) => api.getConversationMessages(t, conversationId))
      .then((h) => {
        if (!cancelled) setMessages(h.map((m) => ({ role: m.role, content: m.content })));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingMsgs(false);
      });
    // Plans are stored separately from the transcript: the message only records
    // what was proposed, the plan row knows whether it was ever applied.
    authed((t) => api.agentPlans(t, conversationId))
      .then((rows) => {
        if (cancelled) return;
        setPlans(
          Object.fromEntries(
            rows.map((r) => [r.id, { planId: r.id, status: r.status, actions: r.actions }]),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authed, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Match the composer's height to its content. Reset to "auto" first so it can
  // shrink back down again — after a send, or when lines are deleted.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [input]);

  // Indexing coverage for the selected model, so users see what the chat can see.
  // Re-read when a run ends (`finishedAt`) — indexing is what changes this count,
  // and the pill used to sit at its first value until a reload.
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
  }, [authed, keyId, keys, indexing.finishedAt]);

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
    if (!q || busy) return;
    setError(null);
    setInput("");
    setAddOpen(false);
    // Slash commands run locally — no model call, so no conversation is created
    // and nothing is persisted. Dispatched before the key check so /help still
    // works with nothing configured; each command states its own requirements.
    if (await runCommand(q)) return;
    if (!keyId) return;
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
        api.agentChatStream(
          t,
          { conversationId: cid, keyId, promptId: promptId || null, message: q, mode, strategies },
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
  const onMode = (m: ChatMode) => {
    setMode(m);
    localStorage.setItem(LAST_MODE, m);
  };
  // A plan that changed the drive invalidates the file list the rest of the app
  // is showing, so treat applying one as activity.
  const onPlanChange = (next: PlanState) => {
    setPlans((p) => ({ ...p, [next.planId]: next }));
    if (next.status === "applied") onActivity();
  };

  const activeKey = keys.find((k) => k.id === keyId);

  const commands: Command[] = [
    {
      name: "/index",
      args: "[all]",
      hint: "Embed files that aren't indexed yet — “/index all” rebuilds every file",
      run: (rest) => {
        if (!keyId) return "Pick a model first.";
        if (!activeKey?.embedding_model)
          return `“${activeKey?.name ?? "This key"}” has no embedding model set — add one in Settings to index.`;
        if (indexing.running) return "Already indexing — see the progress card.";
        const everything = rest.trim() === "all";
        // Plain /index catches up; "all" rebuilds, since a catch-up would skip
        // everything already current.
        indexing.start({ keyId, all: true, remaining: !everything, force: everything });
        return everything
          ? "Rebuilding the index for every file. Progress is in the corner."
          : "Indexing whatever's left. Progress is in the corner.";
      },
    },
    {
      name: "/stop",
      hint: "Stop the indexing run in progress",
      run: () => {
        if (!indexing.running) return "Nothing is indexing right now.";
        indexing.cancel();
        return "Stopped. Whatever finished stays indexed — /index picks up the rest.";
      },
    },
    {
      name: "/help",
      hint: "List these commands",
      run: () =>
        commands.map((c) => `**${c.name}** ${c.args ?? ""} — ${c.hint}`).join("\n\n"),
    },
  ];

  const notice = (content: string) => setMessages((p) => [...p, { role: "system", content }]);

  /** Run a slash command. Returns false if the text isn't one. */
  const runCommand = async (text: string): Promise<boolean> => {
    if (!text.startsWith("/")) return false;
    const [word, ...rest] = text.slice(1).split(/\s+/);
    const cmd = commands.find((c) => c.name === `/${word}`);
    if (!cmd) {
      notice(
        `Unknown command **/${word}**. Try ${commands.map((c) => `**${c.name}**`).join(", ")}.`,
      );
      return true;
    }
    setMessages((p) => [...p, { role: "user", content: text }]);
    try {
      notice(await cmd.run(rest.join(" ")));
    } catch {
      notice(`**${cmd.name}** failed — try again.`);
    }
    return true;
  };

  // Suggestions while typing a bare "/word" (not once arguments start).
  const suggestions =
    /^\/\S*$/.test(input) && !busy
      ? commands.filter((c) => c.name.startsWith(input.toLowerCase()))
      : [];

  const activeStrategies = STRATEGY_INFO.filter((s) => strategies[s.key]).length;

  /** Live state for whichever plan this message proposed, if we know it. */
  const planFor = (content: string): PlanState | null => {
    const match = /"plan_id":\s*"([0-9a-f-]{36})"/.exec(content);
    return match?.[1] ? (plans[match[1]] ?? null) : null;
  };

  const composer = (
    <div className="relative w-full">
      {addOpen ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
          <div className="menu-surface absolute bottom-14 left-0 z-20 w-[min(18rem,calc(100vw-3rem))] p-3">
            <p className="mb-1 text-[0.8125rem] text-zinc-500">System prompt</p>
            <Dropdown
              value={promptId}
              onChange={onPrompt}
              options={[
                { value: "", label: "Default" },
                ...prompts.map((p) => ({ value: p.id, label: p.name })),
              ]}
              className="w-full justify-between rounded-md border border-zinc-200 bg-zinc-100 px-2 py-1.5 text-[0.9375rem] text-zinc-900"
            />
            <p className="mb-1 mt-3 text-[0.8125rem] font-medium text-zinc-500">Retrieval add-ons</p>
            <div className="space-y-0.5">
              {STRATEGY_INFO.map((s) => (
                <label
                  key={s.key}
                  title={s.hint}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[0.9375rem] text-zinc-800 hover:bg-zinc-100"
                >
                  <input
                    type="checkbox"
                    checked={strategies[s.key]}
                    onChange={() => setStrategies((p) => ({ ...p, [s.key]: !p[s.key] }))}
                    className="h-3.5 w-3.5 accent-zinc-900"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {suggestions.length ? (
        <div className="menu-surface absolute bottom-14 left-0 right-0 z-20 p-1">
          {suggestions.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onMouseEnter={() => setSuggestIdx(i)}
              onClick={() => setInput(c.args ? `${c.name} ` : c.name)}
              className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
 i === Math.min(suggestIdx, suggestions.length - 1)
                  ? "bg-zinc-900/10"
                  : "hover:bg-zinc-100"
              }`}
            >
              <span className="font-mono text-[0.8125rem] text-zinc-900">{c.name}</span>
              {c.args ? <span className="font-mono text-[0.8125rem] text-zinc-400">{c.args}</span> : null}
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-zinc-500">
                {c.hint}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-3 transition-colors focus-within:border-zinc-900"
      >
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className={`btn-icon ${activeStrategies ? "ring-1 ring-zinc-900/40" : ""}`}
          aria-label="Add-ons"
        >
          <Plus className="h-4 w-4" />
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSuggestIdx(0);
          }}
          onKeyDown={(e) => {
            if (suggestions.length) {
              // While the command menu is open the arrows and Tab drive it, and
              // Enter completes rather than sending a half-typed command.
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestIdx(
                  (i) =>
                    (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) %
                    suggestions.length,
                );
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                const pick = suggestions[Math.min(suggestIdx, suggestions.length - 1)];
                if (pick && pick.name !== input) {
                  e.preventDefault();
                  setInput(pick.args ? `${pick.name} ` : pick.name);
                  setSuggestIdx(0);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setInput("");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={
            mode === "read_only"
              ? "Ask across your drive, or / for commands…"
              : "Ask, tell me what to change, or / for commands…"
          }
          className="hair-scroll min-h-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1.5 text-[0.9375rem] leading-6 text-zinc-900 outline-none placeholder:text-zinc-500"
          style={{ maxHeight: COMPOSER_MAX_PX }}
        />
        <ModeMenu value={mode} onChange={onMode} />
        <button
          type="submit"
          disabled={busy || !input.trim() || !keyId}
          className="btn-send"
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
          className="rounded-lg px-2 py-1 text-[0.9375rem] font-medium text-zinc-900 hover:bg-zinc-100"
        />
        {indexing.running ? (
          <span
            title="Indexing in progress"
            className="flex items-center gap-1.5 rounded-full border border-zinc-900/25 px-2 py-0.5 text-[0.8125rem] text-zinc-900"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            indexing {indexing.done}/{indexing.total}
          </span>
        ) : idxStatus ? (
          <span
            title="Files embedded for this model — the chat can draw on these"
            className="rounded-full border border-zinc-200 px-2 py-0.5 text-[0.8125rem] text-zinc-500"
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
          <h2 className="mb-6 type-heading-sm">What do you want to know?</h2>
          <div className="w-full max-w-2xl">{composer}</div>
          <p className="mt-3 text-[0.8125rem] text-zinc-400">
            {mode === "read_only"
              ? "Answers are grounded in your indexed files."
              : "I can organise and tidy your drive — the button sets how much I may do myself."}
          </p>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
              {messages.map((m, i) =>
                m.role === "system" ? (
                  <div key={i} className="flex justify-center">
                    <div className="max-w-[85%] rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2 text-[0.8125rem] text-zinc-600">
                      <ReactMarkdown remarkPlugins={MD_PLUGINS}>{m.content}</ReactMarkdown>
                    </div>
                  </div>
                ) : m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-900 px-5 py-3 text-[0.9375rem] leading-[1.35] text-white">
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
                      planOverride={planFor(m.content)}
                      onPlanChange={onPlanChange}
                    />
                  </div>
                ),
              )}
              {error ? <p className="text-[0.9375rem] text-red-500">{error}</p> : null}
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
