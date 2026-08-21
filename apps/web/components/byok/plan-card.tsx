"use client";

import type { AgentAction } from "@byos/api-client";
import {
  AlertTriangle,
  Check,
  FolderPlus,
  Link2,
  Loader2,
  MoveRight,
  Pencil,
  Share2,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

export type PlanState = {
  planId: string;
  status: "pending" | "applied" | "discarded";
  actions: AgentAction[];
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
}: {
  plan: PlanState;
  onApplied: (next: PlanState) => void;
}) {
  const authed = useAuthed();
  const [busy, setBusy] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        onApplied({ planId: plan.planId, status: "applied", actions: res.actions });
      } else {
        const res = await authed((t) => api.discardAgentPlan(t, plan.planId));
        onApplied({ planId: plan.planId, status: "discarded", actions: res.actions });
      }
    } catch {
      setError("That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  };

  const heading =
    plan.status === "discarded"
      ? "Discarded"
      : isPending
        ? `${pending.length} change${pending.length === 1 ? "" : "s"} to confirm`
        : `${plan.actions.length} change${plan.actions.length === 1 ? "" : "s"} applied`;

  return (
    <div
      className={`mt-2.5 overflow-hidden rounded-xl border ${
        isPending
          ? "border-indigo-400/40 bg-indigo-500/[0.04]"
          : "border-zinc-200 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-inherit px-3 py-2">
        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{heading}</span>
        {plan.status === "discarded" ? (
          <X className="h-3.5 w-3.5 text-zinc-400" />
        ) : !isPending ? (
          <Check className="h-3.5 w-3.5 text-teal-500" />
        ) : null}
        {failed.length ? (
          <span className="text-xs text-red-500">· {failed.length} failed</span>
        ) : null}
      </div>

      <ul className="divide-y divide-zinc-200/60 dark:divide-white/5">
        {plan.actions.map((a, i) => {
          const done = a.result;
          return (
            <li key={i} className="flex items-start gap-2 px-3 py-1.5 text-xs">
              <span
                className={`mt-0.5 shrink-0 ${
                  a.danger ? "text-red-500" : done?.ok ? "text-teal-500" : "text-zinc-400"
                }`}
              >
                {ICONS[a.op] ?? <Pencil className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={
                    plan.status === "discarded" || (done && !done.ok)
                      ? "text-zinc-400 line-through dark:text-zinc-500"
                      : "text-zinc-800 dark:text-zinc-200"
                  }
                >
                  {a.label}
                </span>
                {done ? (
                  <span className={done.ok ? "text-zinc-400" : "text-red-500"}>
                    {" — "}
                    {done.detail}
                  </span>
                ) : a.auto ? null : null}
              </span>
              {done?.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-teal-500" /> : null}
            </li>
          );
        })}
      </ul>

      {dangerous.length ? (
        <div className="flex items-start gap-2 border-t border-inherit bg-red-500/[0.06] px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {dangerous.length === 1 ? "One change is" : `${dangerous.length} changes are`}{" "}
            permanent or public. Deleted files are removed from your storage too.
          </span>
        </div>
      ) : null}

      {isPending ? (
        <div className="flex items-center gap-2 border-t border-inherit px-3 py-2">
          <button
            onClick={() => void run("apply")}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
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
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-black/5 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            Discard
          </button>
          {error ? <span className="text-xs text-red-500">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
