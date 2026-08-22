"use client";

import { ApiError } from "@byos/api-client";
import { Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
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
  // Password is the default: it reuses the Telegram session already stored,
  // so it neither contacts Telegram nor authorises a new device.
  const [mode, setMode] = useState<Mode>("password");
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
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-10 h-11 w-full max-w-64" />
        <Skeleton className="mt-5 h-5 w-full" />
        <Skeleton className="mt-8 h-12 w-full rounded-lg" />
        <Skeleton className="mt-3 h-12 w-full rounded-full" />
      </main>
    );
  }

  const passwordMode = mode === "password";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6">
      <header className="flex items-center justify-between py-8">
        <Logo wordClassName="text-xl" />
      </header>

      <div className="flex flex-1 flex-col justify-center pb-20">
        <h1 className="type-heading">
          {passwordMode ? "Sign in" : "Sign in with Telegram"}
        </h1>
        <p className="mt-5 text-[1.0625rem] leading-[1.4] text-zinc-600">
          {passwordMode
            ? "Your username or phone, and your BYOS password. This doesn't contact Telegram, so no new device is added to your account."
            : step === "phone"
              ? "Your Telegram account is your BYOS account and your storage. We'll send a login code to your Telegram app — not by SMS."
              : step === "code"
                ? "Enter the login code Telegram just sent to your app."
                : "Your account has two-factor auth — enter your Telegram password."}
        </p>
        {notice ? (
          <p className="surface-card mt-6 px-5 py-4 text-[0.9375rem] text-zinc-900">
            {notice}
          </p>
        ) : null}
        {!passwordMode && step === "phone" ? (
          <div className="mt-6 flex items-start gap-3 text-[0.9375rem] leading-[1.45] text-zinc-600">
            <Send className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
            <span>
              The code arrives as a message in <strong className="text-zinc-900">Telegram</strong>,
              from the official “Telegram” chat. Nothing is sent by SMS, so keep the app to hand.
            </span>
          </div>
        ) : null}
        {!passwordMode && step === "code" ? (
          <div className="surface-card mt-6 flex items-start gap-3 px-5 py-4 text-[0.9375rem] leading-[1.45] text-zinc-900">
            <Send className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Check your <strong>Telegram app</strong> — the code is sent there (in the
              official “Telegram” chat), not by SMS.
            </span>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-8 space-y-3">
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
              <PasswordInput
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
                className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-[0.9375rem] text-zinc-900 outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
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
              placeholder="Code from Telegram (e.g. 12345)"
            />
          )}
          {!passwordMode && step === "password" && (
            <PasswordInput
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Two-factor password"
            />
          )}

          {error ? <p className="text-[0.9375rem] text-red-600">{error}</p> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait…"
              : passwordMode
                ? "Sign in"
                : step === "phone"
                  ? "Send code to Telegram"
                  : step === "code"
                    ? "Verify"
                    : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 space-y-2 text-[0.9375rem]">
          <button
            onClick={() => switchMode(passwordMode ? "telegram" : "password")}
            className="text-zinc-900 underline decoration-zinc-300 underline-offset-2 transition-colors hover:decoration-zinc-900"
          >
            {passwordMode ? "Sign in with a Telegram code instead" : "Sign in with a password instead"}
          </button>
          <p className="mt-3 text-[0.8125rem] leading-[1.5] text-zinc-500">
            {passwordMode
              ? "A Telegram code authorises a new device on your Telegram account — you'll see it listed under Devices there. Use it if you've forgotten your password or logged BYOS out of Telegram."
              : "Signing in with a password reuses the Telegram session BYOS already holds, so nothing new is added to your Telegram Devices list."}
          </p>
          {!passwordMode && step !== "phone" && (
            <button
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
              className="block text-zinc-500 hover:text-zinc-800"
            >
              ← Start over
            </button>
          )}
          <p className="text-zinc-500">
            New to BYOS?{" "}
            <Link href="/register" className="text-zinc-900 hover:text-zinc-900">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
