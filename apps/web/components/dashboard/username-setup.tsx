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
      <div className="mb-8 flex items-center gap-3 text-zinc-900">
        <LogoMark className="h-9 w-9" />
        <span className="type-heading-sm">BYOS</span>
      </div>
      <h1 className="type-heading-sm">Choose your username</h1>
      <p className="mt-1 text-[0.9375rem] text-zinc-500">
        It&apos;s unique and permanent. Your shareable links live at{" "}
        <code className="rounded bg-zinc-100 px-1">/{username || "you"}/…</code>
      </p>

      <form onSubmit={submit} className="mt-6">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-4 transition-colors focus-within:border-zinc-900">
          <span className="text-[0.9375rem] text-zinc-400">/</span>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="username"
            autoFocus
            className="border-0 bg-transparent px-0 focus:border-0 focus:ring-0"
          />
        </div>
        {error ? <p className="mt-2 text-[0.9375rem] text-red-600">{error}</p> : null}
        <Button type="submit" className="mt-4 w-full" disabled={busy || username.trim().length < 3}>
          {busy ? "Saving…" : "Continue"}
        </Button>
      </form>
      <p className="mt-3 text-[0.8125rem] text-zinc-400">
        3–30 characters: letters, numbers, hyphens, or underscores.
      </p>
    </main>
  );
}
