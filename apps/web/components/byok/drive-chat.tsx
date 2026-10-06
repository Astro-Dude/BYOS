"use client";

import {
  type AiConversation,
  type AiKey,
  ApiError,
  type AiPrompt,
  type OrganizeOptions,
  type RagStrategies,
  type ReasoningEffort,
} from "@byos/api-client";
import { AlertCircle, Check, Loader2, Menu, Plus, Search, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Dropdown } from "@/components/byok/dropdown";
import { DriveMessage, type Revising, type Source } from "@/components/byok/drive-message";
import { type ChatMode, ModeMenu, MODES } from "@/components/byok/mode-menu";
import { KeyPicker } from "@/components/byok/key-picker";
import { OrganizePanel } from "@/components/byok/organize-panel";
import { Toggle } from "@/components/settings/controls";
import type { PlanState } from "@/components/byok/plan-card";
import { FileCanvas } from "@/components/byok/file-canvas";
import type { SettingsTarget } from "@/components/settings/sections";
import { RingButton } from "@/components/ui/rail-toggle";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useAuthed } from "@/lib/auth-context";
import { ANSWER_ADDONS, SEARCH_ADDONS } from "@/lib/chat-addons";
import { useIndexing } from "@/lib/indexing";
import { loadKeyModels, matchModel } from "@/lib/key-models";
import { rememberModelCheck } from "@/lib/model-check-cache";
import {
  EFFORT_HINTS,
  EFFORT_LABELS,
  EFFORT_ORDER,
  isEffort,
  type KeyParams,
  keyUpdate,
  TEMPERATURE_PRESETS,
  TOKEN_PRESETS,
  tokensLabel,
  useModelCapabilities,
} from "@/lib/model-params";
import { DEFAULT_ORGANIZE, ORGANIZE_ARGS, organizeSummary, parseOrganizeArgs } from "@/lib/organize";
import { pickGreeting } from "@/lib/greetings";
import { takePendingQuestion } from "@/lib/pending-question";
import { usePreferences } from "@/lib/preferences";

type Msg = { role: "user" | "assistant"; content: string };

/** What a slash command reports: a short note above the composer, never a
 *  chat message, so commands leave the conversation as it was. */
type Outcome = { ok: boolean; text: string };
const done = (text: string): Outcome => ({ ok: true, text });
const fail = (text: string): Outcome => ({ ok: false, text });

/** A slash command runs deterministically against the API — no model call, no
 *  tokens, no confirmation round-trip. Anything destructive stays in Settings,
 *  where its confirm step already lives. */
type Command = {
  name: string;
  aliases?: string[];
  args?: string;
  hint: string;
  /** What happened, or null when the command opened a picker instead. */
  run: (rest: string) => Promise<Outcome | null> | Outcome | null;
};

/** An inline choice, opened by a command run without its argument (/effort):
 *  arrows move, Enter picks, a number picks directly, Esc closes. A
 *  `searchable` one (/model) is filtered by what's typed in the composer. */
type PickerOption = { value: string; label: string; hint?: string };
type Picker = {
  command: string;
  title: string;
  options: PickerOption[];
  current: string;
  pick: (value: string) => Promise<Outcome | null> | Outcome | null;
  searchable?: boolean;
  /** Offer whatever was typed when nothing matches (a model not listed). */
  allowCustom?: boolean;
  loading?: boolean;
  error?: string;
};

/** A searchable picker's rows for what's typed: matches first, then the typed
 *  text itself when allowed and not already there. */
function pickerRows(p: Picker, typed: string): PickerOption[] {
  const q = typed.trim().toLowerCase();
  if (!p.searchable || !q) return p.options;
  const hits = p.options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q));
  const exact = p.options.some((o) => o.value.toLowerCase() === q);
  return p.allowCustom && !exact ? [...hits, { value: typed.trim(), label: `Use “${typed.trim()}”` }] : hits;
}

const LAST_KEY = "byos:byok:key";
const LAST_MODE = "byos:byok:mode";

const MODE_VALUES: ChatMode[] = ["read_only", "ask", "auto", "full"];

// How tall the composer may grow before it starts scrolling instead — about five
// lines. A textarea won't do this on its own: with rows=1 it keeps a one-line box
// and scrolls the rest out of sight.
const COMPOSER_MAX_PX = 128;

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

const revisedEvent = (note: string) => `\x1e${JSON.stringify({ kind: "revised", note })}\n`;

/** The "revised" notes at the head of a message, kept when it's rewritten. */
function revisionEvents(content: string): string {
  return content
    .split("\n")
    .filter((line) => line.startsWith("\x1e") && /"kind":\s*"revised"/.test(line))
    .map((line) => `${line}\n`)
    .join("");
}

/** ChatGPT-style chat pane. `conversationId` is null for a fresh "home" chat;
 *  the first message lazily creates a conversation. Model picker sits top-left;
 *  RAG strategies + prompt live behind the composer's "+" add-ons menu. */

/** The first words of a prompt, for telling similar names apart. */
const promptPreview = (content: string) => {
  const flat = content
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat ? (flat.length > 70 ? `${flat.slice(0, 70)}…` : flat) : "Empty prompt";
};

export function DriveChat({
  conversationId,
  keys,
  prompts,
  onActivate,
  onActivity,
  onOpenSidebar,
  onOpenSettings,
  onKeyUpdated,
  onDiscard,
}: {
  conversationId: string | null;
  keys: AiKey[];
  prompts: AiPrompt[];
  onActivate: (c: AiConversation) => void;
  onActivity: () => void;
  onOpenSidebar?: () => void;
  onOpenSettings?: (target: SettingsTarget) => void;
  /** A key's settings were changed from the chat (quick settings, /effort). */
  onKeyUpdated?: (key: AiKey) => void;
  /** A chat made for a first message that then failed: nothing was saved in
   *  it, so it shouldn't sit in the list. */
  onDiscard?: (conversationId: string) => void;
}) {
  const authed = useAuthed();
  // Shared with the settings panel, so /index drives the same run and the same
  // progress card.
  const indexing = useIndexing();
  const [messages, setMessages] = useState<Msg[]>([]);
  // Picked on the client (random, so not during render) and again whenever
  // the chat goes back to empty, so every new chat opens with a new line.
  const [greeting, setGreeting] = useState<string | null>(null);
  const isEmpty = messages.length === 0;
  useEffect(() => {
    if (isEmpty) setGreeting(pickGreeting());
  }, [isEmpty]);
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
    reasoning: false,
  });
  const [mode, setMode] = useState<ChatMode>("read_only");
  // Live plan state per plan id, so applying one updates its card without
  // reloading the conversation (the stream only carries proposal-time state).
  const [plans, setPlans] = useState<Record<string, PlanState>>({});
  // A plan being revised: Bao works over it while the new reply streams here.
  const [revising, setRevising] = useState<Revising | null>(null);
  const reviseAbort = useRef<AbortController | null>(null);
  const toast = useToast();
  // The prompt being answered right now: Bao works on its reply in this mode.
  const [liveRun, setLiveRun] = useState<{ mode: ChatMode; startedAt: number } | null>(null);
  const sendAbort = useRef<AbortController | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [idxStatus, setIdxStatus] = useState<{ indexed: number; total: number } | null>(null);
  const [openFile, setOpenFile] = useState<Source | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [switching, setSwitching] = useState<{ keyId: string; model: string } | null>(null);
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  // /organize's settings while its panel is open.
  const [organizing, setOrganizing] = useState<OrganizeOptions | null>(null);
  const [pickerIdx, setPickerIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const justCreated = useRef<string | null>(null);

  // A question typed on the landing page before signing in: put it in the box,
  // ready to send.
  useEffect(() => {
    const pending = takePendingQuestion();
    if (pending) {
      setInput(pending);
      inputRef.current?.focus({ preventScroll: true });
    }
  }, []);

  // Model: the last one used, if it still exists.
  const { prefs, ready: prefsReady } = usePreferences();
  useEffect(() => {
    setKeyId(keys.find((k) => k.id === localStorage.getItem(LAST_KEY))?.id ?? keys[0]?.id ?? "");
  }, [keys]);

  // System prompt: a new chat starts with the default from Settings (none,
  // unless one is chosen there). Changing it in a chat doesn't change the
  // default. A default prompt that was deleted counts as none.
  const defaultPromptId = prompts.some((p) => p.id === prefs.chatDefaultPrompt)
    ? prefs.chatDefaultPrompt
    : "";
  useEffect(() => {
    if (prefsReady && !conversationId) setPromptId(defaultPromptId);
  }, [prefsReady, conversationId, defaultPromptId]);

  // Starting mode and search strategies come from Settings: a fixed mode, or
  // whatever was used last. Once, when preferences load, so changing either
  // mid-chat isn't undone.
  useEffect(() => {
    if (!prefsReady) return;
    setStrategies(prefs.chatStrategies);
    if (prefs.chatStartMode !== "last") return setMode(prefs.chatStartMode);
    const savedMode = localStorage.getItem(LAST_MODE) as ChatMode | null;
    // Never restore a permissive mode from a value we don't recognise.
    if (savedMode && MODE_VALUES.includes(savedMode)) setMode(savedMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsReady]);

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
          Object.fromEntries(rows.map((r) => [r.id, { planId: r.id, status: r.status, actions: r.actions }])),
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
      if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + chunk };
      return copy;
    });

  /** Send a message. `organize` makes it an /organize run: the agent gets the
   *  settings, and a read-only chat moves to Ask first so it can propose. */
  const send = async (text?: string, organize?: OrganizeOptions, modeOverride?: ChatMode) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    setAddOpen(false);
    const runMode = modeOverride ?? mode;
    // Slash commands run locally — no model call, so no conversation is created
    // and nothing is persisted or shown in the chat; they answer with a toast or
    // a picker. Dispatched before the key check so /help works with nothing set
    // up; each command states its own requirements.
    if (!organize && q.startsWith("/")) {
      report(await runCommand(q));
      return;
    }
    if (!keyId) return;
    setMessages((p) => {
      setLiveIdx(p.length + 1); // the assistant placeholder — type this one out
      return [...p, { role: "user", content: q }, { role: "assistant", content: "" }];
    });
    setBusy(true);
    const abort = new AbortController();
    sendAbort.current = abort;
    setLiveRun({ mode: runMode, startedAt: Date.now() });
    let createdHere: string | null = null;
    try {
      let cid = conversationId;
      if (!cid) {
        const convo = await authed((t) => api.createConversation(t));
        justCreated.current = convo.id;
        createdHere = convo.id;
        cid = convo.id;
        onActivate(convo); // add to sidebar + mark active (no remount)
      }
      await authed((t) =>
        api.agentChatStream(
          t,
          {
            conversationId: cid,
            keyId,
            promptId: promptId || null,
            message: q,
            mode: runMode,
            strategies,
            organize: organize ?? null,
          },
          appendToLast,
          abort.signal,
        ),
      );
      onActivity();
    } catch (err) {
      if (abort.signal.aborted) {
        // Stopped by the user: keep what came in, marked as stopped. The server
        // only saves a finished turn, so a reload won't show this one.
        appendToLast(`\x1e${JSON.stringify({ kind: "error", detail: "Stopped before finishing." })}\n`);
      } else {
        setError(err instanceof ApiError ? err.detail : "Something went wrong");
        setMessages((p) => (p[p.length - 1]?.content ? p : p.slice(0, -1)));
        if (createdHere) onDiscard?.(createdHere);
      }
    } finally {
      sendAbort.current = null;
      setLiveRun(null);
      setBusy(false);
    }
  };

  const onKey = (id: string) => {
    setKeyId(id);
    localStorage.setItem(LAST_KEY, id);
  };
  const onPrompt = (id: string) => setPromptId(id);
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

  /** "Want it different?": Bao comes up over the same plan and works on it.
   *  The reply streams into a side buffer while the message stays as it is
   *  (the card dims, Bao shows the note and what it's doing), then the plan is
   *  swapped in place in one step. A failed run leaves the old plan untouched;
   *  the server only retires it once the new reply is saved. */
  const revisePlan = async (plan: PlanState, note: string, fix = false) => {
    if (busy || !keyId || !conversationId) return;
    const idx = messages.findIndex((m) => m.role === "assistant" && m.content.includes(plan.planId));
    if (idx === -1) return;
    let runMode = mode;
    if (mode === "read_only") {
      runMode = "ask";
      onMode("ask");
      report(done("Switched to Ask first, so it can propose moves for you to approve."));
    }
    setError(null);
    setRevising({ planId: plan.planId, note, mode: runMode, buffer: "", startedAt: Date.now() });
    setBusy(true);
    const abort = new AbortController();
    reviseAbort.current = abort;
    let buffer = "";
    try {
      await authed((tk) =>
        api.agentChatStream(
          tk,
          {
            conversationId,
            keyId,
            promptId: promptId || null,
            message: note,
            mode: runMode,
            strategies,
            // A fix redoes an applied plan's failed changes; a revision replaces
            // a pending plan. Either way the reply lands in this same message.
            organize: fix ? null : (plan.organize ?? null),
            revises: fix ? null : plan.planId,
            fixes: fix ? plan.planId : null,
          },
          (chunk) => {
            buffer += chunk;
            setRevising((r) => (r ? { ...r, buffer } : r));
          },
          abort.signal,
        ),
      );
      if (buffer.trim()) {
        // Bao cheers for a beat on the old card, then the new plan takes its place.
        setRevising((r) => (r ? { ...r, buffer, done: true } : r));
        await new Promise((ok) => setTimeout(ok, 1100));
        // Swap the plan in place: the trail of notes, then the new reply.
        setMessages((p) =>
          p.map((m, i) =>
            i === idx ? { ...m, content: revisionEvents(m.content) + revisedEvent(note) + buffer } : m,
          ),
        );
        if (!fix) onPlanChange({ ...plan, status: "discarded" }); // an applied plan stays applied
        onActivity();
      }
    } catch (err) {
      // Stopped by the user: the old plan simply stays; nothing to report.
      if (!abort.signal.aborted) setError(err instanceof ApiError ? err.detail : "Something went wrong");
    } finally {
      reviseAbort.current = null;
      setRevising(null);
      setBusy(false);
    }
  };

  const activeKey = keys.find((k) => k.id === keyId);
  const { caps } = useModelCapabilities(activeKey);
  // A command's result, shown just above the composer for a few seconds.
  const [notice, setNotice] = useState<Outcome | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const report = (o: Outcome | null) => {
    if (!o) return;
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(o);
    noticeTimer.current = setTimeout(() => setNotice(null), o.ok ? 3500 : 6000);
  };
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  /** Save settings to a key (the current one unless given). Shown at once; put
   *  back if it fails. */
  const saveParams = async (patch: KeyParams, target: AiKey | undefined = activeKey): Promise<boolean> => {
    if (!target) return false;
    const before = target;
    onKeyUpdated?.({ ...target, ...patch } as AiKey);
    setSavingKeyId(target.id);
    try {
      onKeyUpdated?.(await authed((t) => api.updateAiKey(t, before.id, keyUpdate(before, patch))));
      return true;
    } catch (err) {
      onKeyUpdated?.(before);
      report(fail(err instanceof ApiError ? err.detail : "Couldn't save that setting."));
      return false;
    } finally {
      setSavingKeyId(null);
    }
  };

  /** Move the current key to another of its provider's models. The server
   *  tries the model once and fits the key's settings to it (an effort level it
   *  lacks moves to the nearest one), and says what the model takes, which is
   *  remembered so the quick settings needn't ask again. */
  const switchModel = async (model: string, target: AiKey | undefined = activeKey): Promise<Outcome> => {
    const before = target;
    if (!before) return fail("Add a key first.");
    if (model === before.model) return done(`Already using ${model}.`);
    setSwitching({ keyId: before.id, model });
    try {
      const saved = await authed((t) => api.updateAiKey(t, before.id, keyUpdate(before, { model })));
      if (saved.check) rememberModelCheck(saved.base_url, saved.model, saved.check);
      onKeyUpdated?.(saved);
      const notes: string[] = [];
      if (before.reasoning_effort && saved.reasoning_effort !== before.reasoning_effort)
        notes.push(
          saved.reasoning_effort
            ? `effort moved to ${EFFORT_LABELS[saved.reasoning_effort]}`
            : "it has no effort setting",
        );
      if (saved.check?.unsupported.includes("temperature")) notes.push("it sets its own temperature");
      return done(`Now using ${model}${notes.length ? `: ${notes.join(", ")}` : ""}.`);
    } catch (err) {
      return fail(err instanceof ApiError ? `${model}: ${err.detail}` : `Couldn't switch to ${model}.`);
    } finally {
      setSwitching(null);
    }
  };

  const openPicker = (next: Picker) => {
    setPicker(next);
    setNotice(null);
    setPickerIdx(
      Math.max(
        0,
        next.options.findIndex((o) => o.value === next.current),
      ),
    );
    inputRef.current?.focus({ preventScroll: true });
  };

  const choosePicker = async (value: string) => {
    const p = picker;
    if (!p) return;
    setPicker(null);
    if (p.searchable) setInput("");
    report(await p.pick(value));
  };

  const effortCommand = (rest: string): Promise<Outcome | null> | Outcome | null => {
    if (!activeKey) return fail("Add a key first.");
    const offered = caps?.efforts ?? null;
    if (offered && offered.length === 0)
      return fail(`${activeKey.model} doesn't take a reasoning effort: it answers without a thinking step.`);
    const levels = offered ?? EFFORT_ORDER;
    const setTo = async (value: string): Promise<Outcome> => {
      const effort = value === "auto" ? null : (value as ReasoningEffort);
      if (!(await saveParams({ reasoning_effort: effort }))) return fail("Couldn't change the effort.");
      return done(
        effort
          ? `Reasoning effort: ${EFFORT_LABELS[effort]}.`
          : "Reasoning effort: Auto, the lowest it takes.",
      );
    };
    const word = rest
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    if (!word) {
      openPicker({
        command: "/effort",
        title: `Reasoning effort · ${activeKey.model}`,
        current: activeKey.reasoning_effort ?? "auto",
        options: [
          { value: "auto", label: "Auto", hint: "The lowest it takes. Quickest and cheapest" },
          ...levels.map((l) => ({ value: l, label: EFFORT_LABELS[l], hint: EFFORT_HINTS[l] })),
        ],
        pick: setTo,
      });
      return null;
    }
    const wanted = word === "automatic" ? "auto" : word === "extrahigh" || word === "max" ? "xhigh" : word;
    if (wanted !== "auto" && !(isEffort(wanted) && levels.includes(wanted)))
      return fail(`${activeKey.model} has no “${rest.trim()}” level. Try ${["auto", ...levels].join(", ")}.`);
    return setTo(wanted);
  };

  const temperatureCommand = (rest: string): Promise<Outcome | null> | Outcome | null => {
    if (!activeKey) return fail("Add a key first.");
    if (caps?.unsupported.includes("temperature"))
      return fail(`${activeKey.model} doesn't take a temperature: it sets its own.`);
    const setTo = async (value: string): Promise<Outcome> => {
      const t = Number(value);
      if (!(await saveParams({ temperature: t }))) return fail("Couldn't change the temperature.");
      return done(`Temperature: ${t}.`);
    };
    if (!rest.trim()) {
      openPicker({
        command: "/temperature",
        title: `Temperature · ${activeKey.model}`,
        current: String(activeKey.temperature),
        options: TEMPERATURE_PRESETS.map((p) => ({ value: String(p.value), label: p.label, hint: p.hint })),
        pick: setTo,
      });
      return null;
    }
    const t = Number(rest.trim());
    if (!Number.isFinite(t) || t < 0 || t > 2)
      return fail("Temperature goes from 0 to 2, e.g. /temperature 0.7");
    return setTo(String(Math.round(t * 100) / 100));
  };

  const tokensCommand = (rest: string): Promise<Outcome | null> | Outcome | null => {
    if (!activeKey) return fail("Add a key first.");
    const setTo = async (value: string): Promise<Outcome> => {
      const n = Number(value);
      if (!(await saveParams({ max_tokens: n }))) return fail("Couldn't change the length.");
      return done(`Max tokens: ${n.toLocaleString()}.`);
    };
    if (!rest.trim()) {
      openPicker({
        command: "/tokens",
        title: `Max tokens · ${activeKey.model}`,
        current: String(activeKey.max_tokens),
        options: TOKEN_PRESETS.map((n) => ({
          value: String(n),
          label: tokensLabel(n),
          hint: `${n.toLocaleString()} tokens`,
        })),
        pick: setTo,
      });
      return null;
    }
    const m = /^(\d+(?:\.\d+)?)\s*(k)?$/i.exec(rest.trim());
    const n = m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 32000)
      return fail("Max tokens goes from 1 to 32,000, e.g. /tokens 4k");
    return setTo(String(n));
  };

  /** /model: another model on the same key. Bare, it opens the picker. */
  const modelCommand = async (rest: string): Promise<Outcome | null> => {
    if (!activeKey) return fail("Add a key first.");
    const key = activeKey;
    const typed = rest.trim();
    const asOptions = (models: string[]) => {
      // The current model may be missing from the list (typed by hand once).
      const all = models.includes(key.model) ? models : [key.model, ...models];
      return all.map((m) => ({ value: m, label: m }));
    };
    if (!typed) {
      openPicker({
        command: "/model",
        title: `Model · ${key.name}`,
        current: key.model,
        options: asOptions([]),
        pick: switchModel,
        searchable: true,
        allowCustom: true,
        loading: true,
      });
      loadKeyModels(authed, key)
        .then((models) => {
          const options = asOptions(models);
          setPicker((p) => (p?.command === "/model" ? { ...p, options, loading: false } : p));
          setPickerIdx(
            Math.max(
              0,
              options.findIndex((o) => o.value === key.model),
            ),
          );
        })
        .catch((err) =>
          setPicker((p) =>
            p?.command === "/model"
              ? {
                  ...p,
                  loading: false,
                  error: `${err instanceof ApiError ? err.detail : "Couldn't load the models."} Type a name to use it.`,
                }
              : p,
          ),
        );
      return null;
    }
    // Match against the provider's list when we can; otherwise try the name
    // as typed (the server checks it with the provider either way).
    let model = typed;
    try {
      model = matchModel(await loadKeyModels(authed, key), typed) ?? typed;
    } catch {
      /* no list: use the name as typed */
    }
    return switchModel(model);
  };

  /** /key: switch to another saved key (another provider or account). */
  const keyCommand = (rest: string): Outcome | null => {
    if (!keys.length) return fail("No keys yet. Add one in Settings.");
    const switchTo = (id: string): Outcome => {
      const k = keys.find((x) => x.id === id);
      if (!k) return fail("That key is gone.");
      onKey(id);
      return done(`Now using ${k.name} (${k.model}).`);
    };
    const q = rest.trim().toLowerCase();
    if (!q) {
      openPicker({
        command: "/keys",
        title: "Key",
        current: keyId,
        options: keys.map((k) => ({ value: k.id, label: k.name, hint: k.model })),
        pick: switchTo,
      });
      return null;
    }
    const hit =
      keys.find((k) => k.name.toLowerCase() === q) ?? keys.find((k) => k.name.toLowerCase().startsWith(q));
    return hit ? switchTo(hit.id) : fail(`No key called “${rest.trim()}”. Run /keys to pick one.`);
  };

  /** Start an /organize run with these settings. */
  const startOrganize = (opts: OrganizeOptions) => {
    setOrganizing(null);
    setInput("");
    const run = () => void send(`Organize my drive: ${organizeSummary(opts)}.`, opts);
    if (mode !== "read_only") return run();
    // Read only can't propose changes: ask before switching, never silently.
    openPicker({
      command: "/organize",
      title: "Read only can't change anything. Organizing needs Ask first.",
      current: "",
      options: [
        {
          value: "ask",
          label: "Switch to Ask first and organize",
          hint: "You approve the plan before anything moves",
        },
        { value: "stay", label: "Stay in Read only", hint: "Nothing happens" },
      ],
      pick: (value) => {
        if (value !== "ask") return done("Stayed in Read only.");
        switchToAsk(() => send(`Organize my drive: ${organizeSummary(opts)}.`, opts, "ask"));
        return null;
      },
    });
  };

  /** "Fix with Bao": a short new turn that redoes an applied plan's failed
   *  changes against the folders that now exist, as a fresh plan to approve. */
  const fixFailed = (plan: PlanState) => {
    const n = plan.actions.filter((a) => a.result && !a.result.ok).length;
    // Worked on in place, like a revision: Bao comes onto this card and the
    // fixed plan takes its place in the same message.
    void revisePlan(plan, `Fix the ${n} change${n === 1 ? "" : "s"} that failed`, true);
  };

  /** Move to Ask first, then run what needed it (state settles first). */
  const switchToAsk = (then: () => void | Promise<void>) => {
    onMode("ask");
    report(done("Switched to Ask first: Butler Bao drafts a plan, you approve it."));
    void then();
  };

  /** /organize: bare, it opens its settings; with words, it runs with them. */
  const organizeCommand = (rest: string): Outcome | null => {
    if (!activeKey) return fail("Add a key first.");
    if (!rest.trim()) {
      setPicker(null);
      setNotice(null);
      setOrganizing({ ...DEFAULT_ORGANIZE });
      return null;
    }
    const { opts, unknown } = parseOrganizeArgs(rest);
    if (unknown.length)
      return fail(
        `/organize doesn't know “${unknown.join(" ")}”. Try: ${ORGANIZE_ARGS}, or /organize alone.`,
      );
    startOrganize(opts);
    return null;
  };

  /** /permissions: how much the agent may do on its own. */
  const permissionsCommand = (rest: string): Outcome | null => {
    const setTo = (value: string): Outcome => {
      const m = MODES.find((x) => x.value === value);
      if (!m) return fail("That mode is gone.");
      onMode(m.value as ChatMode);
      return done(`Permissions: ${m.label}. ${m.hint}`);
    };
    const q = rest
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    if (!q) {
      openPicker({
        command: "/permissions",
        title: "Permissions",
        current: mode,
        options: MODES.map((m) => ({ value: m.value, label: m.label, hint: m.hint })),
        pick: setTo,
      });
      return null;
    }
    const hit = MODES.find((m) =>
      [m.value, m.label, m.short ?? ""].some((name) =>
        name
          .toLowerCase()
          .replace(/[\s_-]+/g, "")
          .startsWith(q),
      ),
    );
    return hit
      ? setTo(hit.value)
      : fail(`No “${rest.trim()}” mode. Try ${MODES.map((m) => m.label.toLowerCase()).join(", ")}.`);
  };

  const commands: Command[] = [
    {
      name: "/model",
      args: "[name]",
      hint: "Another model on this key",
      run: modelCommand,
    },
    {
      name: "/effort",
      aliases: ["/efforts", "/reasoning"],
      args: "[auto|low|medium|high]",
      hint: "How hard the model thinks before answering",
      run: effortCommand,
    },
    {
      name: "/temperature",
      aliases: ["/temp"],
      args: "[0-2]",
      hint: "Precise (0) to creative (2)",
      run: temperatureCommand,
    },
    {
      name: "/tokens",
      aliases: ["/max-tokens"],
      args: "[number]",
      hint: "The longest a reply may be",
      run: tokensCommand,
    },
    {
      name: "/keys",
      aliases: ["/key"],
      args: "[name]",
      hint: "Switch to another saved key",
      run: keyCommand,
    },
    {
      name: "/permissions",
      aliases: ["/permission", "/mode"],
      args: "[read only|ask|auto|full]",
      hint: "How much I may do on my own",
      run: permissionsCommand,
    },
    {
      name: "/organize",
      aliases: ["/organise", "/tidy"],
      args: ORGANIZE_ARGS,
      hint: "Sort the whole drive into folders. Never renames unless you say",
      run: organizeCommand,
    },
    {
      name: "/index",
      args: "[all]",
      hint: "Index new files. “/index all” redoes every file",
      run: (rest) => {
        if (!keyId) return fail("Add a key first.");
        if (!activeKey?.embedding_model)
          return fail(
            `${activeKey?.name ?? "This key"} has no embedding model. Add one in Settings to index.`,
          );
        if (indexing.running) return fail("Already indexing. See the progress card.");
        const everything = rest.trim() === "all";
        // Plain /index catches up; "all" rebuilds, since a catch-up would skip
        // everything already current.
        indexing.start({ keyId, all: true, remaining: !everything, force: everything });
        return done(everything ? "Rebuilding the index for every file." : "Indexing whatever's left.");
      },
    },
    {
      // TEMPORARY: a one-time revert of Bao's applied plans. Removed once used.
      name: "/undo",
      hint: "Undo every change Bao applied in this chat, newest first",
      run: async () => {
        if (!conversationId)
          return fail("Open the chat whose changes you want undone, then run /undo there.");
        const plans = await authed((tk) => api.agentPlans(tk, conversationId));
        const applied = plans
          .filter((pl) => pl.status === "applied")
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (!applied.length) {
          toast("Nothing to undo: no applied plans in this chat.", "error");
          return fail("Nothing applied in this chat to undo.");
        }
        const label = `${applied.length} plan${applied.length === 1 ? "" : "s"}`;
        toast(`Undoing Bao's changes from ${label}…`);
        setNotice({ ok: true, text: `Undoing Bao's changes from ${label}…` }); // stays up while it runs
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        let undone = 0;
        const stuck: string[] = [];
        let broken = 0;
        for (const pl of applied) {
          try {
            const res = await authed((tk) => api.undoAgentPlan(tk, pl.id));
            undone += res.undone;
            stuck.push(...res.not_undone.map((n) => `${n.label}: ${n.detail}`));
            setPlans((prev) => ({
              ...prev,
              [pl.id]: { planId: pl.id, status: "undone", actions: pl.actions },
            }));
          } catch {
            broken += 1; // keep going: the other plans can still be undone
          }
        }
        onActivity();
        const summary = `Undid ${undone} change${undone === 1 ? "" : "s"} from ${label}.`;
        const problems = [
          stuck.length
            ? `${stuck.length} couldn't be undone (${stuck.slice(0, 2).join("; ")}${stuck.length > 2 ? "…" : ""})`
            : "",
          broken ? `${broken} plan${broken === 1 ? "" : "s"} failed to undo; run /undo again` : "",
        ].filter(Boolean);
        toast(
          problems.length ? `${summary} ${problems.join(". ")}.` : summary,
          problems.length ? "error" : "success",
        );
        return problems.length ? fail(`${summary} ${problems.join(". ")}.`) : done(summary);
      },
    },
    {
      name: "/stop",
      hint: "Stop the indexing run in progress",
      run: () => {
        if (!indexing.running) return fail("Nothing is indexing right now.");
        indexing.cancel();
        return done("Stopped. Finished files stay indexed.");
      },
    },
    {
      name: "/help",
      hint: "All commands",
      run: () => {
        openPicker({
          command: "/help",
          title: "Commands",
          current: "",
          options: commands
            .filter((c) => c.name !== "/help")
            .map((c) => ({ value: c.name, label: c.name, hint: c.hint })),
          pick: (name) => runCommand(name),
        });
        return null;
      },
    },
  ];

  /** Run a slash command. Returns null if the text isn't one; otherwise what
   *  happened (null too when it opened a picker). Nothing is added to the chat. */
  const runCommand = async (text: string): Promise<Outcome | null> => {
    const [word, ...rest] = text.slice(1).split(/\s+/);
    const typed = `/${(word ?? "").toLowerCase()}`;
    const cmd = commands.find((c) => c.name === typed || c.aliases?.includes(typed));
    if (!cmd) return fail(`There's no /${word} command. Type / to see them all.`);
    try {
      return await cmd.run(rest.join(" "));
    } catch {
      return fail(`${cmd.name} failed. Try again.`);
    }
  };

  const pickerOptions = picker ? pickerRows(picker, input) : [];
  const pickerListRef = useRef<HTMLDivElement>(null);
  // The picker opens upward, so it may only be as tall as the room above the
  // composer: little on the empty-chat screen, where the composer sits mid-page.
  const composerRef = useRef<HTMLDivElement>(null);
  const [pickerMax, setPickerMax] = useState(384);
  useLayoutEffect(() => {
    if ((!picker && !organizing) || !composerRef.current) return;
    const top = composerRef.current.getBoundingClientRect().top;
    setPickerMax(Math.max(160, Math.min(384, top - 72)));
  }, [picker, organizing, messages.length]);
  useEffect(() => {
    pickerListRef.current
      ?.querySelector<HTMLElement>(`[data-index="${pickerIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [pickerIdx, picker]);

  // Suggestions while typing a bare "/word" (not once arguments start).
  const suggestions =
    /^\/\S*$/.test(input) && !busy && !picker
      ? commands.filter((c) => c.name.startsWith(input.toLowerCase()))
      : [];

  // Wide when the chat has the screen; back to a reading width beside an open
  // document.
  const column = openFile ? "max-w-3xl" : "max-w-5xl";

  const activeStrategies = [...SEARCH_ADDONS, ...ANSWER_ADDONS].filter((a) => strategies[a.key]).length;

  /** Live state for whichever plan this message proposed, if we know it. */
  const planFor = (content: string): PlanState | null => {
    const match = /"plan_id":\s*"([0-9a-f-]{36})"/.exec(content);
    return match?.[1] ? (plans[match[1]] ?? null) : null;
  };

  const composer = (
    <div ref={composerRef} className="relative w-full">
      {addOpen ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAddOpen(false)} />
          <div
            className="dropdown-menu absolute bottom-full left-0 z-20 mb-2 w-[min(21rem,calc(100vw-2rem))] rounded-2xl border border-zinc-200/80 bg-white p-2"
            style={{ boxShadow: "var(--shadow-popover)" }}
          >
            {/* System prompt: a searchable dropdown, since the list can be long */}
            <div className="flex items-baseline justify-between px-2 pb-1.5 pt-1">
              <p className="text-[0.8125rem] font-medium text-zinc-700">System prompt</p>
              {prompts.length && onOpenSettings ? (
                <button
                  type="button"
                  onClick={() => onOpenSettings({ tab: "prompts" })}
                  className="text-[0.75rem] text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
                >
                  Manage
                </button>
              ) : null}
            </div>
            {prompts.length ? (
              <div className="px-1">
                <Dropdown
                  block
                  searchable
                  ariaLabel="System prompt"
                  value={promptId}
                  onChange={onPrompt}
                  options={[{ id: "", name: "No system prompt", content: "" }, ...prompts].map((p) => ({
                    value: p.id,
                    label: p.id === defaultPromptId ? `${p.name} (default)` : p.name,
                    keywords: p.content.slice(0, 200),
                    hint: p.id ? promptPreview(p.content) : "Answer with the built-in instructions only",
                  }))}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[0.875rem] text-zinc-900 hover:border-zinc-400"
                />
              </div>
            ) : onOpenSettings ? (
              <button
                type="button"
                onClick={() => onOpenSettings({ tab: "prompts", newPrompt: true })}
                className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-2.5 py-2 text-left text-[0.875rem] text-zinc-700 transition-colors hover:border-zinc-900 hover:text-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" /> Create a system prompt
              </button>
            ) : (
              <p className="px-2 text-[0.875rem] text-zinc-500">No system prompts yet</p>
            )}

            <div className="my-2 h-px bg-zinc-200" />

            {[
              { title: "Search add-ons", addons: SEARCH_ADDONS },
              { title: "Answer", addons: ANSWER_ADDONS },
            ].map((group, gi) => (
              <div key={group.title} className={gi ? "mt-1.5 border-t border-zinc-200 pt-2" : ""}>
                <p className="px-2 pb-1 text-[0.8125rem] font-medium text-zinc-700">{group.title}</p>
                <div className="space-y-0.5">
                  {group.addons.map((a) => (
                    <div
                      key={a.key}
                      className="flex items-center gap-3 rounded-xl px-2.5 py-1.5 hover:bg-zinc-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate text-[0.875rem] text-zinc-900">{a.label}</span>
                          <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-px font-mono text-[0.6875rem] text-zinc-500">
                            {a.tech}
                          </span>
                        </span>
                        <span className="block truncate text-[0.75rem] text-zinc-500">{a.hint}</span>
                      </span>
                      <Toggle
                        label={a.label}
                        checked={!!strategies[a.key]}
                        onChange={() => setStrategies((p) => ({ ...p, [a.key]: !p[a.key] }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {organizing ? (
        <OrganizePanel
          value={organizing}
          onChange={setOrganizing}
          onStart={() => startOrganize(organizing)}
          onClose={() => setOrganizing(null)}
          applies={mode === "auto" || mode === "full"}
          maxHeight={pickerMax}
        />
      ) : picker ? (
        <div
          role="listbox"
          aria-label={picker.title}
          className="menu-surface absolute bottom-full left-0 right-0 z-20 mb-2 flex flex-col p-1.5"
          style={{ maxHeight: pickerMax }}
        >
          <div className="flex shrink-0 items-baseline justify-between gap-3 px-2.5 pb-1.5 pt-1">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-[0.8125rem] font-medium text-zinc-900">
              {picker.searchable ? <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : null}
              {picker.title}
              {picker.loading ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" />
              ) : null}
            </p>
            <p className="shrink-0 text-[0.6875rem] text-zinc-400">
              {picker.searchable ? "Type to filter · " : ""}↑↓ move · Enter pick · Esc close
            </p>
          </div>
          {picker.error && !input.trim() ? (
            <p className="px-2.5 pb-1.5 text-[0.8125rem] text-zinc-500">{picker.error}</p>
          ) : null}
          <div ref={pickerListRef} className="thin-scroll min-h-0 overflow-y-auto">
            {pickerOptions.length === 0 && !picker.loading ? (
              <p className="px-2.5 py-2 text-[0.875rem] text-zinc-500">Nothing matches “{input.trim()}”.</p>
            ) : null}
            {pickerOptions.map((o, i) => {
              const on = o.value === picker.current;
              const lit = i === pickerIdx;
              return (
                <button
                  key={`${o.value}-${i}`}
                  data-index={i}
                  type="button"
                  role="option"
                  aria-selected={lit}
                  onMouseEnter={() => setPickerIdx(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void choosePicker(o.value)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    lit ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-100"
                  }`}
                >
                  {picker.searchable ? null : (
                    <span
                      className={`w-4 shrink-0 text-center font-mono text-[0.75rem] ${lit ? "text-white/60" : "text-zinc-400"}`}
                    >
                      {i < 9 ? i + 1 : ""}
                    </span>
                  )}
                  <span
                    className={`truncate ${picker.searchable ? "font-mono text-[0.8125rem]" : "text-[0.9375rem]"}`}
                  >
                    {o.label}
                  </span>
                  {o.hint ? (
                    <span
                      className={`min-w-0 flex-1 truncate text-[0.8125rem] ${lit ? "text-white/70" : "text-zinc-500"}`}
                    >
                      {o.hint}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {on ? (
                    <Check className={`h-4 w-4 shrink-0 ${lit ? "text-white" : "text-zinc-900"}`} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : switching && !suggestions.length && !addOpen ? (
        <div className="pointer-events-none absolute bottom-full left-0 right-0 z-20 mb-2 flex justify-center px-2">
          <p
            role="status"
            className="notice-in flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3.5 py-2 text-[0.875rem] text-zinc-700"
            style={{ boxShadow: "var(--shadow-popover)" }}
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            Trying <span className="font-mono text-[0.8125rem] text-zinc-900">{switching.model}</span>…
          </p>
        </div>
      ) : notice && !suggestions.length && !addOpen ? (
        <div className="pointer-events-none absolute bottom-full left-0 right-0 z-20 mb-2 flex justify-center px-2">
          <button
            type="button"
            role="status"
            onClick={() => setNotice(null)}
            title="Dismiss"
            className={`notice-in pointer-events-auto flex max-w-full items-start gap-2 rounded-2xl border px-3.5 py-2 text-left text-[0.875rem] ${
              notice.ok ? "border-zinc-200 bg-white text-zinc-800" : "border-red-200 bg-red-50 text-red-700"
            }`}
            style={{ boxShadow: "var(--shadow-popover)" }}
          >
            {notice.ok ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0">{notice.text}</span>
          </button>
        </div>
      ) : null}

      {suggestions.length ? (
        <div
          role="listbox"
          aria-label="Commands"
          className="menu-surface absolute bottom-full left-0 right-0 z-20 mb-2 p-1.5"
        >
          {suggestions.map((c, i) => {
            const lit = i === Math.min(suggestIdx, suggestions.length - 1);
            return (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={lit}
                onMouseEnter={() => setSuggestIdx(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void send(c.name)}
                className={`flex w-full items-baseline gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors ${
                  lit ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-100"
                }`}
              >
                <span className="font-mono text-[0.8125rem]">{c.name}</span>
                {c.args ? (
                  <span className={`font-mono text-[0.8125rem] ${lit ? "text-white/60" : "text-zinc-400"}`}>
                    {c.args}
                  </span>
                ) : null}
                <span
                  className={`min-w-0 flex-1 truncate text-[0.8125rem] ${lit ? "text-white/70" : "text-zinc-500"}`}
                >
                  {c.hint}
                </span>
              </button>
            );
          })}
          <p className="px-2.5 pb-0.5 pt-1.5 text-[0.6875rem] text-zinc-400">
            Enter run · Tab fill in · ↑↓ move · Esc close
          </p>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        data-mode={mode} // the border's moving arc shows the permission mode (globals.css, .mode-ring)
        className="mode-ring flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-3 transition-colors focus-within:border-zinc-900"
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
            if (picker?.searchable) setPickerIdx(0);
          }}
          onKeyDown={(e) => {
            if (organizing) {
              // The panel's own controls are clicked; from the composer, Enter
              // starts and Esc closes. Typing closes it and carries on.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                startOrganize(organizing);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setOrganizing(null);
                return;
              }
              if (e.key.length === 1) setOrganizing(null);
            }
            if (picker) {
              const count = pickerOptions.length;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (count) setPickerIdx((i) => (i + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const o = pickerOptions[Math.min(pickerIdx, count - 1)];
                if (o) void choosePicker(o.value);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                if (picker.searchable) setInput("");
                setPicker(null);
                return;
              }
              // A searchable picker filters on what's typed; it stays open.
              if (picker.searchable) return;
              if (/^[1-9]$/.test(e.key) && !input) {
                const o = picker.options[Number(e.key) - 1];
                if (o) {
                  e.preventDefault();
                  void choosePicker(o.value);
                  return;
                }
              }
              // Typing anything else closes it and carries on as normal.
              setPicker(null);
            }
            if (suggestions.length) {
              // While the command menu is open the arrows and Tab drive it, and
              // Enter completes rather than sending a half-typed command.
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestIdx(
                  (i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length,
                );
                return;
              }
              const pick = suggestions[Math.min(suggestIdx, suggestions.length - 1)];
              // Tab fills the command in and waits for its argument; Enter
              // runs it as it is (bare, it opens its picker).
              if (e.key === "Tab" && pick) {
                e.preventDefault();
                setInput(pick.args ? `${pick.name} ` : pick.name);
                setSuggestIdx(0);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && pick) {
                e.preventDefault();
                void send(pick.name);
                return;
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
            picker?.searchable
              ? "Search models, or type a name…"
              : mode === "read_only"
                ? "Ask across your drive…"
                : "Ask, or / for commands…"
          }
          className="hair-scroll min-h-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1.5 text-[0.9375rem] leading-6 text-zinc-900 outline-none placeholder:truncate placeholder:text-[0.875rem] placeholder:text-zinc-400"
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
    <div className="flex min-h-0 w-full flex-1">
      {/* Chat column (hidden behind the canvas on mobile; narrows on desktop) */}
      <div className={`min-h-0 min-w-0 flex-1 flex-col ${openFile ? "hidden md:flex" : "flex"}`}>
        {/* Top bar: model picker (top-left, ChatGPT-style) */}
        <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
          {onOpenSidebar ? (
            <RingButton label="Open sidebar" onClick={onOpenSidebar} className="md:hidden">
              <Menu className="h-4 w-4" />
            </RingButton>
          ) : null}
          <KeyPicker
            keys={keys}
            activeKey={activeKey}
            onPick={(id) => {
              onKey(id);
              const k = keys.find((x) => x.id === id);
              if (k) report(done(`Now using ${k.name} (${k.model}).`));
            }}
            onAddKey={onOpenSettings ? () => onOpenSettings({ tab: "keys", newKey: true }) : undefined}
            onSave={(key, patch) => void saveParams(patch, key)}
            savingKeyId={savingKeyId}
            onModel={(key, model) => void switchModel(model, key).then(report)}
            switching={switching}
            onAllSettings={onOpenSettings ? () => onOpenSettings({ tab: "keys" }) : undefined}
          />
          {indexing.running ? (
            <button
              type="button"
              onClick={() => onOpenSettings?.({ tab: "index", indexKeyId: keyId })}
              title="See indexing progress"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-900/25 px-2 py-0.5 text-[0.8125rem] text-zinc-900 transition hover:bg-zinc-100"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              indexing {indexing.done}/{indexing.total}
            </button>
          ) : idxStatus ? (
            <button
              type="button"
              onClick={() => onOpenSettings?.({ tab: "index", indexKeyId: keyId })}
              title="Manage indexing"
              className="hidden shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[0.8125rem] text-zinc-500 transition hover:border-zinc-900 hover:text-zinc-900 sm:block"
            >
              {idxStatus.indexed}/{idxStatus.total} files indexed
            </button>
          ) : null}
        </div>

        {loadingMsgs ? (
          <>
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
              <ConversationSkeleton />
            </div>
            <div className={`mx-auto w-full ${column} px-4 pb-5 opacity-50`}>{composer}</div>
          </>
        ) : messages.length === 0 ? (
          /* Home state */
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
            {/* A new line each time a chat starts; reserved height so the
                composer doesn't jump when it arrives. */}
            <h2 className="mb-6 min-h-[1.3em] max-w-2xl text-balance text-center type-heading-sm">
              {greeting ? <span className="greeting-in inline-block">{greeting}</span> : null}
            </h2>
            <div className={`w-full ${openFile ? "max-w-2xl" : "max-w-3xl"}`}>{composer}</div>
            <p className="mt-3 text-[0.8125rem] text-zinc-400">
              {mode === "read_only"
                ? "Answers are grounded in your indexed files."
                : "I can tidy your drive. The button sets how much I can do on my own."}
            </p>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
              <div className={`mx-auto ${column} space-y-5 px-4 py-4`}>
                {messages.map((m, i) =>
                  m.role === "user" ? (
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
                        onReply={i === messages.length - 1 && !busy ? (text) => void send(text) : undefined}
                        onRevise={busy ? undefined : (plan, note) => void revisePlan(plan, note)}
                        revising={revising && m.content.includes(revising.planId) ? revising : null}
                        onStopRevise={() => reviseAbort.current?.abort()}
                        onFixFailed={busy ? undefined : fixFailed}
                        onSwitchMode={
                          i === messages.length - 1 && !busy
                            ? (retry) => switchToAsk(() => send(retry, undefined, "ask"))
                            : undefined
                        }
                        working={
                          i === messages.length - 1 && liveRun
                            ? { ...liveRun, onStop: () => sendAbort.current?.abort() }
                            : null
                        }
                      />
                    </div>
                  ),
                )}
                {error ? <p className="text-[0.9375rem] text-red-500">{error}</p> : null}
              </div>
            </div>
            <div className={`mx-auto w-full ${column} px-4 pb-5`}>{composer}</div>
          </>
        )}
      </div>

      {openFile ? <FileCanvas source={openFile} onClose={() => setOpenFile(null)} /> : null}
    </div>
  );
}
