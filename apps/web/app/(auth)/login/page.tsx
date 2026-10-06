"use client";

import { ApiError } from "@byos/api-client";
import { KeyRound, Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import {
  AuthShell,
  AuthSkeleton,
  CodeInput,
  Field,
  FormError,
  TelegramNote,
  TextLink,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api";
import { RECONNECT_NOTICE_KEY, useAuth } from "@/lib/auth-context";
import { CountryCodePicker } from "@/components/ui/country-code-picker";
import { homeAfterSignIn } from "@/lib/pending-question";

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
    if (!authLoading && user) router.replace(homeAfterSignIn());
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
    router.push(homeAfterSignIn());
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
          setNotice("Your Telegram access was logged out. Enter the code we just sent to reconnect.");
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

  if (authLoading || user) return <AuthSkeleton />;

  const passwordMode = mode === "password";

  return (
    <AuthShell
      bao="ask"
      greeting={notice ? "Let's get you reconnected." : "Welcome back. Everything's where you left it."}
      title={passwordMode ? "Welcome back" : step === "password" ? "One more step" : "Sign in with Telegram"}
      lead={
        passwordMode
          ? "Sign in with your username or phone and your BYOS password."
          : step === "phone"
            ? "Your Telegram account is your BYOS account and your storage. We'll send a code to your Telegram app."
            : step === "code"
              ? `Enter the code Telegram just sent to ${dial} ${national}.`
              : "Your account has two-step verification. Enter your Telegram password."
      }
      steps={
        passwordMode
          ? undefined
          : { labels: ["Phone", "Code", "Verify"], current: ["phone", "code", "password"].indexOf(step) }
      }
      footer={
        <p className="text-zinc-500">
          New to BYOS? <TextLink href="/register">Create an account</TextLink>
        </p>
      }
    >
      {/* Two ways in, as a switch: filled is the one you're on. */}
      {step === "phone" || passwordMode ? (
        <div
          role="tablist"
          aria-label="Sign in with"
          className="mt-8 grid grid-cols-2 gap-1 rounded-full bg-zinc-100 p-1"
        >
          {(
            [
              ["password", "Password", KeyRound],
              ["telegram", "Telegram code", Send],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => mode !== m && switchMode(m)}
              className={`flex items-center justify-center gap-2 rounded-full py-2 text-[0.875rem] transition ${
                mode === m
                  ? "bg-zinc-900 font-medium text-white shadow-sm"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p className="mt-6 rounded-2xl bg-[rgb(var(--c-caution-50))] px-4 py-3 text-[0.875rem] leading-[1.5] text-zinc-900 ring-1 ring-[rgb(var(--c-caution-300))]">
          {notice}
        </p>
      ) : null}
      {!passwordMode && step !== "password" ? <TelegramNote sent={step === "code"} /> : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {passwordMode && (
          <>
            <Field label="Username or phone" htmlFor="identifier">
              <Input
                id="identifier"
                required
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you, or +91 98765 43210"
              />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              hint={<TextLink href="/forgot-password">Forgot?</TextLink>}
            >
              <PasswordInput
                id="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your BYOS password"
              />
            </Field>
          </>
        )}

        {!passwordMode && step === "phone" && (
          <Field label="Phone number" htmlFor="phone">
            <div className="flex gap-2">
              <CountryCodePicker dial={dial} onChange={setDial} />
              <Input
                id="phone"
                type="tel"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="tel-national"
                value={national}
                onChange={(e) => setNational(e.target.value)}
                placeholder="98765 43210"
              />
            </div>
          </Field>
        )}
        {!passwordMode && step === "code" && (
          <Field label="Login code" htmlFor="code">
            <CodeInput id="code" value={code} onChange={setCode} />
          </Field>
        )}
        {!passwordMode && step === "password" && (
          <Field label="Two-step verification password" htmlFor="twofa">
            <PasswordInput
              id="twofa"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your Telegram password"
            />
          </Field>
        )}

        {error ? <FormError>{error}</FormError> : null}

        <Button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy
            ? "Signing in…"
            : passwordMode
              ? "Sign in"
              : step === "phone"
                ? "Send code to Telegram"
                : step === "code"
                  ? "Verify code"
                  : "Sign in"}
        </Button>

        {!passwordMode && step !== "phone" ? (
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
            className="block w-full text-center text-[0.875rem] text-zinc-500 hover:text-zinc-900"
          >
            ← Use a different number
          </button>
        ) : null}
      </form>

      <p className="mt-5 text-[0.8125rem] leading-[1.5] text-zinc-500">
        {passwordMode
          ? "A password uses the Telegram session BYOS already has, so it doesn't add a device. Pick a Telegram code if you logged BYOS out of Telegram."
          : "A Telegram code adds a new device to your Telegram account. A password doesn't."}
      </p>
    </AuthShell>
  );
}
