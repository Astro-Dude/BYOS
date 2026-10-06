import type { ModelCheck } from "@byos/api-client";

/** What a model takes (refused settings, reasoning levels), remembered in this
 *  browser so opening a key doesn't cost a test request every time. Keyed on
 *  the endpoint and model: what a model supports doesn't depend on whose API
 *  key calls it, so nothing secret is stored. Entries expire after a while, in
 *  case a provider changes what a model accepts. */
const STORAGE_KEY = "byos:model-checks";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 60;

type Entry = { check: ModelCheck; at: number };

function keyFor(baseUrl: string, model: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "").toLowerCase()}|${model.trim()}`;
}

function readAll(): Record<string, Entry> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

export function cachedModelCheck(baseUrl: string, model: string): ModelCheck | null {
  const entry = readAll()[keyFor(baseUrl, model)];
  if (!entry || Date.now() - entry.at > MAX_AGE_MS) return null;
  const { unsupported, efforts } = entry.check ?? {};
  return Array.isArray(unsupported) && Array.isArray(efforts) ? { unsupported, efforts } : null;
}

export function rememberModelCheck(baseUrl: string, model: string, check: ModelCheck): void {
  try {
    const all = readAll();
    all[keyFor(baseUrl, model)] = { check, at: Date.now() };
    // Keep the newest few.
    const kept = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage unavailable: it just checks again next time */
  }
}
