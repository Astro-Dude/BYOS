"use client";

import { ApiError } from "@byos/api-client";
import { type FormEvent, useState } from "react";

import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

/** Blocking first-run step: pick a unique username. Your links live at
 *  /{username}/{slug}. Shown until the account has a username. */
export function UsernameSetup() {
  const authed = useAuthed();
  const toast = useToast();
  const { refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authed((t) => api.setUsername(t, username.trim()));
      toast(`Welcome, @${username.trim()}`);
      await refresh(); // context user now has a username → the gate clears
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't set username");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-8 flex items-center gap-3 text-indigo-600">
        <LogoMark className="h-9 w-9" />
        <span className="font-brand text-2xl font-bold tracking-tight">BYOS</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose your username</h1>
      <p className="mt-1 text-sm text-zinc-500">
        It&apos;s unique and permanent. Your shareable links live at{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1">/{username || "you"}/…</code>
      </p>

      <form onSubmit={submit} className="mt-6">
        <div className="flex items-center rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
          <span className="text-sm text-zinc-400">/</span>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="username"
            autoFocus
            className="border-0 focus:ring-0"
          />
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="mt-4 w-full" disabled={busy || username.trim().length < 3}>
          {busy ? "Saving…" : "Continue"}
        </Button>
      </form>
      <p className="mt-3 text-xs text-zinc-400">
        3–30 characters: letters, numbers, hyphens, or underscores.
      </p>
    </main>
  );
}
