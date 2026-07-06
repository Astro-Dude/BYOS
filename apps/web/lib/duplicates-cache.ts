// Client-side stale-while-revalidate cache for the Duplicates view. Stored in
// localStorage (per browser), so reopening the tab paints instantly. It's
// cleared whenever files change (upload/delete) so we never show stale groups.
import type { DuplicateGroup } from "@byos/api-client";

const KEY = "byos:duplicates";

export function getCachedDuplicates(): DuplicateGroup[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DuplicateGroup[]) : null;
  } catch {
    return null;
  }
}

export function setCachedDuplicates(groups: DuplicateGroup[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(groups));
  } catch {
    // best-effort
  }
}

export function clearDuplicatesCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
}
