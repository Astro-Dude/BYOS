"use client";

import { ApiError, type FileItem } from "@byos/api-client";
import { FileWarning, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { fileIcon } from "@/components/dashboard/file-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";
import { truncateMiddle } from "@/lib/utils";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Files whose bytes were deleted directly in Telegram. Report them first (a
 *  scan re-checks every file against the provider), then let the user remove
 *  the dangling record from BYOS. */
export function MissingPanel() {
  const authed = useAuthed();
  const toast = useToast();
  const [missing, setMissing] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FileItem | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMissing(await authed((t) => api.listMissing(t)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load missing files");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const { checked, missing: found } = await authed((t) => api.verifyFiles(t));
      toast(
        found > 0
          ? `Scanned ${checked} file(s) — ${found} missing`
          : `Scanned ${checked} file(s) — all present`,
      );
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : "Scan failed";
      setError(msg);
      toast(msg, "error");
    } finally {
      setScanning(false);
    }
  };

  const remove = (file: FileItem) => {
    // Optimistic — delete is idempotent, so a failed request just resyncs next scan.
    setMissing((prev) => prev.filter((f) => f.id !== file.id));
    authed((t) => api.deleteFile(t, file.id))
      .then(() => toast("Record removed"))
      .catch((err) => {
        toast(err instanceof ApiError ? err.detail : "Failed to remove", "error");
        void load();
      });
  };

  const removeAll = async () => {
    setClearing(true);
    setMissing([]); // optimistic; resync from the server if it fails
    try {
      const { removed } = await authed((t) => api.clearMissing(t));
      toast(`Removed ${removed} record${removed === 1 ? "" : "s"}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Failed to remove records", "error");
      await load();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-normal text-zinc-800 dark:text-zinc-200">Missing files</h1>
          <p className="text-sm text-zinc-500">
            Files whose contents were deleted directly in Telegram. Scan to re-check every file.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {missing.length > 0 ? (
            <button
              onClick={() => setConfirmAll(true)}
              disabled={clearing}
              className="flex items-center gap-2 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-500/40 dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
              Remove all
            </button>
          ) : null}
          <Button onClick={scan} disabled={scanning} className="flex items-center gap-2">
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : missing.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-zinc-200 p-10 text-center dark:border-zinc-800">
          <FileWarning className="h-8 w-8 text-zinc-300" />
          <p className="mt-2 text-sm text-zinc-500">
            No missing files detected. Everything in your drive is still in Telegram.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {missing.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-4 py-3">
              <span aria-hidden>{fileIcon(file.mime, file.ext)}</span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {file.name}
                </span>
                {file.missing_at ? (
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    Gone since {shortDate(file.missing_at)}
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => setRemoving(file)}
                className="shrink-0 text-sm font-medium text-red-600 hover:text-red-500"
              >
                Remove record
              </button>
            </li>
          ))}
        </ul>
      )}

      {removing ? (
        <ConfirmModal
          title="Remove record?"
          message={`“${truncateMiddle(removing.name)}” is already gone from Telegram. This removes its record (and versions) from BYOS. This can't be undone.`}
          confirmLabel="Remove record"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            remove(removing);
            setRemoving(null);
          }}
        />
      ) : null}

      {confirmAll ? (
        <ConfirmModal
          title={`Remove all ${missing.length} missing record${missing.length === 1 ? "" : "s"}?`}
          message="These files are already gone from Telegram. This removes their records (and versions) from BYOS. This can't be undone."
          confirmLabel="Remove all"
          onCancel={() => setConfirmAll(false)}
          onConfirm={() => {
            setConfirmAll(false);
            void removeAll();
          }}
        />
      ) : null}
    </div>
  );
}
