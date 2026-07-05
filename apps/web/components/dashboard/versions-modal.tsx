"use client";

import { ApiError, type FileItem, type VersionItem } from "@byos/api-client";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function VersionsModal({
  file,
  onClose,
  onChanged,
}: {
  file: FileItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setVersions(await authed((t) => api.listVersions(t, file.id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load versions");
    } finally {
      setLoading(false);
    }
  }, [authed, file.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = (fn: () => Promise<void>, successMsg?: string) => {
    setError(null);
    setBusy(true);
    (async () => {
      try {
        await fn();
        await load();
        onChanged();
        if (successMsg) toast(successMsg);
      } catch (err) {
        const m = err instanceof ApiError ? err.detail : "Action failed";
        setError(m);
        toast(m, "error");
      } finally {
        setBusy(false);
      }
    })();
  };

  const replace = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    act(async () => {
      await authed((t) => api.replaceFile(t, file.id, f));
      if (inputRef.current) inputRef.current.value = "";
    }, "File replaced — link now serves the new version");
  };

  const download = (v: VersionItem) => {
    setError(null);
    authed((t) => api.downloadVersionBlob(t, file.id, v.id))
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${file.name}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })
      .catch((err) => setError(err instanceof ApiError ? err.detail : "Download failed"));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-900">Versions · {file.name}</p>
            <p className="text-xs text-zinc-500">Replacing keeps the same links; they serve the latest.</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-zinc-100 px-4 py-3">
          <Button disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "Working…" : "Replace with new file"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(e) => replace(e.target.files)}
          />
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="p-4 text-sm text-zinc-500">Loading…</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900">
                      v{v.version_no}
                      {v.is_current ? (
                        <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          current
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {humanSize(v.size)} · {new Date(v.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs font-medium">
                    <button
                      onClick={() => download(v)}
                      className="text-indigo-600 hover:underline"
                    >
                      Download
                    </button>
                    {!v.is_current && (
                      <button
                        onClick={() => act(() => authed((t) => api.restoreVersion(t, file.id, v.id)).then(() => undefined), "Version restored — link now serves this version")}
                        className="text-zinc-700 hover:underline"
                      >
                        Restore
                      </button>
                    )}
                    {!v.is_current && (
                      <button
                        onClick={() => act(() => authed((t) => api.deleteVersion(t, file.id, v.id)), "Version deleted")}
                        className="text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
