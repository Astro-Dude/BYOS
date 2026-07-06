"use client";

import { ApiError, type DuplicateGroup } from "@byos/api-client";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

export function DuplicatesPanel() {
  const authed = useAuthed();
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDuplicates(await authed((t) => api.listDuplicates(t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h1 className="text-2xl font-normal text-zinc-800 dark:text-zinc-200">Duplicates</h1>
        <p className="text-sm text-zinc-500">Files with identical content, grouped by hash.</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : duplicates.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 p-10 text-center text-sm text-zinc-400 dark:border-zinc-800">
          No duplicates found — nice and tidy.
        </div>
      ) : (
        <ul className="space-y-3">
          {duplicates.map((group) => (
            <li
              key={group.hash}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="mb-1.5 text-xs font-medium text-zinc-500">
                {group.files.length} copies · identical content
              </div>
              <ul className="space-y-1">
                {group.files.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="truncate">{file.name}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
