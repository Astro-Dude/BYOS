"use client";

import { ApiError } from "@byos/api-client";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Step = "phone" | "code" | "password";

export default function LoginPage() {
  const router = useRouter();
  const { establishSession, user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
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

  // Already signed in (persisted session) — go straight to the dashboard.
  useEffect(() => {
    if (!authLoading && user) router.replace("/dashboard");
  }, [authLoading, user, router]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "phone") {
      void run(async () => {
        const r = await api.telegramStart(phone.trim());
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
          await establishSession(r.access_token);
          router.push("/dashboard");
        }
      });
    } else {
      void run(async () => {
        const r = await api.telegramPassword(ticket, password);
        if (r.access_token) {
          await establishSession(r.access_token);
          router.push("/dashboard");
        }
      });
    }
  };

  if (authLoading || user) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Logo className="mb-8 text-indigo-600" markClassName="h-12 w-12" wordClassName="text-2xl" />
      <h1 className="text-2xl font-semibold tracking-tight">Sign in with Telegram</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {step === "phone" && "Your Telegram account is your BYOS account and your storage."}
        {step === "code" && "Enter the login code Telegram just sent to your app."}
        {step === "password" && "Your account has two-factor auth — enter your Telegram password."}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {step === "phone" && (
          <Input
            type="tel"
            required
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210 (with country code)"
          />
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Two-factor password"
          />
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <Button type="submit" disabled={busy} className="w-full">
          {busy
            ? "Please wait…"
            : step === "phone"
              ? "Send code"
              : step === "code"
                ? "Verify"
                : "Sign in"}
        </Button>
      </form>

      {step !== "phone" && (
        <button
          onClick={() => {
            setStep("phone");
            setError(null);
          }}
          className="mt-4 text-sm text-zinc-500 hover:text-zinc-800"
        >
          ← Start over
        </button>
      )}
    </main>
  );
}
