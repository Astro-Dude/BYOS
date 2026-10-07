"use client";

import type { AgentMode } from "@byos/api-client";
import {
  ChevronRight,
  CornerDownLeft,
  FileText,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { PlanCard, type PlanState } from "@/components/byok/plan-card";
import { BaoBuilder, BaoWorksite, progressOf } from "@/components/byok/bao-builder";
import { ModeAvatar } from "@/components/mode-avatar";
import { Working } from "@/components/byok/working";
import { MD_CLASS, MD_PLUGINS, splitThought } from "@/components/dashboard/chat-format";
import { stepLabel } from "@/lib/step-labels";

/** A file the answer drew on. Stored with the message as a reference only (id,
 *  name, the quoted words), so it shows on reload and even after the file is
 *  deleted. `quotes` are marked when the file is opened. */
export type Source = { id: string; name: string; quotes?: string[] };
type Step = { label: string; detail: string };
/** A change that was applied live (auto/full mode), streamed as it happened. */
type Applied = { label: string; detail: string; failed?: boolean };
/** A clarifying question the agent stopped to ask, with answers to tap. */
export type Question = { question: string; options: string[] };

/** Pull control events (`\x1e{json}\n`) out of the stream wherever they appear —
 *  steps come before the answer, the sources event after it — and treat the
 *  remaining text as the answer. */
/** A plan being revised: the user's note, the mode Bao is working in, and the
 *  new reply streaming in (shown only as progress until it's done). */
export type Revising = {
  planId: string;
  note: string;
  mode: AgentMode;
  buffer: string;
  /** The new plan is in: Bao cheers for a moment before it's swapped in. */
  done?: boolean;
  /** When the run started, for the bubble's timer. */
  startedAt: number;
};

function parseStream(content: string): {
  steps: Step[];
  sources: Source[];
  applied: Applied[];
  plan: PlanState | null;
  question: Question | null;
  /** The user's "change something" notes, oldest first, for a revised plan. */
  revisions: string[];
  /** Read only was asked to change things: offer Ask first and resend this. */
  switchTo: { mode: string; retry: string } | null;
  answer: string;
  error?: string;
} {
  const steps: Step[] = [];
  const applied: Applied[] = [];
  let sources: Source[] = [];
  let plan: PlanState | null = null;
  let question: Question | null = null;
  const revisions: string[] = [];
  let switchTo: { mode: string; retry: string } | null = null;
  let error: string | undefined;
  let answer = "";
  let i = 0;
  while (i < content.length) {
    if (content[i] === "\x1e") {
      const nl = content.indexOf("\n", i);
      if (nl === -1) break; // trailing event still arriving
      try {
        const evt = JSON.parse(content.slice(i + 1, nl));
        if (evt.kind === "step") steps.push({ label: stepLabel(evt.label), detail: evt.detail ?? "" });
        else if (evt.kind === "sources") sources = evt.sources ?? [];
        else if (evt.kind === "applied")
          applied.push({ label: evt.label, detail: evt.detail ?? "", failed: evt.failed });
        else if (evt.kind === "plan")
          plan = {
            planId: evt.plan_id,
            status: evt.status ?? "pending",
            actions: evt.actions ?? [],
            preview: evt.preview ?? null,
            organize: evt.organize ?? null,
          };
        else if (evt.kind === "question")
          question = {
            question: String(evt.question ?? ""),
            options: Array.isArray(evt.options) ? evt.options.map(String) : [],
          };
        else if (evt.kind === "revised") revisions.push(String(evt.note ?? ""));
        else if (evt.kind === "switch_mode")
          switchTo = { mode: String(evt.mode ?? "ask"), retry: String(evt.retry ?? "") };
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
  return { steps, sources, applied, plan, question, revisions, switchTo, answer, error };
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

function Disclosure({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[0.8125rem] text-zinc-500 transition hover:text-zinc-800"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {icon}
        {label}
      </button>
      {open ? <div className="mt-1 border-l-2 border-zinc-200 pl-2.5">{children}</div> : null}
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
  planOverride,
  onPlanChange,
  onReply,
  onRevise,
  revising,
  onStopRevise,
  onFixFailed,
  onSwitchMode,
  working,
}: {
  content: string;
  busy: boolean;
  animate: boolean;
  onOpenFile: (source: Source) => void;
  /** Live status for this message's plan, keyed by plan id — the stream only
   *  ever carries the state at proposal time. */
  planOverride?: PlanState | null;
  onPlanChange?: (next: PlanState) => void;
  /** Answer this message's question. Only passed while it's the latest
   *  message; an answered question shows without its buttons. */
  onReply?: (text: string) => void;
  /** Ask for a different plan, with the user's note. Absent while busy. */
  onRevise?: (plan: PlanState, note: string) => void;
  /** Set while this message's plan is being revised: Bao works over it. */
  revising?: Revising | null;
  /** Stop a revision in progress; the plan stays as it was. */
  onStopRevise?: () => void;
  /** Redo this message's plan's failed changes with a fresh turn. */
  onFixFailed?: (plan: PlanState) => void;
  /** Switch to Ask first and resend the request. Only on the latest message. */
  onSwitchMode?: (retry: string) => void;
  /** Set on the reply being generated right now: Bao builds it on site. */
  working?: { mode: AgentMode; startedAt: number; onStop: () => void } | null;
}) {
  const {
    steps,
    sources,
    applied,
    plan: streamed,
    question,
    revisions,
    switchTo,
    answer: body,
    error,
  } = parseStream(content);
  // Live status comes from the override; the drawing and settings only ever
  // travel in the stream, so keep those from it.
  const planArea = useRef<HTMLDivElement>(null);
  const plan = planOverride
    ? {
        ...planOverride,
        preview: planOverride.preview ?? streamed?.preview,
        organize: planOverride.organize ?? streamed?.organize,
      }
    : streamed;
  const typed = useTypewriter(body, animate);
  const { thought, answer, thinking, kind } = splitThought(typed);
  // Working the user asked for (Show reasoning) starts open; a model's own
  // scratch thinking starts closed once it's done.
  const [openThought, setOpenThought] = useState<boolean | null>(null);
  const showThought = !!thought && (thinking || (openThought ?? kind === "reasoning"));
  const stillTyping = animate && typed.length < body.length;
  const waiting = !body && !error && busy;

  return (
    <div
      className={`rounded-2xl bg-zinc-100 px-3 py-2 text-[0.9375rem] text-zinc-900 ${
        plan ? "w-full" : "max-w-[85%]"
      }`}
    >
      {revisions.length ? (
        <ul className="mb-1.5 space-y-0.5">
          {revisions.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[0.8125rem] text-zinc-500">
              <RefreshCw className="mt-[3px] h-3 w-3 shrink-0" />
              <span>
                <span className="text-zinc-700">You asked:</span> {n}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {steps.length ? (
        <Disclosure icon={<Sparkles className="h-3 w-3" />} label="How I searched">
          <ol className="space-y-1 text-[0.8125rem] text-zinc-500">
            {steps.map((st, i) => (
              <li key={i}>
                <span className="text-zinc-700">{st.label}</span>
                {st.detail ? <span className="text-zinc-500">: “{st.detail}”</span> : null}
              </li>
            ))}
          </ol>
        </Disclosure>
      ) : null}

      {applied.length ? (
        <Disclosure
          icon={<Wand2 className="h-3 w-3" />}
          label={`Applied ${applied.length} change${applied.length === 1 ? "" : "s"}`}
        >
          <ol className="space-y-1 text-[0.8125rem] text-zinc-500">
            {applied.map((a, i) => (
              <li key={i} className={a.failed ? "text-red-500" : undefined}>
                <span className="text-zinc-700">{a.label}</span>
                {a.detail ? <span>: {a.detail}</span> : null}
              </li>
            ))}
          </ol>
        </Disclosure>
      ) : null}

      {thought ? (
        <div className="mb-1">
          <button
            onClick={() => setOpenThought(!showThought)}
            aria-expanded={showThought}
            className="flex items-center gap-1 text-[0.8125rem] text-zinc-500 transition hover:text-zinc-800"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${showThought ? "rotate-90" : ""}`} />
            {thinking ? <Working /> : kind === "reasoning" ? "Reasoning" : "Thoughts"}
          </button>
          {showThought ? (
            kind === "reasoning" ? (
              <div
                className={`${MD_CLASS} mb-2 mt-1 border-l-2 border-zinc-300 pl-3 text-[0.875rem] text-zinc-600`}
              >
                <ReactMarkdown remarkPlugins={MD_PLUGINS}>{thought}</ReactMarkdown>
              </div>
            ) : (
              <div className="mt-1 whitespace-pre-wrap border-l-2 border-zinc-200 pl-2.5 text-[0.8125rem] text-zinc-500">
                {thought}
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-[0.9375rem] text-red-400">{error}</p> : null}

      {answer ? (
        <div className={MD_CLASS}>
          <ReactMarkdown remarkPlugins={MD_PLUGINS}>{answer}</ReactMarkdown>
          {stillTyping ? (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-zinc-900 align-middle" />
          ) : null}
        </div>
      ) : waiting && working ? (
        // The reply being built right now: Bao on site, working on each step.
        <BaoWorksite
          mode={working.mode}
          buffer={content}
          startedAt={working.startedAt}
          onStop={working.onStop}
        />
      ) : waiting ? (
        // The last read step names what's actually happening; between steps the
        // indicator rotates through its own labels.
        <Working step={steps.length ? steps[steps.length - 1]?.label : undefined} />
      ) : null}

      {switchTo && onSwitchMode && !stillTyping ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSwitchMode(switchTo.retry)}
            className="flex items-center gap-2 rounded-full border border-[rgb(var(--c-go-300))] bg-[rgb(var(--c-go-50))] py-1 pl-1 pr-3 text-[0.8125rem] text-zinc-900 transition hover:bg-[rgb(var(--c-go-300)/0.35)]"
          >
            <ModeAvatar mode="ask" className="h-6 w-6" />
            Switch to Ask first &amp; plan it
          </button>
          <span className="text-[0.75rem] text-zinc-500">Butler Bao drafts it; you approve.</span>
        </div>
      ) : null}

      {question && !stillTyping ? (
        <div className="mt-2.5 border-t border-zinc-200 pt-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.75rem] text-zinc-500">
            <MessageCircleQuestion className="h-3.5 w-3.5" />
            {onReply ? "Pick one, or type your own answer" : "Asked to clarify"}
          </p>
          {onReply && question.options.length ? (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => onReply(o)}
                  className="group flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[0.875rem] text-zinc-900 transition-colors hover:border-zinc-900 hover:bg-zinc-900 hover:text-white"
                >
                  {o}
                  <CornerDownLeft className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {plan ? (
        <div className="relative" ref={planArea}>
          <div
            className={`transition duration-300 ${revising ? "pointer-events-none select-none opacity-75 saturate-50" : ""}`}
            aria-hidden={revising ? true : undefined}
          >
            <PlanCard
              plan={plan}
              onApplied={(next) => onPlanChange?.(next)}
              onRevise={onRevise ? (note) => onRevise(plan, note) : undefined}
              onFix={onFixFailed ? () => onFixFailed(plan) : undefined}
            />
          </div>
          {revising ? (
            <BaoBuilder
              mode={revising.mode}
              status={revising.done ? "" : progressOf(revising.buffer).status}
              done={!!revising.done}
              startedAt={revising.startedAt}
              onStop={onStopRevise}
              areaRef={planArea}
            />
          ) : null}
        </div>
      ) : null}

      {sources.length ? (
        <div className="mt-2.5 border-t border-zinc-200 pt-2">
          <p className="mb-1 text-[0.65rem] uppercase tracking-wide text-zinc-500">Sources</p>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenFile(s)}
                title={`Open ${s.name}`}
                className="flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-100 px-2 py-1 text-[0.8125rem] text-zinc-700 transition hover:border-zinc-900/25 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <FileText className="h-3 w-3 shrink-0 text-zinc-600" />
                <span className="max-w-[12rem] truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
