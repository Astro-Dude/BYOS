"use client";

import { ApiError } from "@byos/api-client";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

type Phase = "loading" | "disconnected" | "code" | "password" | "connected";

export function TelegramPanel() {
  const authed = useAuthed();
  const [phase, setPhase] = useState<Phase>("loading");
  const [label, setLabel] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const providers = await authed((t) => api.listProviders(t));
      const tg = providers.find((p) => p.provider === "telegram");
      if (tg?.status === "connected") {
        setLabel(tg.label);
        setPhase("connected");
      } else if (tg?.status === "pending_password") {
        setPhase("password");
      } else if (tg?.status === "pending_code") {
        setPhase("code");
      } else {
        setPhase("disconnected");
      }
    } catch {
      setPhase("disconnected");
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const submitPhone = () =>
    run(async () => {
      const result = await authed((t) => api.connectTelegram(t, phone.trim()));
      setPhase(result.status === "connected" ? "connected" : "code");
    });

  const submitCode = () =>
    run(async () => {
      const result = await authed((t) => api.verifyTelegramCode(t, code.trim()));
      if (result.status === "password_needed") setPhase("password");
      else await load();
    });

  const submitPassword = () =>
    run(async () => {
      await authed((t) => api.verifyTelegramPassword(t, password));
      await load();
    });

  const disconnect = () =>
    run(async () => {
      await authed((t) => api.disconnectTelegram(t));
      setLabel(null);
      setPhone("");
      setCode("");
      setPassword("");
      setPhase("disconnected");
    });

  return (
    <section className="rounded-lg border border-zinc-200 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-zinc-900">Telegram storage</h2>
          <p className="text-sm text-zinc-500">
            {phase === "connected"
              ? `Connected${label ? ` as ${label}` : ""} — uploads go to your Saved Messages.`
              : "Connect your Telegram account to store files in your own Saved Messages."}
          </p>
        </div>
        {phase === "connected" ? (
          <Button onClick={disconnect} disabled={busy} className="bg-zinc-900 hover:bg-zinc-700">
            Disconnect
          </Button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {phase === "disconnected" ? (
        <div className="mt-4 flex gap-2">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210 (with country code)"
          />
          <Button onClick={submitPhone} disabled={busy || !phone.trim()}>
            {busy ? "Sending…" : "Send code"}
          </Button>
        </div>
      ) : null}

      {phase === "code" ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-zinc-600">
            Enter the login code Telegram just sent to your app.
          </p>
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="12345"
              inputMode="numeric"
            />
            <Button onClick={submitCode} disabled={busy || !code.trim()}>
              {busy ? "Verifying…" : "Verify"}
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "password" ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-zinc-600">
            Your account has two-factor auth. Enter your Telegram password.
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Two-factor password"
            />
            <Button onClick={submitPassword} disabled={busy || !password}>
              {busy ? "Verifying…" : "Confirm"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
