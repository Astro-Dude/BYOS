import type { StorageAccount } from "@byos/api-client";
import { Cylinder, HardDrive, Send } from "lucide-react";

/** GitHub's mark, from Octicons (MIT). Lucide no longer ships brand icons. */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

export const PROVIDER_NAMES: Record<string, string> = {
  telegram: "Telegram",
  github: "GitHub",
  s3: "S3",
  local: "This server",
};

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

/** The mark for a storage provider. */
export function StorageIcon({ provider, className = "h-4 w-4" }: { provider: string; className?: string }) {
  if (provider === "github") return <GitHubMark className={className} />;
  if (provider === "telegram") return <Send className={className} />;
  if (provider === "s3") return <Cylinder className={className} />;
  return <HardDrive className={className} />;
}

/** "GitHub · owner/repo" style description of where something is stored. */
export function storageTitle(s: Pick<StorageAccount, "provider" | "label">): string {
  return s.label ? `${providerName(s.provider)} · ${s.label}` : providerName(s.provider);
}

/** How a storage is doing, for warnings: working, its GitHub token running out
 *  soon, or needing new credentials before its files can be reached. */
export type StorageHealth =
  | { state: "ok"; expiresAt: Date | null }
  | { state: "expiring"; expiresAt: Date; days: number }
  | { state: "expired" }
  | { state: "disconnected" };

/** Days of warning before a token runs out. */
export const EXPIRY_WARNING_DAYS = 14;

export function storageHealth(s: Pick<StorageAccount, "status" | "token_expires_at">): StorageHealth {
  if (s.status === "expired") return { state: "expired" };
  if (s.status !== "connected") return { state: "disconnected" };
  const expiresAt = s.token_expires_at ? new Date(s.token_expires_at) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return { state: "ok", expiresAt: null };
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return { state: "expired" };
  if (days <= EXPIRY_WARNING_DAYS) return { state: "expiring", expiresAt, days };
  return { state: "ok", expiresAt };
}

/** "today", "tomorrow", "in 5 days". */
export function inDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** What needs replacing for this storage, in its own terms. */
export function credentialName(provider: string): string {
  if (provider === "github") return "token";
  if (provider === "s3") return "keys";
  return "login";
}
