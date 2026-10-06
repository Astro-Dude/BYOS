"use client";

import type { AgentMode } from "@byos/api-client";
import { AlertCircle, Check, Cloud, KeyRound, Link2, Send } from "lucide-react";
import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

import { Logo } from "@/components/logo";
import { ModeAvatar } from "@/components/mode-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { AVATARS } from "@/lib/avatars";
import { cn } from "@/lib/utils";

/** The frame every auth page shares: the form on the left, and on wide screens
 *  a panel on the right where a Bao greets you and says what BYOS is for. Each
 *  page picks its Bao and his line, so the three screens feel related but not
 *  copy-pasted. On phones the panel drops away and only the form shows. */
export function AuthShell({
  bao,
  greeting,
  title,
  lead,
  steps,
  children,
  footer,
}: {
  bao: AgentMode;
  greeting: string;
  title: ReactNode;
  lead: ReactNode;
  /** Multi-step flows: the step names and which one is on. */
  steps?: { labels: string[]; current: number };
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-screen flex-col px-6 sm:px-10">
        <header className="flex items-center justify-between py-8">
          <Link href="/" aria-label="BYOS home">
            <Logo wordClassName="text-xl" />
          </Link>
        </header>

        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center pb-16">
          {steps ? <Steps labels={steps.labels} current={steps.current} /> : null}
          <h1 className="type-heading">{title}</h1>
          <p className="mt-4 text-[1.0625rem] leading-[1.45] text-zinc-600">{lead}</p>
          {children}
          {footer ? (
            <div className="mt-8 border-t border-zinc-200 pt-5 text-[0.9375rem]">{footer}</div>
          ) : null}
        </div>
      </div>

      <BaoPanel mode={bao} greeting={greeting} />
    </main>
  );
}

const PERKS = [
  { icon: Cloud, text: "Your Telegram is the storage. No quota, no plan to upgrade." },
  { icon: Link2, text: "Share links that keep working when files move." },
  { icon: KeyRound, text: "Bring your own AI key. Bao reads and tidies only what you allow." },
];

function BaoPanel({ mode, greeting }: { mode: AgentMode; greeting: string }) {
  return (
    <aside className="hidden p-4 lg:sticky lg:top-0 lg:block lg:h-screen" aria-hidden>
      <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[2rem] bg-zinc-100 p-12">
        {/* Faint dot grid: paper, not a gradient. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: "radial-gradient(rgb(var(--c-300)) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            maskImage: "radial-gradient(ellipse at 50% 45%, black 20%, transparent 75%)",
          }}
        />

        <p className="relative text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-zinc-500">
          Bring Your Own Storage
        </p>

        <div className="relative flex flex-col items-center">
          <div className="relative mb-4 w-max max-w-[22rem] rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-center text-[0.9375rem] leading-snug text-zinc-800 shadow-[var(--shadow-popover)]">
            {greeting}
            <span className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-zinc-200 bg-white" />
          </div>
          <ModeAvatar mode={mode} live aura className="h-44 w-44" />
          <p className="mt-2 text-[0.8125rem] text-zinc-500">{AVATARS[mode].name}</p>
        </div>

        <ul className="relative space-y-3">
          {PERKS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-[0.9375rem] leading-[1.45] text-zinc-700">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900 ring-1 ring-zinc-200">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/** "1 Details — 2 Code — 3 Verify": done steps get a tick, the current one is filled. */
function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2 text-[0.8125rem]" aria-label="Progress">
      {labels.map((label, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={on ? "step" : undefined}>
            {i > 0 ? <span className={cn("h-px w-5", done || on ? "bg-zinc-900" : "bg-zinc-200")} /> : null}
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[0.75rem] font-medium transition-colors",
                done || on ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={on ? "font-medium text-zinc-900" : done ? "text-zinc-700" : "text-zinc-400"}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A labelled field: label above, optional hint on the right of the label. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[0.875rem] font-medium text-zinc-800">
          {label}
        </label>
        {hint ? <span className="text-[0.8125rem] text-zinc-500">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** The Telegram code: big, spaced digits, and the OS can fill it from the message. */
export function CodeInput({
  value,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  onChange: (digits: string) => void;
}) {
  return (
    <input
      required
      autoFocus
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={8}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      placeholder="• • • • •"
      className="field text-center text-[1.5rem] font-medium tracking-[0.5em] tabular-nums placeholder:tracking-[0.3em] focus:ring-1 focus:ring-zinc-900"
      {...props}
    />
  );
}

/** Where the code turns up, said once and plainly; louder once it's been sent. */
export function TelegramNote({ sent, children }: { sent?: boolean; children?: ReactNode }) {
  return (
    <div
      className={cn(
        "mt-6 flex items-start gap-3 rounded-2xl px-4 py-3 text-[0.875rem] leading-[1.5]",
        sent
          ? "bg-[rgb(var(--c-go-50))] text-zinc-900 ring-1 ring-[rgb(var(--c-go-300))]"
          : "bg-zinc-100 text-zinc-600",
      )}
    >
      <Send
        className={cn("mt-0.5 h-4 w-4 shrink-0", sent ? "text-[rgb(var(--c-go-500))]" : "text-zinc-400")}
      />
      <span>
        {children ?? (
          <>
            The code arrives in <strong className="font-medium text-zinc-900">Telegram</strong>, from the
            official “Telegram” chat. Nothing is sent by SMS.
          </>
        )}
      </span>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-red-500/[0.07] px-3.5 py-2.5 text-[0.875rem] leading-[1.45] text-red-600"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}

/** Live checks under a new password, ticking as they're met. */
export function PasswordChecks({ password, confirm }: { password: string; confirm: string }) {
  const checks = [
    { ok: password.length >= 8, text: "At least 8 characters" },
    { ok: confirm.length > 0 && password === confirm, text: "Both match" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-[0.8125rem]">
      {checks.map((c) => (
        <li
          key={c.text}
          className={cn(
            "flex items-center gap-1.5 transition-colors",
            c.ok ? "text-zinc-900" : "text-zinc-400",
          )}
        >
          <span
            className={cn(
              "flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors",
              c.ok ? "bg-zinc-900 text-white" : "ring-1 ring-zinc-300",
            )}
          >
            {c.ok ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-[3px] transition-colors hover:decoration-zinc-900"
    >
      {children}
    </Link>
  );
}

/** While the session settles: the same frame, greyed. */
export function AuthSkeleton() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="mx-auto flex w-full max-w-[26rem] flex-col justify-center px-6">
        <Skeleton className="h-11 w-48" />
        <Skeleton className="mt-5 h-5 w-full" />
        <Skeleton className="mt-10 h-12 w-full rounded-lg" />
        <Skeleton className="mt-3 h-12 w-full rounded-lg" />
        <Skeleton className="mt-6 h-12 w-full rounded-full" />
      </div>
      <div className="hidden p-4 lg:block">
        <Skeleton className="h-full w-full rounded-[2rem]" />
      </div>
    </main>
  );
}
