"use client";

import {
  ApiError,
  type Breadcrumb,
  type FileItem,
  type FolderItem,
} from "@byos/api-client";
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  Download,
  Eye,
  Folder,
  FolderInput,
  FolderOpen,
  History,
  LayoutGrid,
  List,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  Share2,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AliasModal } from "@/components/dashboard/alias-modal";
import { ActivityPanel } from "@/components/dashboard/activity-panel";
import { AliasesPanel } from "@/components/dashboard/aliases-panel";
import { CreateFolderModal } from "@/components/dashboard/create-folder-modal";
import { DeveloperPanel } from "@/components/dashboard/developer-panel";
import { fileIcon } from "@/components/dashboard/file-icon";
import { SearchPalette } from "@/components/dashboard/search-palette";
import { FolderShareModal } from "@/components/dashboard/folder-share-modal";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MoveModal } from "@/components/dashboard/move-modal";
import { RenameModal } from "@/components/dashboard/rename-modal";
import { UsernameSetup } from "@/components/dashboard/username-setup";
import { Menu, MenuItem } from "@/components/dashboard/menu";
import { PreviewModal } from "@/components/dashboard/preview-modal";
import { Sidebar, type DriveView } from "@/components/dashboard/sidebar";
import { TagsModal } from "@/components/dashboard/tags-modal";
import { VersionsModal } from "@/components/dashboard/versions-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { FOLDER_COLORS } from "@/lib/folder-colors";
import { useToast } from "@/lib/toast";

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

type SortField = "name" | "modified" | "size";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { field: SortField; dir: SortDir; label: string }[] = [
  { field: "name", dir: "asc", label: "Name (A–Z)" },
  { field: "name", dir: "desc", label: "Name (Z–A)" },
  { field: "modified", dir: "desc", label: "Newest first" },
  { field: "modified", dir: "asc", label: "Oldest first" },
  { field: "size", dir: "desc", label: "Largest first" },
  { field: "size", dir: "asc", label: "Smallest first" },
];

function sortItems<T extends { name: string; size?: number; created_at: string; modified_at?: string }>(
  items: T[],
  field: SortField,
  dir: SortDir,
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    let r = 0;
    if (field === "name") r = a.name.localeCompare(b.name);
    else if (field === "size") r = (a.size ?? 0) - (b.size ?? 0);
    else r = new Date(a.modified_at ?? a.created_at).getTime() - new Date(b.modified_at ?? b.created_at).getTime();
    return r * factor;
  });
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
const FILE_DRAG_TYPE = "application/byos-file-id";
const FOLDER_DRAG_TYPE = "application/byos-folder-id";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const authed = useAuthed();
  const toast = useToast();

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
  const [folderResults, setFolderResults] = useState<FolderItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<Category>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [nfOpen, setNfOpen] = useState(false);
  const [aliasRefresh, setAliasRefresh] = useState(0);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aliasFor, setAliasFor] = useState<FileItem | null>(null);
  const [sharingFolder, setSharingFolder] = useState<FolderItem | null>(null);
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FolderItem | null>(null);
  const [versionsFor, setVersionsFor] = useState<FileItem | null>(null);
  const [tagsFor, setTagsFor] = useState<FileItem | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [movingFile, setMovingFile] = useState<FileItem | null>(null);
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [uploads, setUploads] = useState<
    { id: number; name: string; status: "uploading" | "done" | "error"; progress: number }[]
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<FileItem[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const uploadIdRef = useRef(0);

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

  // ⌘K / Ctrl+K opens the search palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      const q = search.trim();
      if (!q) {
        setResults(null);
        setFolderResults([]);
        return;
      }
      authed((t) => Promise.all([api.nlSearch(t, q), api.searchFolders(t, q)]))
        .then(([files, folders]) => {
          setResults(files);
          setFolderResults(folders);
        })
        .catch(() => {
          setResults([]);
          setFolderResults([]);
        });
    }, 300);
    return () => clearTimeout(id);
  }, [search, authed]);

  const run = (fn: () => Promise<void>, successMsg?: string) => {
    setError(null);
    setBusy(true);
    (async () => {
      try {
        await fn();
        if (successMsg) toast(successMsg);
      } catch (err) {
        const msg = err instanceof ApiError ? err.detail : "Something went wrong";
        setError(msg);
        toast(msg, "error");
      } finally {
        setBusy(false);
      }
    })();
  };

  const upload = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const jobs = Array.from(fileList).map((file) => ({
      id: (uploadIdRef.current += 1),
      name: file.name,
      file,
    }));
    setUploads((prev) => [
      ...prev,
      ...jobs.map((j) => ({ id: j.id, name: j.name, status: "uploading" as const, progress: 0 })),
    ]);
    (async () => {
      for (const job of jobs) {
        try {
          await authed((t) =>
            api.uploadFile(t, job.file, folderId, (pct) =>
              setUploads((p) => p.map((u) => (u.id === job.id ? { ...u, progress: pct } : u))),
            ),
          );
          setUploads((p) =>
            p.map((u) => (u.id === job.id ? { ...u, status: "done", progress: 100 } : u)),
          );
          // Refresh as each file lands so it shows up immediately, not only
          // once the whole batch is done.
          await load();
        } catch {
          setUploads((p) => p.map((u) => (u.id === job.id ? { ...u, status: "error" } : u)));
        }
      }
      if (inputRef.current) inputRef.current.value = "";
      // Auto-dismiss the finished panel a few seconds after everything settles.
      setTimeout(() => setUploads((p) => p.filter((u) => u.status === "uploading")), 4000);
    })();
  };

  const createFolder = (name: string, color: string | null) =>
    run(async () => {
      await authed((t) => api.createFolder(t, name, folderId, color));
      await load();
    }, "Folder created");

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
    }, "File deleted");
  };

  const removeFolder = (folder: FolderItem) =>
    run(async () => {
      await authed((t) => api.deleteFolder(t, folder.id));
      await load();
    }, "Folder deleted");

  const toggleFavorite = (file: FileItem) =>
    run(async () => {
      const updated = await authed((t) => api.setFavorite(t, file.id, !file.is_favorite));
      const patch = (arr: FileItem[]) =>
        arr
          .map((f) => (f.id === file.id ? updated : f))
          .filter((f) => view !== "starred" || f.is_favorite);
      if (searchActive) setResults((r) => (r ? patch(r) : r));
      else setFiles(patch);
    }, file.is_favorite ? "Removed from starred" : "Added to starred");

  const openTag = (tag: string) => {
    setView("drive");
    setSearch("");
    setTagFilter(tag);
  };

  // Navigate into a folder, leaving any active search/tag view.
  const openFolder = (id: string) => {
    setSearch("");
    setTagFilter(null);
    setFolderId(id);
  };

  const moveFileToFolder = (fileId: string, folderId: string | null) => {
    setDragFolder(null);
    // Optimistic: it leaves the current folder view; a failed move resyncs on reload.
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setResults((r) => (r ? r.filter((f) => f.id !== fileId) : r));
    run(async () => {
      await authed((t) => api.moveFile(t, fileId, folderId));
    }, "File moved");
  };

  const moveFolderIntoFolder = (folderId: string, targetId: string) => {
    setDragFolder(null);
    if (folderId === targetId) return; // can't drop a folder onto itself
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    run(async () => {
      await authed((t) => api.moveFolder(t, folderId, targetId));
    }, "Folder moved");
  };

  const applyFolderColor = (folder: FolderItem, color: string | null) => {
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, color } : f)));
    run(async () => {
      await authed((t) => api.updateFolder(t, folder.id, { color }));
    }, "Folder color updated");
  };

  const renameFileTo = (file: FileItem, name: string) =>
    run(async () => {
      const updated = await authed((t) => api.renameFile(t, file.id, name));
      const patch = (arr: FileItem[]) => arr.map((f) => (f.id === file.id ? updated : f));
      if (searchActive) setResults((r) => (r ? patch(r) : r));
      else setFiles(patch);
    }, "File renamed");

  const renameFolderTo = (folder: FolderItem, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? { ...f, name } : f)));
    run(async () => {
      await authed((t) => api.renameFolder(t, folder.id, name));
    }, "Folder renamed");
  };

  if (authLoading || !user) {
    return (
      <div className="flex h-screen bg-zinc-50">
        <div className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white p-4 sm:block">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-4 h-12 w-full rounded-2xl" />
          <div className="mt-4 space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-r-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-9 w-64 rounded-full" />
          <Skeleton className="mt-6 h-7 w-40" />
          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-zinc-50 px-4 py-3.5">
                <Skeleton className="h-5 w-5" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="ml-auto h-3 w-14" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user.username) {
    return <UsernameSetup />;
  }

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const initials = (user.display_name?.trim()?.[0] ?? "U").toUpperCase();
  const typeLabel = CATEGORIES.find((c) => c.key === typeFilter)?.label ?? "All types";

  const plainDrive = view === "drive" && !tagFilter && !searchActive;
  const rawFiles = searchActive ? (results ?? []) : files;
  const filteredFiles = typeFilter === "folder" ? [] : rawFiles.filter((f) => matchesType(f, typeFilter));
  const allowFolders = typeFilter === "all" || typeFilter === "folder";
  const rawFolders = searchActive
    ? allowFolders
      ? folderResults
      : []
    : plainDrive && allowFolders
      ? folders
      : [];
  const shownFiles = sortItems(filteredFiles, sortField, sortDir);
  const shownFolders = sortItems(rawFolders, sortField, sortDir);
  const sortLabel =
    SORT_OPTIONS.find((o) => o.field === sortField && o.dir === sortDir)?.label ?? "Sort";

  const menuTrigger = (
    <span className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
      <MoreVertical className="h-4 w-4" />
    </span>
  );

  const fileMenu = (file: FileItem) => (
    <Menu trigger={() => menuTrigger}>
      {(close) => (
        <>
          <MenuItem icon={<Eye className="h-4 w-4" />} label="Preview" onClick={() => { close(); setPreview(file); }} />
          <MenuItem icon={<Download className="h-4 w-4" />} label="Download" onClick={() => { close(); download(file); }} />
          <MenuItem icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => { close(); setAliasFor(file); }} />
          <MenuItem icon={<Pencil className="h-4 w-4" />} label="Rename" onClick={() => { close(); setRenamingFile(file); }} />
          <MenuItem icon={<History className="h-4 w-4" />} label="Versions" onClick={() => { close(); setVersionsFor(file); }} />
          <MenuItem icon={<Tag className="h-4 w-4" />} label="Tags" onClick={() => { close(); setTagsFor(file); }} />
          <MenuItem icon={<FolderInput className="h-4 w-4" />} label="Move to…" onClick={() => { close(); setMovingFile(file); }} />
          <MenuItem icon={<Trash2 className="h-4 w-4" />} label="Delete" danger onClick={() => { close(); removeFile(file); }} />
        </>
      )}
    </Menu>
  );

  const folderMenu = (folder: FolderItem) => (
    <Menu trigger={() => menuTrigger}>
      {(close) => (
        <>
          <MenuItem icon={<FolderOpen className="h-4 w-4" />} label="Open" onClick={() => { close(); openFolder(folder.id); }} />
          <MenuItem icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => { close(); setSharingFolder(folder); }} />
          <MenuItem icon={<Pencil className="h-4 w-4" />} label="Rename" onClick={() => { close(); setRenamingFolder(folder); }} />
          <div
            className="flex items-center gap-1.5 px-4 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); applyFolderColor(folder, null); }}
              aria-label="Default color"
              className="h-4 w-4 rounded-full border border-zinc-300 bg-white"
            />
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                onClick={(e) => { e.stopPropagation(); applyFolderColor(folder, c); }}
                aria-label={`Color ${c}`}
                style={{ backgroundColor: c }}
                className={`h-4 w-4 rounded-full ${folder.color === c ? "ring-2 ring-offset-1 ring-zinc-400" : ""}`}
              />
            ))}
          </div>
          <MenuItem icon={<Trash2 className="h-4 w-4" />} label="Delete" danger onClick={() => { close(); removeFolder(folder); }} />
        </>
      )}
    </Menu>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 py-24 text-center">
      <p className="text-base font-medium text-zinc-900">
        {searchActive ? "No matching files or folders" : "This folder is empty"}
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        {searchActive ? "Try a different search." : "Drop files here or use New to upload."}
      </p>
    </div>
  );

  const listSkeleton = (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-zinc-50 px-4 py-3.5">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-4 w-[45%]" />
          <Skeleton className="ml-auto h-3 w-14" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );

  const gridSkeleton = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4">
          <Skeleton className="h-7 w-7" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      ))}
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
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            const t = e.dataTransfer.types;
            if (t.includes(FILE_DRAG_TYPE) || t.includes(FOLDER_DRAG_TYPE)) {
              e.preventDefault();
              setDragFolder(folder.id);
            }
          }}
          onDragLeave={() => setDragFolder((d) => (d === folder.id ? null : d))}
          onDrop={(e) => {
            const fileId = e.dataTransfer.getData(FILE_DRAG_TYPE);
            const folderId = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
            if (fileId) {
              e.preventDefault();
              e.stopPropagation();
              moveFileToFolder(fileId, folder.id);
            } else if (folderId) {
              e.preventDefault();
              e.stopPropagation();
              moveFolderIntoFolder(folderId, folder.id);
            }
          }}
          onClick={() => openFolder(folder.id)}
          className={`grid cursor-pointer grid-cols-[1fr_140px_100px_44px] items-center gap-4 border-b border-zinc-50 px-4 py-2.5 ${
            dragFolder === folder.id ? "bg-indigo-50 ring-2 ring-inset ring-indigo-400" : "hover:bg-zinc-50"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Folder
              className="h-5 w-5 shrink-0 text-indigo-500"
              fill={folder.color ?? "none"}
              style={folder.color ? { color: folder.color } : undefined}
            />
            <span className="truncate text-sm font-medium text-zinc-900">{folder.name}</span>
          </div>
          <span className="text-sm text-zinc-500">{shortDate(folder.created_at)}</span>
          <span className="text-sm text-zinc-500">{folder.size ? humanSize(folder.size) : "—"}</span>
          {folderMenu(folder)}
        </div>
      ))}
      {shownFiles.map((file) => (
        <div
          key={file.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(FILE_DRAG_TYPE, file.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => setPreview(file)}
          className="grid cursor-pointer grid-cols-[1fr_140px_100px_44px] items-center gap-4 border-b border-zinc-50 px-4 py-2.5 hover:bg-zinc-50"
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(file); }}
              aria-label="Star"
              className="shrink-0"
            >
              <Star
                className={`h-4 w-4 ${file.is_favorite ? "fill-amber-400 text-amber-400" : "text-zinc-300 hover:text-amber-400"}`}
              />
            </button>
            <span aria-hidden>{fileIcon(file.mime, file.ext)}</span>
            <span className="truncate text-sm font-medium text-zinc-900">{file.name}</span>
            {file.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                onClick={(e) => { e.stopPropagation(); openTag(tag); }}
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
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            const t = e.dataTransfer.types;
            if (t.includes(FILE_DRAG_TYPE) || t.includes(FOLDER_DRAG_TYPE)) {
              e.preventDefault();
              setDragFolder(folder.id);
            }
          }}
          onDragLeave={() => setDragFolder((d) => (d === folder.id ? null : d))}
          onDrop={(e) => {
            const fileId = e.dataTransfer.getData(FILE_DRAG_TYPE);
            const folderId = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
            if (fileId) {
              e.preventDefault();
              e.stopPropagation();
              moveFileToFolder(fileId, folder.id);
            } else if (folderId) {
              e.preventDefault();
              e.stopPropagation();
              moveFolderIntoFolder(folderId, folder.id);
            }
          }}
          onClick={() => openFolder(folder.id)}
          className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border bg-white p-4 ${
            dragFolder === folder.id
              ? "border-indigo-400 ring-2 ring-indigo-400"
              : "border-zinc-200 hover:border-indigo-300 hover:shadow-sm"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Folder
              className="h-6 w-6 shrink-0 text-indigo-500"
              fill={folder.color ?? "none"}
              style={folder.color ? { color: folder.color } : undefined}
            />
            <div className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-900">
                {folder.name}
              </span>
              {folder.size ? (
                <span className="text-xs text-zinc-400">{humanSize(folder.size)}</span>
              ) : null}
            </div>
          </div>
          {folderMenu(folder)}
        </div>
      ))}
      {shownFiles.map((file) => (
        <div
          key={file.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(FILE_DRAG_TYPE, file.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => setPreview(file)}
          className="cursor-pointer rounded-xl border border-zinc-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
        >
          <div className="flex items-start justify-between">
            <span aria-hidden>{fileIcon(file.mime, file.ext, "h-7 w-7 text-zinc-500")}</span>
            <div className="flex items-center gap-1">
              <button onClick={(e) => { e.stopPropagation(); toggleFavorite(file); }} aria-label="Star">
                <Star
                  className={`h-4 w-4 ${file.is_favorite ? "fill-amber-400 text-amber-400" : "text-zinc-300 hover:text-amber-400"}`}
                />
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
          <div className="flex flex-1 justify-center">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full max-w-md items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-left transition hover:bg-zinc-200/70"
            >
              <Search className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="flex-1 text-sm text-zinc-400">Search files &amp; folders…</span>
              <kbd className="hidden shrink-0 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 sm:inline">
                ⌘K
              </kbd>
            </button>
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
            // Only highlight for external file uploads, not internal move-drags.
            if (plainDrive && e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (plainDrive && e.dataTransfer.types.includes("Files")) {
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
              <AliasesPanel
                refreshKey={aliasRefresh}
                onOpenLocation={(fid) => {
                  setView("drive");
                  setTagFilter(null);
                  setSearch("");
                  setFolderId(fid ?? undefined);
                }}
              />
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
                    aria-label="List view"
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${layout === "list" ? "bg-indigo-100 text-indigo-800" : "text-zinc-500"}`}
                  >
                    <List className="h-4 w-4" /> List
                  </button>
                  <button
                    onClick={() => setLayout("grid")}
                    aria-label="Grid view"
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${layout === "grid" ? "bg-indigo-100 text-indigo-800" : "text-zinc-500"}`}
                  >
                    <LayoutGrid className="h-4 w-4" /> Grid
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
                <Menu
                  align="left"
                  trigger={() => (
                    <span className="flex items-center gap-1.5 rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                      <ArrowUpDown className="h-3.5 w-3.5" /> {sortLabel} ▾
                    </span>
                  )}
                >
                  {(close) =>
                    SORT_OPTIONS.map((o) => (
                      <MenuItem
                        key={o.label}
                        label={o.label}
                        onClick={() => {
                          close();
                          setSortField(o.field);
                          setSortDir(o.dir);
                        }}
                      />
                    ))
                  }
                </Menu>
              </div>

              {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

              {loading && !searchActive ? (
                layout === "list" ? (
                  listSkeleton
                ) : (
                  gridSkeleton
                )
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

      <SearchPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenFile={(f) => setPreview(f)}
        onOpenFolder={(fid) => {
          setView("drive");
          openFolder(fid);
        }}
        onSearchAll={(q) => {
          setView("drive");
          setTagFilter(null);
          setSearch(q);
        }}
      />
      {preview ? <PreviewModal file={preview} onClose={() => setPreview(null)} /> : null}
      {aliasFor ? (
        <AliasModal
          file={aliasFor}
          onClose={() => setAliasFor(null)}
          onCreated={() => setAliasRefresh((v) => v + 1)}
        />
      ) : null}
      {sharingFolder ? (
        <FolderShareModal
          folder={sharingFolder}
          onClose={() => setSharingFolder(null)}
          onCreated={() => setAliasRefresh((v) => v + 1)}
        />
      ) : null}
      {nfOpen ? (
        <CreateFolderModal onClose={() => setNfOpen(false)} onCreate={createFolder} />
      ) : null}
      {renamingFile ? (
        <RenameModal
          title="Rename file"
          initial={renamingFile.name}
          onClose={() => setRenamingFile(null)}
          onSubmit={(name) => renameFileTo(renamingFile, name)}
        />
      ) : null}
      {renamingFolder ? (
        <RenameModal
          title="Rename folder"
          initial={renamingFolder.name}
          onClose={() => setRenamingFolder(null)}
          onSubmit={(name) => renameFolderTo(renamingFolder, name)}
        />
      ) : null}
      {versionsFor ? (
        <VersionsModal
          file={versionsFor}
          onClose={() => setVersionsFor(null)}
          onChanged={() => load()}
        />
      ) : null}
      {tagsFor ? (
        <TagsModal file={tagsFor} onClose={() => setTagsFor(null)} onChanged={() => load()} />
      ) : null}
      {movingFile ? (
        <MoveModal file={movingFile} onClose={() => setMovingFile(null)} onMoved={() => load()} />
      ) : null}

      {uploads.length > 0 ? (
        <div className="fixed bottom-4 right-4 z-40 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
            <span>
              {uploads.some((u) => u.status === "uploading")
                ? `Uploading ${uploads.filter((u) => u.status === "uploading").length} file(s)…`
                : "Uploads"}
            </span>
            <button
              onClick={() => setUploads([])}
              className="text-zinc-400 hover:text-zinc-700"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="max-h-56 divide-y divide-zinc-50 overflow-auto">
            {uploads.map((u) => (
              <li key={u.id} className="px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  {u.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
                  ) : u.status === "done" ? (
                    <Check className="h-4 w-4 shrink-0 text-indigo-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-zinc-700">{u.name}</span>
                  {u.status === "uploading" ? (
                    <span className="shrink-0 text-xs tabular-nums text-zinc-500">{u.progress}%</span>
                  ) : null}
                </div>
                {u.status === "uploading" ? (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-indigo-600 transition-all duration-200"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
