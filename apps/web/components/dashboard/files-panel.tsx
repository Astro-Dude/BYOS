"use client";

import { ApiError, type Breadcrumb, type FileItem, type FolderItem } from "@byos/api-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { AliasModal } from "@/components/dashboard/alias-modal";
import { PreviewModal } from "@/components/dashboard/preview-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function FilesPanel({ onAliasCreated }: { onAliasCreated?: () => void }) {
  const authed = useAuthed();
  const [folderId, setFolderId] = useState<string | undefined>(undefined); // undefined = root
  const [crumbs, setCrumbs] = useState<Breadcrumb[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<FileItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [aliasFor, setAliasFor] = useState<FileItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchActive = search.trim().length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fld, fls, bc] = await Promise.all([
        authed((t) => api.listFolders(t, folderId)),
        authed((t) => api.listFiles(t, folderId)),
        folderId ? authed((t) => api.folderBreadcrumb(t, folderId)) : Promise.resolve([]),
      ]);
      setFolders(fld);
      setFiles(fls);
      setCrumbs(bc);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [authed, folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setResults(null);
        return;
      }
      setSearching(true);
      try {
        setResults(await authed((t) => api.searchFiles(t, query)));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [authed],
  );

  useEffect(() => {
    const id = setTimeout(() => void runSearch(search), 300);
    return () => clearTimeout(id);
  }, [search, runSearch]);

  const refresh = useCallback(async () => {
    if (searchActive) await runSearch(search);
    else await load();
  }, [searchActive, runSearch, search, load]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const upload = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    void run(async () => {
      for (const file of Array.from(fileList)) {
        await authed((t) => api.uploadFile(t, file, folderId));
      }
      await load();
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  const createFolder = () => {
    const name = newFolder.trim();
    if (!name) return;
    void run(async () => {
      await authed((t) => api.createFolder(t, name, folderId));
      setNewFolder("");
      await load();
    });
  };

  const download = (file: FileItem) =>
    void run(async () => {
      const blob = await authed((t) => api.downloadBlob(t, file.id));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  const removeFile = (file: FileItem) =>
    void run(async () => {
      await authed((t) => api.deleteFile(t, file.id));
      await refresh();
    });

  const removeFolder = (folder: FolderItem) =>
    void run(async () => {
      await authed((t) => api.deleteFolder(t, folder.id));
      await load();
    });

  const fileRow = (file: FileItem) => (
    <li key={file.id} className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden>📄</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
          <p className="text-xs text-zinc-500">
            {humanSize(file.size)} · {file.provider}
            {file.mime ? ` · ${file.mime}` : ""}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-3">
        <button
          onClick={() => setAliasFor(file)}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          Link
        </button>
        <button
          onClick={() => setPreview(file)}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          Preview
        </button>
        <button
          onClick={() => download(file)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          Download
        </button>
        <button
          onClick={() => removeFile(file)}
          className="text-sm font-medium text-red-600 hover:text-red-500"
        >
          Delete
        </button>
      </div>
    </li>
  );

  return (
    <>
      <section>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search files by name, extension, or type…"
        className="mb-4"
      />

      {searchActive ? (
        <div>
          <p className="mb-2 text-sm text-zinc-500">
            {searching ? "Searching…" : `Results for “${search.trim()}”`}
          </p>
          {results && results.length > 0 ? (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              {results.map(fileRow)}
            </ul>
          ) : (
            !searching && <p className="text-sm text-zinc-500">No matching files.</p>
          )}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </div>
      ) : (
        <div>
          <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-zinc-500">
            <button
              onClick={() => setFolderId(undefined)}
              className={folderId ? "hover:text-zinc-900" : "font-medium text-zinc-900"}
            >
              Home
            </button>
            {crumbs.map((c) => (
              <span key={c.id} className="flex items-center gap-1">
                <span className="text-zinc-300">/</span>
                <button
                  onClick={() => setFolderId(c.id)}
                  className={
                    c.id === folderId ? "font-medium text-zinc-900" : "hover:text-zinc-900"
                  }
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="New folder name"
              className="max-w-xs"
            />
            <Button onClick={createFolder} disabled={busy || !newFolder.trim()}>
              New folder
            </Button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-10 text-center transition ${
              dragging ? "border-indigo-500 bg-indigo-50" : "border-zinc-200"
            }`}
          >
            <p className="text-sm text-zinc-600">
              {busy ? "Working…" : "Drag & drop files here, or"}
            </p>
            <Button className="mt-3" disabled={busy} onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => upload(e.target.files)}
            />
          </div>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

          <div className="mt-6">
            {loading ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : folders.length === 0 && files.length === 0 ? (
              <p className="text-sm text-zinc-500">This folder is empty.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {folders.map((folder) => (
                  <li
                    key={folder.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <button
                      onClick={() => setFolderId(folder.id)}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      <span aria-hidden>📁</span>
                      <span className="truncate text-sm font-medium text-zinc-900">
                        {folder.name}
                      </span>
                    </button>
                    <button
                      onClick={() => removeFolder(folder)}
                      className="shrink-0 text-sm font-medium text-red-600 hover:text-red-500"
                    >
                      Delete
                    </button>
                  </li>
                ))}
                {files.map(fileRow)}
              </ul>
            )}
          </div>
        </div>
      )}
      </section>
      {preview ? <PreviewModal file={preview} onClose={() => setPreview(null)} /> : null}
      {aliasFor ? (
        <AliasModal
          file={aliasFor}
          onClose={() => setAliasFor(null)}
          onCreated={() => onAliasCreated?.()}
        />
      ) : null}
    </>
  );
}
