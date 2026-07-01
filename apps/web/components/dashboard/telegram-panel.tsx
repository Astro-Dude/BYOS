"use client";

import type { ProviderStatus } from "@byos/api-client";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

export function TelegramPanel() {
  const authed = useAuthed();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    authed((t) => api.listProviders(t))
      .then(setProviders)
      .catch(() => setProviders([]));
  }, [authed]);

  const telegram = providers.find((p) => p.provider === "telegram");

  return (
    <section className="rounded-lg border border-zinc-200 p-5">
      <h2 className="font-semibold text-zinc-900">Storage</h2>
      <p className="text-sm text-zinc-500">
        {telegram
          ? `Telegram connected${telegram.label ? ` as ${telegram.label}` : ""} — your files are stored in your own Saved Messages.`
          : "Connecting your storage…"}
      </p>
    </section>
  );
}
