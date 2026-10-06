"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { SettingsShell } from "@/components/settings/shell";
import { useAuth } from "@/lib/auth-context";

/** Where "Back" goes. Links into Settings say where they came from
 *  (`?from=byok`); it's kept for the visit so moving between sections doesn't
 *  lose it. Anything else goes back to the Drive. */
const ORIGINS = {
  drive: { href: "/dashboard", label: "Back to Drive" },
  byok: { href: "/byok", label: "Back to BYOK" },
} as const;
type Origin = keyof typeof ORIGINS;
const ORIGIN_KEY = "byos:settings-from";

function useOrigin(): Origin {
  const [origin, setOrigin] = useState<Origin>("drive");
  useEffect(() => {
    const isOrigin = (v: string | null): v is Origin => v === "drive" || v === "byok";
    const fromUrl = new URLSearchParams(window.location.search).get("from");
    try {
      if (isOrigin(fromUrl)) sessionStorage.setItem(ORIGIN_KEY, fromUrl);
      const saved = sessionStorage.getItem(ORIGIN_KEY);
      setOrigin(isOrigin(fromUrl) ? fromUrl : isOrigin(saved) ? saved : "drive");
    } catch {
      setOrigin(isOrigin(fromUrl) ? fromUrl : "drive");
    }
  }, []);
  return origin;
}

/** Settings: signed-in only, with the way back to where it was opened from.
 *  The layout itself is SettingsShell. Each section is its own URL. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname.split("/")[2] ?? "profile";
  const back = ORIGINS[useOrigin()];

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return <div className="min-h-screen bg-white" />;

  return (
    <SettingsShell active={pathname === "/settings" ? null : active} back={back} user={user}>
      {children}
    </SettingsShell>
  );
}
