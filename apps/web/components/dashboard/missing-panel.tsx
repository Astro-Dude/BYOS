"use client";

import { ApiError, type FileItem } from "@byos/api-client";
import { FileWarning, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { fileIcon } from "@/components/dashboard/file-icon";
import { ViewEmpty, ViewHeader } from "@/components/dashboard/view-header";
import { StorageIcon, providerName } from "@/components/storage-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";
import { formatBytes, truncateMiddle } from "@/lib/utils";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Files whose bytes were deleted straight from their storage (in Telegram,
 *  the GitHub repo or the S3 bucket), outside BYOS. Report them first (a
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
          ? `Checked ${checked} file(s). ${found} missing.`
          : `Checked ${checked} file(s). All there.`,
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

  const lostBytes = missing.reduce((n, f) => n + (f.size ?? 0), 0);
  const providers = [...new Set(missing.map((f) => f.provider))];

  return (
    <div className="pt-2">
      <ViewHeader
        label="Clean up"
        title="Missing files"
        description="Files whose contents were deleted straight from Telegram, GitHub or S3, outside BYOS. Their records are still here, but there's nothing behind them to open."
        actions={
          <>
            {missing.length > 0 ? (
              <button
                onClick={() => setConfirmAll(true)}
                disabled={clearing}
                className="pill-sm-ghost inline-flex items-center gap-1.5 hover:!border-[rgb(var(--c-danger-600))] hover:!text-[rgb(var(--c-danger-600))] disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Remove all
              </button>
            ) : null}
            <button onClick={scan} disabled={scanning} className="pill-sm-filled inline-flex items-center gap-1.5 disabled:opacity-60">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {scanning ? "Scanning…" : "Scan now"}
            </button>
          </>
        }
        stats={
          missing.length
            ? [
                { value: missing.length, label: missing.length === 1 ? "file missing" : "files missing" },
                { value: formatBytes(lostBytes), label: "no longer in storage" },
                { value: providers.length, label: providers.length === 1 ? "storage affected" : "storages affected" },
              ]
            : undefined
        }
      />

      {scanning ? (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-[0.875rem] text-zinc-700">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Checking every file against its storage. Large drives take a minute.
          <span className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-zinc-100">
            <span className="missing-scan block h-full w-1/3 rounded-full bg-zinc-900" />
          </span>
        </div>
      ) : null}

      {error ? <p className="mb-4 text-[0.9375rem] text-red-600">{error}</p> : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : missing.length === 0 ? (
        <ViewEmpty
          tone="go"
          icon={<ShieldCheck className="h-6 w-6" />}
          title="Nothing missing"
          body="Every file in your drive is still in its storage. Run a scan after tidying Telegram, GitHub or S3 by hand to be sure."
        />
      ) : (
        <>
          <div className="mb-3 flex items-start gap-3 rounded-2xl bg-[rgb(var(--c-caution-50))] px-4 py-3 text-[0.875rem] leading-[1.5] text-zinc-800 ring-1 ring-inset ring-[rgb(var(--c-caution-300))]">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--c-caution-500))]" />
            <span>
              BYOS can&apos;t bring these back: the bytes are gone from the storage itself. If you still have a
              copy, upload it again. Otherwise remove the record so it stops showing in your drive.
            </span>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {missing.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 last:border-b-0 hover:bg-zinc-50"
              >
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 opacity-70" aria-hidden>
                  {fileIcon(file.mime, file.ext)}
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--c-danger-500))] text-[0.625rem] font-bold text-[rgb(var(--c-paper))] ring-2 ring-white">
                    !
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-medium text-zinc-900">{file.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      <StorageIcon provider={file.provider} className="h-3.5 w-3.5" />
                      {providerName(file.provider)}
                    </span>
                    <span>· {formatBytes(file.size ?? 0)}</span>
                    {file.missing_at ? <span>· Gone since {shortDate(file.missing_at)}</span> : null}
                  </span>
                </div>
                <button
                  onClick={() => setRemoving(file)}
                  className="pill-sm-ghost shrink-0 hover:!border-[rgb(var(--c-danger-600))] hover:!text-[rgb(var(--c-danger-600))]"
                >
                  Remove record
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {removing ? (
        <ConfirmModal
          title="Remove record?"
          message={`“${truncateMiddle(removing.name)}” is already gone from its storage. This removes its record (and versions) from BYOS. This can't be undone.`}
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
          message="These files are already gone from their storage. This removes their records (and versions) from BYOS. This can't be undone."
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
