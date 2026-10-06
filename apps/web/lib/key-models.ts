"use client";

import type { AiKey } from "@byos/api-client";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

// Ids a /models list includes that can't chat: speech, images, moderation.
const NOT_CHAT_RE = /embed|whisper|tts|dall-e|moderation|transcribe|image|audio|realtime|rerank|guard/i;

export function isChatModel(id: string): boolean {
  return !NOT_CHAT_RE.test(id);
}

/** The models a saved key can use, remembered in this browser for a day so the
 *  picker opens at once. Only model names are stored, never the API key. */
const STORAGE_KEY = "byos:key-models";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Entry = { models: string[]; at: number };

function readAll(): Record<string, Entry> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

function cacheKey(key: AiKey): string {
  return `${key.id}|${key.base_url.trim().replace(/\/+$/, "").toLowerCase()}`;
}

function cached(key: AiKey): string[] | null {
  const entry = readAll()[cacheKey(key)];
  if (!entry || Date.now() - entry.at > MAX_AGE_MS || !Array.isArray(entry.models)) return null;
  return entry.models;
}

function remember(key: AiKey, models: string[]): void {
  try {
    const all = readAll();
    all[cacheKey(key)] = { models, at: Date.now() };
    const kept = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 20);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage unavailable: it asks again next time */
  }
}

type Authed = ReturnType<typeof useAuthed>;

/** The chat models `key` can switch to: from this browser's copy when it's
 *  fresh, else asked of the provider (and remembered). */
export async function loadKeyModels(authed: Authed, key: AiKey, fresh = false): Promise<string[]> {
  const known = fresh ? null : cached(key);
  if (known) return known;
  const res = await authed((t) => api.listProviderModels(t, { base_url: key.base_url, key_id: key.id }));
  const chat = res.models.filter(isChatModel);
  remember(key, chat);
  return chat;
}

/** The model a typed name most likely means: exact, then prefix, then contains. */
export function matchModel(models: string[], typed: string): string | undefined {
  const q = typed.trim().toLowerCase();
  if (!q) return undefined;
  return (
    models.find((m) => m.toLowerCase() === q) ??
    models.find((m) => m.toLowerCase().split("/").pop() === q) ??
    models.find((m) => m.toLowerCase().startsWith(q)) ??
    models.find((m) => m.toLowerCase().includes(q))
  );
}
