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
import { useAuth } from "@/lib/auth-context";
import { COUNTRY_CODES } from "@/lib/country-codes";

// "details" collects the phone + the new password; the password is applied only
// once Telegram confirms the code, so nothing changes if the flow is abandoned.
// Telegram is the only reset channel — BYOS holds no email address.
type Step = "details" | "code" | "password";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { establishSession, user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>("details");
  const [dial, setDial] = useState("+91");
  const [national, setNational] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
        const r = await api.resetPassword(e164, password);
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
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-10 h-11 w-full max-w-64" />
        <Skeleton className="mt-5 h-5 w-full" />
        <Skeleton className="mt-8 h-12 w-full rounded-lg" />
        <Skeleton className="mt-3 h-12 w-full rounded-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6">
      <header className="flex items-center justify-between py-8">
        <Logo wordClassName="text-xl" />
      </header>

      <div className="flex flex-1 flex-col justify-center pb-20">
        <h1 className="type-heading">Reset your password</h1>
        <p className="mt-5 text-[1.0625rem] leading-[1.4] text-zinc-600">
          {step === "details" &&
            "Choose a new password. We'll send a code to your Telegram app to confirm it's you — BYOS has no email on file, so Telegram is the only way."}
          {step === "code" && "Enter the code Telegram just sent to your app to apply the new password."}
          {step === "password" &&
            "Your Telegram account has two-factor auth — enter its password to finish."}
        </p>
        {step === "details" ? (
          <div className="mt-6 flex items-start gap-3 text-[0.9375rem] leading-[1.45] text-zinc-600">
            <Send className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
            <span>
              Use the phone number on your BYOS account. The code arrives in{" "}
              <strong className="text-zinc-900">Telegram</strong>, from the official “Telegram”
              chat — never by SMS.
            </span>
          </div>
        ) : null}
        {step === "code" ? (
          <div className="surface-card mt-6 flex items-start gap-3 px-5 py-4 text-[0.9375rem] leading-[1.45] text-zinc-900">
            <Send className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Check your <strong>Telegram app</strong> — the code is sent there (in the official
              “Telegram” chat), not by SMS. Your password only changes once it verifies.
            </span>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-8 space-y-3">
          {step === "details" && (
            <>
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
              <PasswordInput
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password (min 8 characters)"
              />
              <PasswordInput
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
              />
            </>
          )}
          {step === "code" && (
            <Input
              required
              autoFocus
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code from Telegram (e.g. 12345)"
            />
          )}
          {step === "password" && (
            <PasswordInput
              required
              autoFocus
              value={twofa}
              onChange={(e) => setTwofa(e.target.value)}
              placeholder="Two-factor password"
            />
          )}

          {error ? <p className="text-[0.9375rem] text-red-600">{error}</p> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait…"
              : step === "details"
                ? "Send code to Telegram"
                : "Set new password"}
          </Button>
        </form>

        <div className="mt-4 space-y-2 text-[0.9375rem]">
          <p className="text-[0.8125rem] leading-[1.5] text-zinc-500">
            Resetting signs out every other device — anyone still using the old password loses
            access.
          </p>
          {step !== "details" && (
            <button
              onClick={() => {
                setStep("details");
                setError(null);
              }}
              className="block text-zinc-500 hover:text-zinc-800"
            >
              ← Start over
            </button>
          )}
          <p className="text-zinc-500">
            Remembered it?{" "}
            <Link href="/login" className="text-zinc-900 hover:text-zinc-900">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
