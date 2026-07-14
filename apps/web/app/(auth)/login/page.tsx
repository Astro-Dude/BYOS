"use client";

import { ApiError } from "@byos/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { RECONNECT_NOTICE_KEY, useAuth } from "@/lib/auth-context";
import { COUNTRY_CODES } from "@/lib/country-codes";

// "telegram" = OTP flow (phone → code → optional 2FA); "password" = username-or-
// phone + password, skipping OTP entirely.
type Mode = "telegram" | "password";
type Step = "phone" | "code" | "password";

export default function LoginPage() {
  const router = useRouter();
  const { establishSession, user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<Mode>("telegram");
  const [step, setStep] = useState<Step>("phone");
  const [dial, setDial] = useState("+91");
  const [national, setNational] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  // Already signed in (persisted session) — go straight to the dashboard.
  useEffect(() => {
    if (!authLoading && user) router.replace("/dashboard");
  }, [authLoading, user, router]);

  // Bounced here because the Telegram storage session was revoked mid-use?
  // Show why, and default to the password flow (which re-sends an OTP to fix it).
  useEffect(() => {
    try {
      const reason = sessionStorage.getItem(RECONNECT_NOTICE_KEY);
      if (reason) {
        setNotice(reason);
        sessionStorage.removeItem(RECONNECT_NOTICE_KEY);
      }
    } catch {
      // sessionStorage unavailable — no notice to show
    }
  }, []);

  const goToDashboard = async (accessToken: string) => {
    await establishSession(accessToken);
    router.push("/dashboard");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "password") {
      void run(async () => {
        const r = await api.passwordLogin(identifier.trim(), password);
        if (r.status === "code_sent") {
          // Telegram sessions were terminated — the storage session is dead, so
          // finish via OTP to reconnect before we let them in.
          setTicket(r.ticket ?? "");
          setMode("telegram");
          setStep("code");
          setNotice(
            "Your Telegram access was logged out. Enter the code we just sent to reconnect.",
          );
        } else if (r.access_token) {
          await goToDashboard(r.access_token);
        }
      });
      return;
    }
    if (step === "phone") {
      void run(async () => {
        const e164 = `${dial}${national.replace(/\D/g, "")}`;
        const r = await api.telegramStart(e164);
        setTicket(r.ticket ?? "");
        setStep("code");
      });
    } else if (step === "code") {
      void run(async () => {
        const r = await api.telegramVerify(ticket, code.trim());
        if (r.status === "password_needed") {
          setTicket(r.ticket ?? "");
          setStep("password");
        } else if (r.access_token) {
          await goToDashboard(r.access_token);
        }
      });
    } else {
      void run(async () => {
        const r = await api.telegramPassword(ticket, password);
        if (r.access_token) await goToDashboard(r.access_token);
      });
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setStep("phone");
    setError(null);
    setNotice(null);
    setPassword("");
  };

  if (authLoading || user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="mt-8 h-7 w-52" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-8 h-11 w-full rounded-md" />
        <Skeleton className="mt-3 h-11 w-full rounded-md" />
      </main>
    );
  }

  const passwordMode = mode === "password";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Logo className="text-indigo-600" markClassName="h-9 w-9" wordClassName="text-lg" />
        <ThemeToggle />
      </header>

      <div className="flex flex-1 flex-col justify-center pb-16">
        <h1 className="text-2xl font-semibold tracking-tight">
          {passwordMode ? "Sign in" : "Sign in with Telegram"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {passwordMode
            ? "Use your username or phone and your BYOS password."
            : step === "phone"
              ? "Your Telegram account is your BYOS account and your storage."
              : step === "code"
                ? "Enter the login code Telegram just sent to your app."
                : "Your account has two-factor auth — enter your Telegram password."}
        </p>
        {notice ? (
          <p className="mt-3 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
            {notice}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {passwordMode && (
            <>
              <Input
                required
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Username or phone (e.g. +91…)"
              />
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
            </>
          )}

          {!passwordMode && step === "phone" && (
            <div className="flex gap-2">
              <select
                value={dial}
                onChange={(e) => setDial(e.target.value)}
                aria-label="Country code"
                className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={`${c.iso}${c.dial}`} value={c.dial}>
                    {c.iso} {c.dial}
                  </option>
                ))}
              </select>
              <Input
                type="tel"
                required
                autoFocus
                inputMode="numeric"
                value={national}
                onChange={(e) => setNational(e.target.value)}
                placeholder="98765 43210"
              />
            </div>
          )}
          {!passwordMode && step === "code" && (
            <Input
              required
              autoFocus
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Login code (e.g. 12345)"
            />
          )}
          {!passwordMode && step === "password" && (
            <Input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Two-factor password"
            />
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait…"
              : passwordMode
                ? "Sign in"
                : step === "phone"
                  ? "Send code"
                  : step === "code"
                    ? "Verify"
                    : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 space-y-2 text-sm">
          <button
            onClick={() => switchMode(passwordMode ? "telegram" : "password")}
            className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            {passwordMode ? "Sign in with a Telegram code instead" : "Sign in with a password instead"}
          </button>
          {!passwordMode && step !== "phone" && (
            <button
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
              className="block text-zinc-500 hover:text-zinc-800 dark:text-zinc-200"
            >
              ← Start over
            </button>
          )}
          <p className="text-zinc-500">
            New to BYOS?{" "}
            <Link href="/register" className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
