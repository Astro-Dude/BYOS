"use client";

import type { AgentAction, OrganizeOptions, PlanPreview } from "@byos/api-client";
import {
  AlertTriangle,
  Check,
  FolderPlus,
  Link2,
  Loader2,
  MoveRight,
  Pencil,
  Send,
  Share2,
  Star,
  Tag,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { PlanTree, previewSummary } from "@/components/byok/plan-tree";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

const NOTE_MAX_PX = 120; // about six lines

export type PlanState = {
  planId: string;
  status: "pending" | "applied" | "discarded" | "undone";
  actions: AgentAction[];
  /** The drive's shape once applied, for plans that create or move things. */
  preview?: PlanPreview | null;
  /** An organizing run's settings, so a revision keeps the same limits. */
  organize?: OrganizeOptions | null;
};

const ICONS: Record<string, ReactNode> = {
  create_folder: <FolderPlus className="h-3.5 w-3.5" />,
  rename_file: <Pencil className="h-3.5 w-3.5" />,
  rename_folder: <Pencil className="h-3.5 w-3.5" />,
  move_file: <MoveRight className="h-3.5 w-3.5" />,
  move_folder: <MoveRight className="h-3.5 w-3.5" />,
  set_favorite: <Star className="h-3.5 w-3.5" />,
  add_tag: <Tag className="h-3.5 w-3.5" />,
  remove_tag: <Tag className="h-3.5 w-3.5" />,
  delete_file: <Trash2 className="h-3.5 w-3.5" />,
  delete_folder: <Trash2 className="h-3.5 w-3.5" />,
  create_share_link: <Share2 className="h-3.5 w-3.5" />,
  create_alias: <Link2 className="h-3.5 w-3.5" />,
};

/** The confirmation surface for a turn's drive changes.
 *
 *  One card covers every state a plan can be in, because a single turn can mix
 *  them: in auto mode the reversible changes arrive already applied while a
 *  delete still waits. So each row carries its own outcome, and the footer only
 *  offers Apply while something is actually pending. */
export function PlanCard({
  plan,
  onApplied,
  onRevise,
  onFix,
}: {
  plan: PlanState;
  onApplied: (next: PlanState) => void;
  /** Ask for a different plan: discards this one and sends the user's note. */
  onRevise?: (note: string) => void;
  /** Have Bao redo the failed changes against the folders that now exist. */
  onFix?: () => void;
}) {
  const authed = useAuthed();
  const [busy, setBusy] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"tree" | "list">("tree");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Grow the suggestion box with its text, up to a few lines, then scroll.
  const fitNote = () => {
    const el = noteRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, NOTE_MAX_PX)}px`;
  };

  const submitNote = () => {
    const text = note.trim();
    if (!text || !onRevise) return;
    setNote("");
    requestAnimationFrame(fitNote); // shrink back once cleared
    onRevise(text);
  };

  const pending = plan.actions.filter((a) => !a.result);
  const failed = plan.actions.filter((a) => a.result && !a.result.ok);
  const dangerous = pending.filter((a) => a.danger);
  const isPending = plan.status === "pending" && pending.length > 0;

  const run = async (kind: "apply" | "discard") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "apply") {
        const res = await authed((t) => api.applyAgentPlan(t, plan.planId));
        onApplied({ ...plan, status: "applied", actions: res.actions });
      } else {
        const res = await authed((t) => api.discardAgentPlan(t, plan.planId));
        onApplied({ ...plan, status: "discarded", actions: res.actions });
      }
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const heading =
    plan.status === "undone"
      ? "Undone: everything put back"
      : plan.status === "discarded"
        ? "Discarded"
        : isPending
          ? `${pending.length} change${pending.length === 1 ? "" : "s"} to confirm`
          : `${plan.actions.length} change${plan.actions.length === 1 ? "" : "s"} applied`;

  return (
    <div
      className={`mt-2.5 overflow-hidden rounded-xl border ${
        isPending ? "border-zinc-900/25 bg-zinc-900/[0.04]" : "border-zinc-200 bg-zinc-100"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-inherit px-3 py-2">
        <span className="shrink-0 whitespace-nowrap text-[0.8125rem] font-medium text-zinc-900">
          {heading}
        </span>
        {plan.status === "discarded" ? (
          <X className="h-3.5 w-3.5 text-zinc-400" />
        ) : !isPending ? (
          <Check className="h-3.5 w-3.5 text-zinc-900" />
        ) : null}
        {failed.length ? (
          <button
            type="button"
            onClick={() => {
              setView("list");
              setOnlyFailed((v) => !v);
            }}
            className="shrink-0 whitespace-nowrap text-[0.8125rem] text-red-500 underline-offset-2 hover:underline"
            title="Show what failed and why"
          >
            · {failed.length} failed
          </button>
        ) : null}
        {plan.preview ? (
          <>
            <span className="hidden min-w-0 truncate text-[0.75rem] text-zinc-500 sm:inline">
              {previewSummary(plan.preview)}
            </span>
            <div role="tablist" aria-label="Show the plan as" className="ml-auto flex shrink-0 gap-0.5">
              {(["tree", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-full px-2.5 py-0.5 text-[0.75rem] transition ${
                    view === v ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-200/70"
                  }`}
                >
                  {v === "tree" ? "Diagram" : "List"}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {plan.preview && view === "tree" ? (
        <div className={plan.status === "discarded" || plan.status === "undone" ? "opacity-50" : ""}>
          <PlanTree preview={plan.preview} />
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200/60">
          {onlyFailed ? (
            <li className="flex items-center justify-between gap-2 bg-red-500/[0.06] px-3 py-1.5 text-[0.75rem] text-red-600">
              <span>Showing only the changes that failed, with why.</span>
              <button
                type="button"
                onClick={() => setOnlyFailed(false)}
                className="text-zinc-600 hover:text-zinc-900"
              >
                Show all
              </button>
            </li>
          ) : null}
          {plan.actions.map((a, i) => {
            const done = a.result;
            if (onlyFailed && !(done && !done.ok)) return null;
            return (
              <li key={i} className="flex items-start gap-2 px-3 py-1.5 text-[0.8125rem]">
                <span
                  className={`mt-0.5 shrink-0 ${
                    a.danger ? "text-red-500" : done?.ok ? "text-zinc-900" : "text-zinc-400"
                  }`}
                >
                  {ICONS[a.op] ?? <Pencil className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      plan.status === "discarded" || (done && !done.ok)
                        ? "text-zinc-400 line-through"
                        : "text-zinc-800"
                    }
                  >
                    {a.label}
                  </span>
                  {done ? (
                    <span className={done.ok ? "text-zinc-400" : "text-red-500"}>
                      {": "}
                      {done.detail}
                    </span>
                  ) : a.auto ? null : null}
                </span>
                {done?.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-zinc-900" /> : null}
              </li>
            );
          })}
        </ul>
      )}

      {dangerous.length ? (
        <div className="flex items-start gap-2 border-t border-inherit bg-red-500/[0.06] px-3 py-2 text-[0.8125rem] text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {dangerous.length === 1 ? "One change is" : `${dangerous.length} changes are`} permanent or
            public. Deleted files are removed from your storage too.
          </span>
        </div>
      ) : null}

      {plan.status === "applied" && failed.length && onFix ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-inherit px-3 py-2">
          <button
            type="button"
            onClick={onFix}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[0.8125rem] font-medium text-white transition hover:bg-zinc-800"
          >
            <Wand2 className="h-3.5 w-3.5" /> Fix {failed.length} with Bao
          </button>
          <span className="text-[0.75rem] text-zinc-500">
            Bao redoes the failed changes against your folders as they are now. You approve them first.
          </span>
        </div>
      ) : null}

      {isPending && onRevise ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitNote();
          }}
          className="flex items-end gap-2 border-t border-inherit px-3 py-2"
        >
          {/* Enter sends, Shift+Enter starts a new line; grows with the text. */}
          <textarea
            ref={noteRef}
            rows={1}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              fitNote();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitNote();
              }
            }}
            placeholder="Want it different? e.g. keep invoices apart from receipts"
            aria-label="Suggest a change to this plan"
            className="hair-scroll min-w-0 flex-1 resize-none rounded-2xl border border-zinc-200 bg-white px-3 py-1.5 text-[0.8125rem] leading-5 text-zinc-900 outline-none transition placeholder:truncate placeholder:text-zinc-400 focus:border-zinc-900"
            style={{ maxHeight: NOTE_MAX_PX }}
          />
          <button
            type="submit"
            disabled={!note.trim() || busy !== null}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[0.8125rem] text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" /> Revise
          </button>
        </form>
      ) : null}

      {isPending ? (
        <div className="flex items-center gap-2 border-t border-inherit px-3 py-2">
          <button
            onClick={() => void run("apply")}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[0.8125rem] font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy === "apply" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Apply {pending.length}
          </button>
          <button
            onClick={() => void run("discard")}
            disabled={busy !== null}
            className="rounded-lg px-3 py-1.5 text-[0.8125rem] text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50"
          >
            Discard
          </button>
          {error ? <span className="text-[0.8125rem] text-red-500">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
