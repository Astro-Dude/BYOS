"use client";

import type { HealthResponse } from "@byos/api-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (user) api.health().then(setHealth).catch(() => setHealth(null));
  }, [user]);

  if (loading || !user) {
    return <div className="p-8 text-sm text-zinc-500">Loading…</div>;
  }

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">BYOS</span>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-500">{user.email}</span>
          <Button onClick={onLogout} className="bg-zinc-900 hover:bg-zinc-700">
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Your dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {health
            ? `Connected to API (${health.environment}) — storage providers available: ${
                health.providers.join(", ") || "none yet"
              }.`
            : "Connecting to the API…"}
        </p>

        <div className="mt-12 flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-200 py-20 text-center">
          <p className="text-base font-medium text-zinc-900">No files yet</p>
          <p className="mt-1 max-w-md text-sm text-zinc-500">
            Connect a storage provider (Telegram comes first) to start uploading. Folders, search,
            previews, versioning, and dynamic aliases arrive in the next phases.
          </p>
        </div>
      </main>
    </div>
  );
}
