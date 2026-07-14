"use client";

import { ApiError } from "@byos/api-client";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {value || "—"}
      </span>
    </div>
  );
}

/** Account profile: identity details + set/change the BYOS password (used for
 *  password login, skipping Telegram OTP). */
export function ProfilePanel() {
  const { user, refresh } = useAuth();
  const authed = useAuthed();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPassword = user?.has_password ?? false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (hasPassword && !current) {
      setError("Enter your current password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await authed((t) => api.setPassword(t, password, hasPassword ? current : undefined));
      toast(hasPassword ? "Password changed" : "Password set");
      setCurrent("");
      setPassword("");
      setConfirm("");
      await refresh(); // pick up has_password = true
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't save password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center space-y-6 py-8">
      <h1 className="text-2xl font-normal text-zinc-800 dark:text-zinc-200">Profile</h1>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Account</h2>
        <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
          <Field label="Display name" value={user?.display_name} />
          <Field label="Username" value={user?.username ? `@${user.username}` : null} />
          <Field label="Phone" value={user?.phone} />
          <Field label="Storage" value="Telegram" />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
          {hasPassword ? "Change password" : "Set a password"}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {hasPassword
            ? "Update the password you use to sign in without a Telegram code."
            : "Set a password to sign in with your username or phone — no Telegram code needed."}
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {hasPassword ? (
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Current password"
            />
          ) : null}
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasPassword ? "New password" : "Password"}
          />
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button type="submit" disabled={busy || !password || !confirm || (hasPassword && !current)}>
            {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
          </Button>
        </form>
        <p className="mt-3 text-xs text-zinc-400">At least 8 characters.</p>
      </section>
    </div>
  );
}
