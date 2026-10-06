"use client";

import { ApiError } from "@byos/api-client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import {
  AuthShell,
  AuthSkeleton,
  CodeInput,
  Field,
  FormError,
  PasswordChecks,
  TelegramNote,
  TextLink,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CountryCodePicker } from "@/components/ui/country-code-picker";

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

  if (authLoading || user) return <AuthSkeleton />;

  return (
    <AuthShell
      bao="read_only"
      greeting="Happens to everyone. Let's find your account."
      title={
        step === "details" ? "Reset your password" : step === "code" ? "Check Telegram" : "One more step"
      }
      lead={
        step === "details"
          ? "Choose a new password, then confirm it's you with a code in Telegram. Nothing changes until the code checks out."
          : step === "code"
            ? `Enter the code Telegram just sent to ${dial} ${national}. Your password changes once it's checked.`
            : "Your Telegram account has two-step verification. Enter its password to finish."
      }
      steps={{
        labels: ["New password", "Code", "Verify"],
        current: ["details", "code", "password"].indexOf(step),
      }}
      footer={
        <p className="text-zinc-500">
          Remembered it? <TextLink href="/login">Sign in</TextLink>
        </p>
      }
    >
      {step !== "password" ? (
        <TelegramNote sent={step === "code"}>
          {step === "details" ? (
            <>
              Use the phone number on your BYOS account. The code arrives in{" "}
              <strong className="font-medium text-zinc-900">Telegram</strong>, not by SMS.
            </>
          ) : undefined}
        </TelegramNote>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {step === "details" && (
          <>
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
            <Field label="New password" htmlFor="password">
              <PasswordInput
                id="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm">
              <PasswordInput
                id="confirm"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
              />
            </Field>
            <PasswordChecks password={password} confirm={confirm} />
          </>
        )}
        {step === "code" && (
          <Field label="Login code" htmlFor="code">
            <CodeInput id="code" value={code} onChange={setCode} />
          </Field>
        )}
        {step === "password" && (
          <Field label="Two-step verification password" htmlFor="twofa">
            <PasswordInput
              id="twofa"
              required
              autoFocus
              value={twofa}
              onChange={(e) => setTwofa(e.target.value)}
              placeholder="Your Telegram password"
            />
          </Field>
        )}

        {error ? <FormError>{error}</FormError> : null}

        <Button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Please wait…" : step === "details" ? "Send code to Telegram" : "Set new password"}
        </Button>
        {step !== "details" ? (
          <button
            type="button"
            onClick={() => {
              setStep("details");
              setError(null);
            }}
            className="block w-full text-center text-[0.875rem] text-zinc-500 hover:text-zinc-900"
          >
            ← Start over
          </button>
        ) : null}
      </form>

      <p className="mt-5 text-[0.8125rem] leading-[1.5] text-zinc-500">
        Resetting signs you out on every other device.
      </p>
    </AuthShell>
  );
}
