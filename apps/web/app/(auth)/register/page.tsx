"use client";

import { ApiError } from "@byos/api-client";
import { Send } from "lucide-react";
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
import { useAuth } from "@/lib/auth-context";
import { COUNTRY_CODES } from "@/lib/country-codes";

// "details" collects username + password + phone; only after that do we send
// the OTP. Nothing is stored server-side until the code (or 2FA) verifies.
type Step = "details" | "code" | "password";

export default function RegisterPage() {
  const router = useRouter();
  const { establishSession, user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>("details");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [dial, setDial] = useState("+91");
  const [national, setNational] = useState("");
  const [code, setCode] = useState("");
  const [twofa, setTwofa] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!authLoading && user) router.replace("/dashboard");
  }, [authLoading, user, router]);

  const goToDashboard = async (accessToken: string) => {
    await establishSession(accessToken);
    router.push("/dashboard");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "details") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
      void run(async () => {
        const e164 = `${dial}${national.replace(/\D/g, "")}`;
        const r = await api.telegramSignup(e164, username.trim(), password);
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
        const r = await api.telegramPassword(ticket, twofa);
        if (r.access_token) await goToDashboard(r.access_token);
      });
    }
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

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Logo className="text-indigo-600" markClassName="h-9 w-9" wordClassName="text-lg" />
        <ThemeToggle />
      </header>

      <div className="flex flex-1 flex-col justify-center pb-16">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {step === "details" &&
            "Pick a username and password, then we'll send a Telegram code to confirm your number."}
          {step === "code" && "Enter the login code Telegram just sent to your app."}
          {step === "password" && "Your Telegram account has two-factor auth — enter its password."}
        </p>
        {step === "code" ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
            <Send className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Check your <strong>Telegram app</strong> — the code is sent there (in the
              official “Telegram” chat), not by SMS.
            </span>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {step === "details" && (
            <>
              <div className="flex items-center rounded-md border border-zinc-300 bg-white px-3 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800">
                <span className="text-sm text-zinc-400">@</span>
                <Input
                  required
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="username"
                  className="border-0 bg-transparent focus:ring-0 dark:bg-transparent"
                />
              </div>
              <Input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 8 characters)"
              />
              <Input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm password"
              />
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
                  inputMode="numeric"
                  value={national}
                  onChange={(e) => setNational(e.target.value)}
                  placeholder="98765 43210"
                />
              </div>
            </>
          )}
          {step === "code" && (
            <Input
              required
              autoFocus
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Login code (e.g. 12345)"
            />
          )}
          {step === "password" && (
            <Input
              type="password"
              required
              autoFocus
              value={twofa}
              onChange={(e) => setTwofa(e.target.value)}
              placeholder="Two-factor password"
            />
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait…"
              : step === "details"
                ? "Send code"
                : step === "code"
                  ? "Verify"
                  : "Create account"}
          </Button>
        </form>

        <div className="mt-4 space-y-2 text-sm">
          {step !== "details" && (
            <button
              onClick={() => {
                setStep("details");
                setError(null);
              }}
              className="block text-zinc-500 hover:text-zinc-800 dark:text-zinc-200"
            >
              ← Start over
            </button>
          )}
          <p className="text-zinc-500">
            Already have an account?{" "}
            <Link href="/login" className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
