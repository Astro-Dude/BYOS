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
import { ActivityPanel } from "@/components/dashboard/activity-panel";
import { AliasesPanel } from "@/components/dashboard/aliases-panel";
import { DeveloperPanel } from "@/components/dashboard/developer-panel";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { Menu, MenuItem } from "@/components/dashboard/menu";
import { PreviewModal } from "@/components/dashboard/preview-modal";
import { ShareModal } from "@/components/dashboard/share-modal";
import { SharesPanel } from "@/components/dashboard/shares-panel";
import { Sidebar, type DriveView } from "@/components/dashboard/sidebar";
import { TagsModal } from "@/components/dashboard/tags-modal";
import { VersionsModal } from "@/components/dashboard/versions-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";

type Category = "all" | "folder" | "image" | "pdf" | "doc" | "video";
const CATEGORIES: { key: Category; label: string }[] = [
  { key: "all", label: "All types" },
  { key: "folder", label: "Folders" },
  { key: "image", label: "Images" },
  { key: "pdf", label: "PDFs" },
  { key: "doc", label: "Documents" },
  { key: "video", label: "Video" },
];

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
  return "📄";
}

function matchesType(file: FileItem, cat: Category): boolean {
  const m = (file.mime ?? "").toLowerCase();
  const ext = (file.ext ?? "").toLowerCase();
  switch (cat) {
    case "image":
      return m.startsWith("image/");
    case "pdf":
      return m === "application/pdf" || ext === "pdf";
    case "video":
      return m.startsWith("video/");
    case "doc":
      return (
        m.startsWith("text/") ||
        m.includes("word") ||
        ["doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)
      );
    default:
      return true;
  }
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const PAGE_SIZE = 100;

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const authed = useAuthed();

  const [view, setView] = useState<DriveView>("drive");
  const [layout, setLayout] = useState<"list" | "grid">("list");
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
  const [typeFilter, setTypeFilter] = useState<Category>("all");

  const [nfOpen, setNfOpen] = useState(false);
  const [nfName, setNfName] = useState("");
  const [aliasRefresh, setAliasRefresh] = useState(0);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [aliasFor, setAliasFor] = useState<FileItem | null>(null);
  const [versionsFor, setVersionsFor] = useState<FileItem | null>(null);
  const [shareFor, setShareFor] = useState<FileItem | null>(null);
  const [shareRefresh, setShareRefresh] = useState(0);
  const [tagsFor, setTagsFor] = useState<FileItem | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<FileItem[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const searchActive = search.trim().length > 0;

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Fetch one page of files for the active view (starred / tag / folder).
  const fetchPage = useCallback(
    (offset: number) => {
      if (view === "starred") return authed((t) => api.listFavorites(t, { limit: PAGE_SIZE, offset }));
      if (tagFilter) return authed((t) => api.listByTag(t, tagFilter, { limit: PAGE_SIZE, offset }));
      return authed((t) => api.listFiles(t, folderId, { limit: PAGE_SIZE, offset }));
    },
    [authed, view, tagFilter, folderId],
  );

  const load = useCallback(async () => {
    // These views render their own panels — no file listing needed.
    if (["links", "insights", "developer", "activity"].includes(view)) return;
    setLoading(true);
    setError(null);
    try {
      if (view === "starred" || tagFilter) {
        const fls = await fetchPage(0);
        setFiles(fls);
        setFolders([]);
        setCrumbs([]);
        setHasMore(fls.length === PAGE_SIZE);
      } else {
        const [fld, fls, bc] = await Promise.all([
          authed((t) => api.listFolders(t, folderId)),
          fetchPage(0),
          folderId ? authed((t) => api.folderBreadcrumb(t, folderId)) : Promise.resolve([]),
        ]);
        setFolders(fld);
        setFiles(fls);
        setCrumbs(bc);
        setHasMore(fls.length === PAGE_SIZE);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [authed, folderId, view, tagFilter, fetchPage]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const page = await fetchPage(filesRef.current.length);
      setFiles((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      setHasMore(false); // stop the loop on error; the user can retry via reload
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore && !searchActive) {
          void loadMore();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, searchActive, loadMore]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (!search.trim()) {
        setResults(null);
        return;
      }
      authed((t) => api.nlSearch(t, search.trim()))
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(id);
  }, [search, authed]);

  const run = (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    (async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : "Something went wrong");
      } finally {
        setBusy(false);
      }
    })();
  };

  const upload = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    run(async () => {
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
    run(async () => {
      await authed((t) => api.createFolder(t, name, folderId));
      setNfName("");
      setNfOpen(false);
      await load();
    });
  };

  const download = (file: FileItem) =>
    run(async () => {
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

  const removeFile = (file: FileItem) => {
    // Optimistic: drop it from the view immediately (delete is idempotent, so a
    // failed request just leaves the server unchanged and the next load resyncs).
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
    setResults((r) => (r ? r.filter((f) => f.id !== file.id) : r));
    run(async () => {
      await authed((t) => api.deleteFile(t, file.id));
    });
  };

  const removeFolder = (folder: FolderItem) =>
    run(async () => {
      await authed((t) => api.deleteFolder(t, folder.id));
      await load();
    });

  const toggleFavorite = (file: FileItem) =>
    run(async () => {
      const updated = await authed((t) => api.setFavorite(t, file.id, !file.is_favorite));
      const patch = (arr: FileItem[]) =>
        arr
          .map((f) => (f.id === file.id ? updated : f))
          .filter((f) => view !== "starred" || f.is_favorite);
      if (searchActive) setResults((r) => (r ? patch(r) : r));
      else setFiles(patch);
    });

  const openTag = (tag: string) => {
    setView("drive");
    setSearch("");
    setTagFilter(tag);
  };

  if (authLoading || !user) {
    return <div className="p-8 text-sm text-zinc-500">Loading…</div>;
  }

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const initials = (user.display_name?.trim()?.[0] ?? "U").toUpperCase();
  const typeLabel = CATEGORIES.find((c) => c.key === typeFilter)?.label ?? "All types";

  const plainDrive = view === "drive" && !tagFilter && !searchActive;
  const rawFiles = searchActive ? (results ?? []) : files;
  const shownFiles = typeFilter === "folder" ? [] : rawFiles.filter((f) => matchesType(f, typeFilter));
  const shownFolders =
    plainDrive && (typeFilter === "all" || typeFilter === "folder") ? folders : [];

  const fileMenu = (file: FileItem) => (
    <Menu
      trigger={() => (
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
          ⋮
        </span>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon="👁" label="Preview" onClick={() => { close(); setPreview(file); }} />
          <MenuItem icon="⬇️" label="Download" onClick={() => { close(); download(file); }} />
          <MenuItem icon="🔗" label="Get link" onClick={() => { close(); setAliasFor(file); }} />
          <MenuItem icon="🌐" label="Share" onClick={() => { close(); setShareFor(file); }} />
          <MenuItem icon="🕘" label="Versions" onClick={() => { close(); setVersionsFor(file); }} />
          <MenuItem icon="🏷" label="Tags" onClick={() => { close(); setTagsFor(file); }} />
          <MenuItem icon="🗑" label="Delete" danger onClick={() => { close(); removeFile(file); }} />
        </>
      )}
    </Menu>
  );

  const folderMenu = (folder: FolderItem) => (
    <Menu
      trigger={() => (
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
          ⋮
        </span>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon="📂" label="Open" onClick={() => { close(); setFolderId(folder.id); }} />
          <MenuItem icon="🗑" label="Delete" danger onClick={() => { close(); removeFolder(folder); }} />
        </>
      )}
    </Menu>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 py-24 text-center">
      <p className="text-base font-medium text-zinc-900">
        {searchActive ? "No matching files" : "This folder is empty"}
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        {searchActive ? "Try a different search." : "Drop files here or use New to upload."}
      </p>
    </div>
  );

  const listView = (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="grid grid-cols-[1fr_140px_100px_44px] items-center gap-4 border-b border-zinc-100 px-4 py-2.5 text-xs font-medium text-zinc-500">
        <span>Name</span>
        <span>Modified</span>
        <span>Size</span>
        <span />
      </div>
      {shownFolders.map((folder) => (
        <div
          key={folder.id}
          className="grid grid-cols-[1fr_140px_100px_44px] items-center gap-4 border-b border-zinc-50 px-4 py-2.5 hover:bg-zinc-50"
        >
          <button
            onClick={() => setFolderId(folder.id)}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <span aria-hidden>📁</span>
            <span className="truncate text-sm font-medium text-zinc-900">{folder.name}</span>
          </button>
          <span className="text-sm text-zinc-500">{shortDate(folder.created_at)}</span>
          <span className="text-sm text-zinc-400">—</span>
          {folderMenu(folder)}
        </div>
      ))}
      {shownFiles.map((file) => (
        <div
          key={file.id}
          className="grid grid-cols-[1fr_140px_100px_44px] items-center gap-4 border-b border-zinc-50 px-4 py-2.5 hover:bg-zinc-50"
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => toggleFavorite(file)}
              className={file.is_favorite ? "text-amber-400" : "text-zinc-300 hover:text-amber-400"}
              aria-label="Star"
            >
              {file.is_favorite ? "★" : "☆"}
            </button>
            <button
              onClick={() => setPreview(file)}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <span aria-hidden>{fileIcon(file.mime, file.ext)}</span>
              <span className="truncate text-sm font-medium text-zinc-900">{file.name}</span>
            </button>
            {file.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                onClick={() => openTag(tag)}
                className="hidden rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 sm:inline"
              >
                {tag}
              </button>
            ))}
          </div>
          <span className="text-sm text-zinc-500">{shortDate(file.modified_at)}</span>
          <span className="text-sm text-zinc-500">{humanSize(file.size)}</span>
          {fileMenu(file)}
        </div>
      ))}
    </div>
  );

  const gridView = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {shownFolders.map((folder) => (
        <div
          key={folder.id}
          className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
        >
          <button
            onClick={() => setFolderId(folder.id)}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <span className="text-2xl" aria-hidden>📁</span>
            <span className="truncate text-sm font-medium text-zinc-900">{folder.name}</span>
          </button>
          {folderMenu(folder)}
        </div>
      ))}
      {shownFiles.map((file) => (
        <div
          key={file.id}
          className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between">
            <button onClick={() => setPreview(file)} className="text-3xl" aria-hidden>
              {fileIcon(file.mime, file.ext)}
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleFavorite(file)}
                className={file.is_favorite ? "text-amber-400" : "text-zinc-300 hover:text-amber-400"}
                aria-label="Star"
              >
                {file.is_favorite ? "★" : "☆"}
              </button>
              {fileMenu(file)}
            </div>
          </div>
          <p className="mt-2 truncate text-sm font-medium text-zinc-900">{file.name}</p>
          <p className="text-xs text-zinc-500">{humanSize(file.size)}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-screen bg-zinc-50">
      <Sidebar
        view={view}
        onView={setView}
        onNewFolder={() => {
          setView("drive");
          setTagFilter(null);
          setNfOpen(true);
        }}
        onUpload={() => {
          setView("drive");
          setTagFilter(null);
          inputRef.current?.click();
        }}
      />
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center gap-4 px-6 py-3">
          <div className="flex-1">
            <div className="flex max-w-2xl items-center gap-2 rounded-full bg-zinc-100 px-4 py-2.5">
              <span className="text-zinc-400" aria-hidden>
                🔍
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder='Search — try "pdfs from last week"'
                className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
              />
            </div>
          </div>
          <Menu
            trigger={() => (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-medium text-white">
                {initials}
              </span>
            )}
          >
            {(close) => (
              <>
                <div className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
                  {user.display_name ?? "Signed in"}
                </div>
                <MenuItem label="Log out" onClick={() => { close(); void onLogout(); }} />
              </>
            )}
          </Menu>
        </header>

        <main
          className="flex-1 overflow-auto px-6 pb-8"
          onDragOver={(e) => {
            if (plainDrive) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (plainDrive) {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }
          }}
        >
          {view === "insights" ? (
            <InsightsPanel />
          ) : view === "developer" ? (
            <DeveloperPanel />
          ) : view === "activity" ? (
            <ActivityPanel />
          ) : view === "links" ? (
            <div className="pt-2">
              <h1 className="mb-4 text-2xl font-normal text-zinc-800">Links</h1>
              <AliasesPanel refreshKey={aliasRefresh} />
              <SharesPanel refreshKey={shareRefresh} />
            </div>
          ) : (
            <div className={dragging ? "rounded-2xl ring-2 ring-indigo-400 ring-offset-4" : ""}>
              {/* Title + view toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                {searchActive ? (
                  <h1 className="text-2xl font-normal text-zinc-800">Results for “{search.trim()}”</h1>
                ) : view === "starred" ? (
                  <h1 className="text-2xl font-normal text-zinc-800">Starred</h1>
                ) : tagFilter ? (
                  <h1 className="flex items-center gap-2 text-2xl font-normal text-zinc-800">
                    Tag: {tagFilter}
                    <button
                      onClick={() => setTagFilter(null)}
                      className="text-sm text-indigo-600 hover:underline"
                    >
                      clear
                    </button>
                  </h1>
                ) : (
                  <nav className="flex flex-wrap items-center gap-2 text-2xl font-normal text-zinc-800">
                    <button
                      onClick={() => setFolderId(undefined)}
                      className={folderId ? "text-zinc-500 hover:text-zinc-800" : ""}
                    >
                      My Drive
                    </button>
                    {crumbs.map((c) => (
                      <span key={c.id} className="flex items-center gap-2">
                        <span className="text-zinc-300">›</span>
                        <button
                          onClick={() => setFolderId(c.id)}
                          className={c.id === folderId ? "" : "text-zinc-500 hover:text-zinc-800"}
                        >
                          {c.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                )}
                <div className="flex items-center rounded-full border border-zinc-200 bg-white p-0.5">
                  <button
                    onClick={() => setLayout("list")}
                    className={`rounded-full px-3 py-1 text-sm ${layout === "list" ? "bg-indigo-100 text-indigo-800" : "text-zinc-500"}`}
                  >
                    ☰ List
                  </button>
                  <button
                    onClick={() => setLayout("grid")}
                    className={`rounded-full px-3 py-1 text-sm ${layout === "grid" ? "bg-indigo-100 text-indigo-800" : "text-zinc-500"}`}
                  >
                    ▦ Grid
                  </button>
                </div>
              </div>

              {/* Filter chips */}
              <div className="flex flex-wrap items-center gap-2 pb-4">
                <Menu
                  align="left"
                  trigger={() => (
                    <span className="flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                      {typeLabel} ▾
                    </span>
                  )}
                >
                  {(close) =>
                    CATEGORIES.map((c) => (
                      <MenuItem
                        key={c.key}
                        label={c.label}
                        onClick={() => {
                          close();
                          setTypeFilter(c.key);
                        }}
                      />
                    ))
                  }
                </Menu>
                {nfOpen ? (
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={nfName}
                      onChange={(e) => setNfName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createFolder()}
                      placeholder="Folder name"
                      className="h-9 w-44"
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
                ) : null}
              </div>

              {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

              {loading && !searchActive ? (
                <p className="text-sm text-zinc-500">Loading…</p>
              ) : shownFolders.length === 0 && shownFiles.length === 0 ? (
                emptyState
              ) : layout === "list" ? (
                listView
              ) : (
                gridView
              )}

              {!searchActive && !loading ? (
                <div ref={sentinelRef} className="py-4 text-center text-sm text-zinc-400">
                  {loadingMore ? "Loading more…" : null}
                </div>
              ) : null}
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
      {versionsFor ? (
        <VersionsModal
          file={versionsFor}
          onClose={() => setVersionsFor(null)}
          onChanged={() => load()}
        />
      ) : null}
      {shareFor ? (
        <ShareModal
          file={shareFor}
          onClose={() => setShareFor(null)}
          onCreated={() => setShareRefresh((v) => v + 1)}
        />
      ) : null}
      {tagsFor ? (
        <TagsModal file={tagsFor} onClose={() => setTagsFor(null)} onChanged={() => load()} />
      ) : null}
    </div>
  );
}
