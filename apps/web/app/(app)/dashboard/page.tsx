"use client";

import {
  ApiError,
  type Breadcrumb,
  type FileItem,
  type FolderItem,
} from "@byos/api-client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AliasModal } from "@/components/dashboard/alias-modal";
import { AliasesPanel } from "@/components/dashboard/aliases-panel";
import { PreviewModal } from "@/components/dashboard/preview-modal";
import { Sidebar, type DriveView } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";

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

function fileIcon(mime: string | null, ext: string | null): string {
  const m = mime ?? "";
  if (m.startsWith("image/")) return "🖼️";
  if (m.startsWith("video/")) return "🎬";
  if (m.startsWith("audio/")) return "🎵";
  if (m === "application/pdf" || ext === "pdf") return "📕";
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext ?? "")) return "🗜️";
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext ?? "")) return "📄";
  return "📄";
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const authed = useAuthed();

  const [view, setView] = useState<DriveView>("drive");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [crumbs, setCrumbs] = useState<Breadcrumb[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<FileItem[] | null>(null);

  const [nfOpen, setNfOpen] = useState(false);
  const [nfName, setNfName] = useState("");
  const [aliasRefresh, setAliasRefresh] = useState(0);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [aliasFor, setAliasFor] = useState<FileItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchActive = search.trim().length > 0;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

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
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (!search.trim()) {
        setResults(null);
        return;
      }
      authed((t) => api.searchFiles(t, search.trim()))
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(id);
  }, [search, authed]);

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
    const name = nfName.trim();
    if (!name) return;
    void run(async () => {
      await authed((t) => api.createFolder(t, name, folderId));
      setNfName("");
      setNfOpen(false);
      await load();
    });
  };

  const download = (file: FileItem) =>
    void run(async () => {
      const blob = await authed((t) => api.downloadBlob(t, file.id));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  const removeFile = (file: FileItem) =>
    void run(async () => {
      await authed((t) => api.deleteFile(t, file.id));
      if (searchActive) setResults((r) => (r ? r.filter((f) => f.id !== file.id) : r));
      else await load();
    });

  const removeFolder = (folder: FolderItem) =>
    void run(async () => {
      await authed((t) => api.deleteFolder(t, folder.id));
      await load();
    });

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (authLoading || !user) {
    return <div className="p-8 text-sm text-zinc-500">Loading…</div>;
  }

  const shownFiles = searchActive ? (results ?? []) : files;
  const shownFolders = searchActive ? [] : folders;

  const actionButton = (label: string, onClick: () => void, tone = "text-zinc-600") => (
    <button onClick={onClick} className={`text-xs font-medium ${tone} hover:underline`}>
      {label}
    </button>
  );

  const fileActions = (file: FileItem) => (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {actionButton("Preview", () => setPreview(file))}
      {actionButton("Download", () => download(file), "text-indigo-600")}
      {actionButton("Link", () => setAliasFor(file))}
      {actionButton("Delete", () => removeFile(file), "text-red-600")}
    </div>
  );

  return (
    <div className="flex h-screen bg-zinc-50">
      <Sidebar view={view} onView={setView} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-6 py-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search in BYOS…"
            className="max-w-xl"
          />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-500">{user.display_name ?? "Signed in"}</span>
            <Button onClick={onLogout} className="bg-zinc-900 hover:bg-zinc-700">
              Log out
            </Button>
          </div>
        </header>

        <main
          className="flex-1 overflow-auto p-6"
          onDragOver={(e) => {
            if (view === "drive" && !searchActive) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (view === "drive" && !searchActive) {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }
          }}
        >
          {view === "links" ? (
            <AliasesPanel refreshKey={aliasRefresh} />
          ) : (
            <div className={dragging ? "rounded-xl ring-2 ring-indigo-400 ring-offset-4" : ""}>
              {/* Breadcrumb + toolbar */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                {searchActive ? (
                  <p className="text-sm text-zinc-500">
                    Results for “{search.trim()}”
                  </p>
                ) : (
                  <nav className="flex flex-wrap items-center gap-1 text-sm text-zinc-500">
                    <button
                      onClick={() => setFolderId(undefined)}
                      className={folderId ? "hover:text-zinc-900" : "font-medium text-zinc-900"}
                    >
                      My Drive
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
                )}

                {!searchActive && (
                  <div className="flex items-center gap-2">
                    {nfOpen ? (
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          value={nfName}
                          onChange={(e) => setNfName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && createFolder()}
                          placeholder="Folder name"
                          className="h-9 w-40"
                        />
                        <Button onClick={createFolder} disabled={busy || !nfName.trim()}>
                          Create
                        </Button>
                        <Button
                          onClick={() => setNfOpen(false)}
                          className="border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={() => setNfOpen(true)}
                        className="border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      >
                        + New folder
                      </Button>
                    )}
                    <Button onClick={() => inputRef.current?.click()} disabled={busy}>
                      {busy ? "Working…" : "Upload"}
                    </Button>
                    <button
                      onClick={() => setLayout((l) => (l === "grid" ? "list" : "grid"))}
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                    >
                      {layout === "grid" ? "☰ List" : "▦ Grid"}
                    </button>
                    <input
                      ref={inputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => upload(e.target.files)}
                    />
                  </div>
                )}
              </div>

              {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

              {loading && !searchActive ? (
                <p className="text-sm text-zinc-500">Loading…</p>
              ) : shownFolders.length === 0 && shownFiles.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  {searchActive ? "No matching files." : "This folder is empty — upload or drop files here."}
                </p>
              ) : layout === "grid" ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {shownFolders.map((folder) => (
                    <div
                      key={folder.id}
                      className="group rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
                    >
                      <button
                        onClick={() => setFolderId(folder.id)}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span className="text-2xl" aria-hidden>📁</span>
                        <span className="truncate text-sm font-medium text-zinc-900">
                          {folder.name}
                        </span>
                      </button>
                      <div className="mt-3 opacity-0 transition group-hover:opacity-100">
                        {actionButton("Delete", () => removeFolder(folder), "text-red-600")}
                      </div>
                    </div>
                  ))}
                  {shownFiles.map((file) => (
                    <div
                      key={file.id}
                      className="group rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-2xl" aria-hidden>{fileIcon(file.mime, file.ext)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                          <p className="text-xs text-zinc-500">{humanSize(file.size)}</p>
                        </div>
                      </div>
                      <div className="mt-3 opacity-0 transition group-hover:opacity-100">
                        {fileActions(file)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
                  {shownFolders.map((folder) => (
                    <li key={folder.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <button
                        onClick={() => setFolderId(folder.id)}
                        className="flex min-w-0 items-center gap-2 text-left"
                      >
                        <span aria-hidden>📁</span>
                        <span className="truncate text-sm font-medium text-zinc-900">
                          {folder.name}
                        </span>
                      </button>
                      {actionButton("Delete", () => removeFolder(folder), "text-red-600")}
                    </li>
                  ))}
                  {shownFiles.map((file) => (
                    <li key={file.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span aria-hidden>{fileIcon(file.mime, file.ext)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                          <p className="text-xs text-zinc-500">
                            {humanSize(file.size)} · {file.provider}
                          </p>
                        </div>
                      </div>
                      {fileActions(file)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </main>
      </div>

      {preview ? <PreviewModal file={preview} onClose={() => setPreview(null)} /> : null}
      {aliasFor ? (
        <AliasModal
          file={aliasFor}
          onClose={() => setAliasFor(null)}
          onCreated={() => setAliasRefresh((v) => v + 1)}
        />
      ) : null}
    </div>
  );
}
