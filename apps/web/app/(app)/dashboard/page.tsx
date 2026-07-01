"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AliasesPanel } from "@/components/dashboard/aliases-panel";
import { FilesPanel } from "@/components/dashboard/files-panel";
import { TelegramPanel } from "@/components/dashboard/telegram-panel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [aliasRefresh, setAliasRefresh] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

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

      <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Connect Telegram, then upload files straight into your own storage.
          </p>
        </div>

        <TelegramPanel />
        <FilesPanel onAliasCreated={() => setAliasRefresh((v) => v + 1)} />
        <AliasesPanel refreshKey={aliasRefresh} />
      </main>
    </div>
  );
}
