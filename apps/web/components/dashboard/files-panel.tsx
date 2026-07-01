"use client";

import { ApiError, type FileItem } from "@byos/api-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

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

export function FilesPanel() {
  const authed = useAuthed();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await authed((t) => api.listFiles(t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(fileList)) {
        await authed((t) => api.uploadFile(t, file));
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (file: FileItem) => {
    setError(null);
    try {
      const blob = await authed((t) => api.downloadBlob(t, file.id));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Defer revoke so the browser can start reading the blob first
      // (synchronous revoke breaks downloads in Firefox/Safari).
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Download failed");
    }
  };

  const remove = async (file: FileItem) => {
    setError(null);
    try {
      await authed((t) => api.deleteFile(t, file.id));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Delete failed");
    }
  };

  return (
    <section>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center transition ${
          dragging ? "border-indigo-500 bg-indigo-50" : "border-zinc-200"
        }`}
      >
        <p className="text-sm text-zinc-600">
          {busy ? "Uploading…" : "Drag & drop files here, or"}
        </p>
        <Button
          className="mt-3"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-zinc-500">Loading files…</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-zinc-500">No files yet — upload something above.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {files.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                  <p className="text-xs text-zinc-500">
                    {humanSize(file.size)} · {file.provider}
                    {file.mime ? ` · ${file.mime}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void download(file)}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => void remove(file)}
                    className="text-sm font-medium text-red-600 hover:text-red-500"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
