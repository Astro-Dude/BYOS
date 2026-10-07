"use client";

import {
  ApiError,
  type Breadcrumb,
  type FileItem,
  type FolderItem,
  type StorageAccount,
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
  UploadCloud,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AliasModal } from "@/components/dashboard/alias-modal";
import { AliasesPanel } from "@/components/dashboard/aliases-panel";
import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { CreateFolderModal } from "@/components/dashboard/create-folder-modal";
import { DeveloperPanel } from "@/components/dashboard/developer-panel";
import { fileIcon } from "@/components/dashboard/file-icon";
import { SearchPalette } from "@/components/dashboard/search-palette";
import { FolderShareModal } from "@/components/dashboard/folder-share-modal";
import { DuplicatesPanel } from "@/components/dashboard/duplicates-panel";
import { MissingPanel } from "@/components/dashboard/missing-panel";
import { MoveModal } from "@/components/dashboard/move-modal";
import { RenameModal } from "@/components/dashboard/rename-modal";
import { UsernameSetup } from "@/components/dashboard/username-setup";
import { Menu, MenuItem } from "@/components/dashboard/menu";
import { PreviewModal } from "@/components/dashboard/preview-modal";
import { StorageAlerts } from "@/components/dashboard/storage-alert";
import { MobileNewMenu, MobileTabs } from "@/components/dashboard/mobile-tabs";
import { LogoMark } from "@/components/logo";
import { openSupport } from "@/components/support-fab";
import { supportEnabled } from "@/components/support-modal";
import { Sidebar, type DriveView } from "@/components/dashboard/sidebar";
import { IntroSplash, useIntroOnce } from "@/components/intro-splash";
import { StoragePicker } from "@/components/dashboard/storage-picker";
import { StorageIcon, providerName, storageTitle } from "@/components/storage-icon";
import { TagsModal } from "@/components/dashboard/tags-modal";
import {
  type ConflictResolution,
  UploadConflictModal,
} from "@/components/dashboard/upload-conflict-modal";
import { VersionsModal } from "@/components/dashboard/versions-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { STORAGE_REJECTED_EVENT, useAuth, useAuthed } from "@/lib/auth-context";
import { FOLDER_COLORS } from "@/lib/folder-colors";
import {
  addRecentFile,
  addRecentFolder,
  removeRecentFile,
  removeRecentFolder,
} from "@/lib/recents";
import { type DriveSort, usePreferences } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { truncateMiddle } from "@/lib/utils";

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
  field: SortField | null,
  dir: SortDir,
): T[] {
  if (!field) return items; // default: natural order (as returned by the API)
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

/** What a file is, in a word, for the Kind column. */
function kindOf(file: FileItem): string {
  const m = (file.mime ?? "").toLowerCase();
  const ext = (file.ext ?? "").toLowerCase();
  if (m === "application/pdf" || ext === "pdf") return "PDF";
  if (m.startsWith("image/")) return "Image";
  if (m.startsWith("video/")) return "Video";
  if (m.startsWith("audio/")) return "Audio";
  if (m.includes("sheet") || m.includes("excel") || ["xls", "xlsx", "csv", "ods"].includes(ext)) return "Spreadsheet";
  if (m.includes("presentation") || ["ppt", "pptx", "key", "odp"].includes(ext)) return "Slides";
  if (m.includes("zip") || m.includes("compressed") || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "Archive";
  if (m.includes("word") || ["doc", "docx", "rtf", "odt"].includes(ext)) return "Document";
  if (["md", "txt"].includes(ext) || m.startsWith("text/plain") || m === "text/markdown") return "Text";
  if (["js", "ts", "tsx", "py", "go", "rs", "java", "json", "html", "css", "sh"].includes(ext)) return "Code";
  return ext ? ext.toUpperCase() : "File";
}

// The list's columns. Name takes the most room but the rest share the width
// too, so on a wide screen the details sit across the row instead of bunching
// at the right edge; Kind joins from lg. Folders, files and the heading share it.
// Phones: name (with its details underneath) and the menu. Tablets add Modified
// and Size; from lg every column, Kind and Stored on included.
const LIST_COLS =
  "grid-cols-[minmax(0,1fr)_2.75rem] sm:grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_2.75rem] lg:grid-cols-[minmax(0,2.6fr)_minmax(6rem,0.8fr)_minmax(8rem,1.3fr)_minmax(7rem,0.9fr)_minmax(5.5rem,0.7fr)_2.75rem]";

// Cards: as many columns as fit (two on a phone), so a wide screen gets more
// of them rather than wider ones.
const GRID_COLS = "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// One screenful. The rest streams in as the sentinel scrolls into view, so a
// drive with thousands of files renders 20 rows rather than all of them.
const PAGE_SIZE = 20;
// The largest file every storage takes (Telegram and GitHub stop at 2 GB). Keep
// in sync with the API's max_upload_bytes so oversized files are caught before
// uploading.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
// Upload several files at once, but capped — unbounded parallelism risks
// provider rate limits (Telegram's flood waits, GitHub's secondary limits) and
// exhausts the browser's per-host connection pool.
const UPLOAD_CONCURRENCY = 3;
const FILE_DRAG_TYPE = "application/byos-file-id";
const FOLDER_DRAG_TYPE = "application/byos-folder-id";

// "name.ext" → "name (1).ext", bumping until it doesn't collide with `used`.
function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 1;
  let candidate = `${base} (${n})${ext}`;
  while (used.has(candidate)) candidate = `${base} (${++n})${ext}`;
  return candidate;
}

// Replace the default single-row drag ghost with an on-brand "stack of cards"
// badge that makes the count obvious when several items are dragged at once.
function setMultiDragImage(dt: DataTransfer, count: number): void {
  const style = (el: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(el.style, s);

  const chip = document.createElement("div");
  style(chip, {
    position: "absolute",
    top: "-1000px",
    left: "-1000px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "11px 16px 11px 12px",
    borderRadius: "16px",
    background: "#17191c", // ink — the system's only filled surface
    color: "#fff",
    font: "500 14px ui-sans-serif, system-ui, sans-serif",
    boxShadow: "0 8px 40px rgba(0,0,0,.18)",
    whiteSpace: "nowrap",
  });

  // Stacked squares → reads as "multiple items".
  const stack = document.createElement("div");
  style(stack, { position: "relative", width: "30px", height: "30px", flex: "0 0 auto" });
  const back = document.createElement("div");
  style(back, {
    position: "absolute",
    inset: "0",
    transform: "translate(4px,4px)",
    borderRadius: "8px",
    background: "rgba(255,255,255,.35)",
  });
  const front = document.createElement("div");
  front.textContent = String(count);
  style(front, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "8px",
    background: "#fff",
    color: "#17191c",
    fontSize: "14px",
    fontWeight: "700",
  });
  stack.append(back, front);

  const label = document.createElement("span");
  label.textContent = "items";

  chip.append(stack, label);
  document.body.appendChild(chip);
  dt.setDragImage(chip, 22, 20);
  // Remove after the browser has snapshotted it for the drag cursor.
  setTimeout(() => chip.remove(), 0);
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const authed = useAuthed();
  const toast = useToast();

  const [view, setView] = useState<DriveView>("drive");
  const [showBoot, finishBoot] = useIntroOnce("drive");
  // Layout and sort are preferences: changing them here is remembered, and
  // Settings sets where they start.
  const { prefs, setPrefs } = usePreferences();
  const layout = prefs.driveLayout;
  const setLayout = (next: "list" | "grid") => setPrefs({ driveLayout: next });
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
  // "all", or the id of the storage whose files to show.
  const [storageFilter, setStorageFilter] = useState("all");
  // Set by "Upload to…" so the next picked files ask where to go.
  const askStorageNext = useRef(false);
  const [sortField, sortDir]: [SortField | null, SortDir] =
    prefs.driveSort === "none"
      ? [null, "asc"]
      : (prefs.driveSort.split(":") as [SortField, SortDir]);
  const setSort = (field: SortField | null, dir: SortDir = "asc") =>
    setPrefs({ driveSort: field ? (`${field}:${dir}` as DriveSort) : "none" });

  const [nfOpen, setNfOpen] = useState(false);
  const [aliasRefresh, setAliasRefresh] = useState(0);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aliasFor, setAliasFor] = useState<FileItem | null>(null);
  const [sharingFolder, setSharingFolder] = useState<FolderItem | null>(null);
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FolderItem | null>(null);
  const [confirming, setConfirming] = useState<
    { kind: "file"; file: FileItem } | { kind: "folder"; folder: FolderItem } | null
  >(null);
  const [versionsFor, setVersionsFor] = useState<FileItem | null>(null);
  const [tagsFor, setTagsFor] = useState<FileItem | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [movingFile, setMovingFile] = useState<FileItem | null>(null);
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [selFiles, setSelFiles] = useState<Set<string>>(new Set());
  const [selFolders, setSelFolders] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [scrolled, setScrolled] = useState(false); // main scrolled → solidify sticky bars
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [uploads, setUploads] = useState<
    {
      id: number;
      name: string;
      status: "uploading" | "done" | "error";
      progress: number;
      note?: string;
    }[]
  >([]);
  const [conflict, setConflict] = useState<{
    items: { file: File; existing: FileItem }[];
    targetFolderId: string | undefined;
    storageId?: string;
    existingNames: Set<string>;
    folderLabel: string;
  } | null>(null);
  // The user's storages, for the upload picker and the per-file storage badge.
  const [storages, setStorages] = useState<StorageAccount[]>([]);
  const [storagesReady, setStoragesReady] = useState(false);
  // Files waiting for the user to say which storage they go to.
  const [pickStorage, setPickStorage] = useState<{
    files: File[];
    targetFolderId: string | undefined;
  } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Background delete progress (optimistic UI removes items immediately; the
  // actual provider deletes run behind this indicator).
  const [delProgress, setDelProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<FileItem[]>([]);
  const folderIdRef = useRef<string | undefined>(undefined);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const listGenRef = useRef(0);
  const uploadIdRef = useRef(0);

  const searchActive = search.trim().length > 0;

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    folderIdRef.current = folderId;
  }, [folderId]);

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
    if (["links", "duplicates", "missing", "developer"].includes(view)) return;
    listGenRef.current += 1;
    loadingMoreRef.current = false;
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
    if (loadingMoreRef.current) return; // observer can fire again mid-flight
    loadingMoreRef.current = true;
    const gen = listGenRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(filesRef.current.length);
      if (listGenRef.current !== gen) return; // navigated away mid-fetch
      setFiles((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      setHasMore(false); // stop the loop on error; the user can retry via reload
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const reloadStorages = useCallback(() => {
    authed((t) => api.listStorage(t))
      .then(setStorages)
      .catch(() => undefined) // keep what's shown; the next refresh retries
      .finally(() => setStoragesReady(true));
  }, [authed]);

  useEffect(() => {
    if (user) reloadStorages();
  }, [user, reloadStorages]);

  // Keep the usage card current: refresh shortly after the files change
  // (uploads, deletes, restores all land here), when the tab comes back into
  // view, and when a storage turns out to need reconnecting.
  useEffect(() => {
    if (!user || !storagesReady) return;
    const timer = setTimeout(reloadStorages, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);
  useEffect(() => {
    if (!user) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") reloadStorages();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(STORAGE_REJECTED_EVENT, reloadStorages);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(STORAGE_REJECTED_EVENT, reloadStorages);
    };
  }, [user, reloadStorages]);

  // Drop any multi-selection when the visible set changes.
  useEffect(() => {
    setSelFiles(new Set());
    setSelFolders(new Set());
  }, [view, folderId, search, tagFilter]);

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

  // Run a batch of deletions in the background (bounded-parallel) behind a
  // progress indicator. The UI has already removed the items optimistically;
  // this just reconciles with the server and resyncs if anything failed.
  const runDeletions = async (tasks: Array<() => Promise<void>>) => {
    const total = tasks.length;
    if (total === 0) return;
    setDelProgress((p) => ({ done: p?.done ?? 0, total: (p?.total ?? 0) + total }));
    const bump = () =>
      setDelProgress((p) => {
        if (!p) return p;
        const done = p.done + 1;
        return done >= p.total ? null : { ...p, done }; // clears when everything settles
      });
    let failed = 0;
    let reason: string | null = null; // the first failure's message, so the toast says why
    let idx = 0;
    const worker = async () => {
      while (idx < total) {
        const task = tasks[idx++];
        if (!task) break;
        try {
          await task();
        } catch (err) {
          failed += 1;
          reason ??= err instanceof ApiError ? err.detail : null;
        }
        bump();
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
    if (failed > 0) {
      const count = `${failed} item${failed === 1 ? "" : "s"} failed to delete`;
      toast(reason ? `${count}. ${reason}` : count, "error");
      await load(); // resync so items that didn't actually delete reappear
    } else {
      toast(total > 1 ? `Deleted ${total} items` : "Deleted");
    }
  };

  // targetFolderId lets a Finder drop land in the folder it was dropped on;
  // defaults to the folder currently being viewed.
  // Run a set of upload jobs (bounded-parallel). A job with `replaceId` adds a
  // new version to that file; otherwise it's a fresh upload into the folder.
  const runJobs = (
    jobs: { id: number; name: string; file: File; replaceId?: string }[],
    targetFolderId: string | undefined,
    storageId?: string,
  ) => {
    if (jobs.length === 0) return;
    setUploads((prev) => [
      ...prev,
      ...jobs.map((j) => ({ id: j.id, name: j.name, status: "uploading" as const, progress: 0 })),
    ]);
    (async () => {
      const uploadOne = async (job: (typeof jobs)[number]) => {
        try {
          const result = await authed((t) =>
            job.replaceId
              ? api.replaceFile(t, job.replaceId, job.file)
              : api.uploadFile(
                  t,
                  job.file,
                  targetFolderId,
                  (pct) => setUploads((p) => p.map((u) => (u.id === job.id ? { ...u, progress: pct } : u))),
                  storageId,
                ),
          );
          setUploads((p) =>
            p.map((u) => (u.id === job.id ? { ...u, status: "done", progress: 100 } : u)),
          );
          // Patch the view in place instead of refetching everything: a replace
          // updates the existing row; a new upload prepends — but only when its
          // destination is the folder currently on screen (and not mid-search).
          if (job.replaceId) {
            setFiles((p) => p.map((f) => (f.id === result.id ? result : f)));
          } else if (targetFolderId === folderIdRef.current && !searchActive) {
            setFiles((p) => (p.some((f) => f.id === result.id) ? p : [result, ...p]));
          }
        } catch (err) {
          const note = err instanceof ApiError ? err.detail : "Upload failed";
          setUploads((p) => p.map((u) => (u.id === job.id ? { ...u, status: "error", note } : u)));
        }
      };
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          if (!job) break;
          await uploadOne(job);
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, jobs.length) }, worker));
      setTimeout(() => setUploads((p) => p.filter((u) => u.status === "uploading")), 4000);
    })();
  };

  const upload = (fileList: FileList | null, targetFolderId: string | undefined = folderId) => {
    const askThisTime = askStorageNext.current;
    askStorageNext.current = false;
    if (!fileList || fileList.length === 0) return;
    const all = Array.from(fileList); // copied: the input is cleared below
    if (inputRef.current) inputRef.current.value = "";
    // "Ask every time" only means something with more than one storage.
    const usable = storages.filter((s) => s.status === "connected");
    if ((askThisTime || prefs.uploadTarget === "ask") && usable.length > 1) {
      setPickStorage({ files: all, targetFolderId });
      return;
    }
    void startUpload(all, targetFolderId);
  };

  const startUpload = async (all: File[], targetFolderId: string | undefined, storageId?: string) => {
    const ok = all.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    const tooBig = all.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      toast(`${tooBig.length} file(s) exceed the 2 GB limit`, "error");
      setUploads((prev) => [
        ...prev,
        ...tooBig.map((f) => ({
          id: (uploadIdRef.current += 1),
          name: f.name,
          status: "error" as const,
          progress: 0,
          note: "Too large (max 2 GB)",
        })),
      ]);
    }
    if (ok.length === 0) return;

    // Detect name collisions in the destination folder before uploading.
    let existing: FileItem[] = [];
    try {
      existing = await authed((t) => api.listFiles(t, targetFolderId, { limit: 500 }));
    } catch {
      /* if we can't check, fall through and upload as new */
    }
    const byName = new Map(existing.map((f) => [f.name, f]));

    const clean: { id: number; name: string; file: File }[] = [];
    const conflicts: { file: File; existing: FileItem }[] = [];
    for (const f of ok) {
      const hit = byName.get(f.name);
      if (hit) conflicts.push({ file: f, existing: hit });
      else clean.push({ id: (uploadIdRef.current += 1), name: f.name, file: f });
    }

    runJobs(clean, targetFolderId, storageId);
    if (conflicts.length && prefs.uploadConflict !== "ask") {
      resolveConflictWith(prefs.uploadConflict, {
        items: conflicts,
        targetFolderId,
        storageId,
        existingNames: new Set(existing.map((e) => e.name)),
      });
    } else if (conflicts.length) {
      const label =
        targetFolderId === folderId
          ? "this folder"
          : (folders.find((fo) => fo.id === targetFolderId)?.name ?? "the folder");
      setConflict({
        items: conflicts,
        targetFolderId,
        storageId,
        existingNames: new Set(existing.map((e) => e.name)),
        folderLabel: label,
      });
    }
  };

  const resolveConflict = (mode: ConflictResolution) => {
    const c = conflict;
    setConflict(null);
    if (c) resolveConflictWith(mode, c);
  };

  function resolveConflictWith(
    mode: ConflictResolution,
    c: {
      items: { file: File; existing: FileItem }[];
      targetFolderId: string | undefined;
      storageId?: string;
      existingNames: Set<string>;
    },
  ) {
    if (mode === "skip") return;
    const used = new Set(c.existingNames);
    const jobs = c.items.map(({ file, existing }) => {
      if (mode === "replace") {
        return { id: (uploadIdRef.current += 1), name: file.name, file, replaceId: existing.id };
      }
      const name = uniqueName(file.name, used); // keep both → rename the new copy
      used.add(name);
      return { id: (uploadIdRef.current += 1), name, file: new File([file], name, { type: file.type }) };
    });
    runJobs(jobs, c.targetFolderId, c.storageId);
  }

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
    removeRecentFile(file.id); // keep the palette's recents in sync
    run(async () => {
      await authed((t) => api.deleteFile(t, file.id));
    }, "File deleted");
  };

  const removeFolder = (folder: FolderItem) => {
    // Optimistic: drop it now (deleting a folder cascades and can be slow), then
    // delete in the background behind the progress indicator.
    removeRecentFolder(folder.id);
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    void runDeletions([
      async () => {
        await authed((t) => api.deleteFolder(t, folder.id));
      },
    ]);
  };

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

  // Where a file lives: its provider's mark and name, with the exact storage
  // (repo, bucket) on hover.
  const homeOf = (file: FileItem) =>
    storages.find((s) => s.id === file.storage_account_id) ??
    storages.find((s) => s.provider === file.provider);
  const storedOn = (file: FileItem) => {
    const home = homeOf(file);
    return home ? storageTitle(home) : providerName(file.provider);
  };
  // The provider, plus which repo or bucket where there's room for it (the
  // list on a wide screen; cards keep it to the hover title).
  const storageSource = (file: FileItem, detail = true) => {
    const label = homeOf(file)?.label;
    return (
      <span
        title={`Stored on ${storedOn(file)}`}
        className="inline-flex min-w-0 items-center gap-1.5 text-zinc-500"
      >
        <StorageIcon provider={file.provider} className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">{providerName(file.provider)}</span>
        {label && detail ? <span className="hidden min-w-0 truncate text-zinc-400 xl:inline">{label}</span> : null}
      </span>
    );
  };

  // Column-header sorting: default → asc → desc → default.
  const cycleSort = (field: SortField) => {
    if (sortField !== field) setSort(field, "asc");
    else if (sortDir === "asc") setSort(field, "desc");
    else setSort(null);
  };
  const sortArrow = (field: SortField) =>
    sortField !== field ? "" : sortDir === "asc" ? " ↑" : " ↓";

  // ── Multi-select ─────────────────────────────────────────────────────────
  const selCount = selFiles.size + selFolders.size;
  const clearSelection = () => {
    setSelFiles(new Set());
    setSelFolders(new Set());
  };
  const toggleSelFile = (id: string) =>
    setSelFiles((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleSelFolder = (id: string) =>
    setSelFolders((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const bulkStar = () =>
    run(async () => {
      const ids = [...selFiles];
      await Promise.all(ids.map((id) => authed((t) => api.setFavorite(t, id, true))));
      clearSelection();
      await load();
    }, "Starred");

  const bulkAddTag = (tag: string) =>
    run(async () => {
      const ids = [...selFiles];
      await Promise.all(ids.map((id) => authed((t) => api.addTag(t, id, tag))));
      clearSelection();
      await load();
    }, "Tagged");

  const bulkDelete = () => {
    const fileIds = [...selFiles];
    const folderIds = [...selFolders];
    // Optimistic: everything disappears at once, then deletes run in the
    // background (parallel) so a big selection never feels frozen.
    const fset = new Set(fileIds);
    const foset = new Set(folderIds);
    setFiles((prev) => prev.filter((f) => !fset.has(f.id)));
    setResults((r) => (r ? r.filter((f) => !fset.has(f.id)) : r));
    setFolders((prev) => prev.filter((f) => !foset.has(f.id)));
    fileIds.forEach(removeRecentFile);
    folderIds.forEach(removeRecentFolder);
    clearSelection();
    void runDeletions([
      ...fileIds.map((id) => async () => {
        await authed((t) => api.deleteFile(t, id));
      }),
      ...folderIds.map((id) => async () => {
        await authed((t) => api.deleteFolder(t, id));
      }),
    ]);
  };

  // Download each selected file individually (no zip) — one browser download
  // per file, streamed straight from the provider.
  const bulkDownload = async () => {
    const targets = rawFiles.filter((f) => selFiles.has(f.id));
    if (targets.length === 0) return;
    let ok = 0;
    for (const file of targets) {
      try {
        const blob = await authed((t) => api.downloadBlob(t, file.id));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        ok += 1;
      } catch {
        // Skip this one and keep going; summarised in the toast below.
      }
    }
    toast(
      ok === targets.length
        ? `Downloading ${ok} file${ok === 1 ? "" : "s"}`
        : `Downloaded ${ok} of ${targets.length}. Some failed.`,
      ok === targets.length ? undefined : "error",
    );
  };

  // Move a set of files and/or folders into a target folder. Handles both a
  // single dragged item and a whole multi-selection dragged at once.
  const moveItemsToFolder = (fileIds: string[], folderIds: string[], targetId: string) => {
    setDragFolder(null);
    const folders = folderIds.filter((id) => id !== targetId); // can't move a folder into itself
    if (fileIds.length === 0 && folders.length === 0) return;
    // Optimistic: moved items leave the current view; a failed move resyncs on reload.
    if (fileIds.length) {
      const set = new Set(fileIds);
      setFiles((prev) => prev.filter((f) => !set.has(f.id)));
      setResults((r) => (r ? r.filter((f) => !set.has(f.id)) : r));
    }
    if (folders.length) {
      const set = new Set(folders);
      setFolders((prev) => prev.filter((f) => !set.has(f.id)));
    }
    clearSelection();
    const count = fileIds.length + folders.length;
    run(async () => {
      await Promise.all([
        ...fileIds.map((id) => authed((t) => api.moveFile(t, id, targetId))),
        ...folders.map((id) => authed((t) => api.moveFolder(t, id, targetId))),
      ]);
    }, count > 1 ? `${count} items moved` : "Moved");
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

  // Rendered as the first child of every return path so the same instance
  // persists from first paint through auth + the initial fetch (no remount).
  const bootOverlay = showBoot ? (
    <IntroSplash
      word="BYOS"
      subtitle="Bring Your Own Storage"
      skippable
      minMs={2000}
      onFinished={finishBoot}
    />
  ) : null;

  if (authLoading || !user) {
    return (
      <>
        {bootOverlay}
        <div className="flex h-dvh bg-zinc-50">
        <div className="hidden w-[4.5rem] shrink-0 border-r border-zinc-200 bg-white p-4 sm:block md:w-64">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-4 h-12 w-full rounded-2xl" />
          <div className="mt-4 space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-r-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-4 sm:p-6">
          <Skeleton className="h-9 w-full max-w-64 rounded-full" />
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
      </>
    );
  }

  if (!user.username) {
    return (
      <>
        {bootOverlay}
        <UsernameSetup />
      </>
    );
  }

  const onLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const initials = (user.display_name?.trim()?.[0] ?? "U").toUpperCase();
  const typeLabel = CATEGORIES.find((c) => c.key === typeFilter)?.label ?? "All types";

  const plainDrive = view === "drive" && !tagFilter && !searchActive;
  const rawFiles = searchActive ? (results ?? []) : files;
  const filteredFiles =
    typeFilter === "folder"
      ? []
      : rawFiles.filter(
          (f) => matchesType(f, typeFilter) && (storageFilter === "all" || homeOf(f)?.id === storageFilter),
        );
  const storageFilterOn = storages.find((s) => s.id === storageFilter);
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
  const visibleCount = shownFiles.length + shownFolders.length;
  const allSelected = visibleCount > 0 && selCount === visibleCount;
  const selectAll = () => {
    setSelFiles(new Set(shownFiles.map((f) => f.id)));
    setSelFolders(new Set(shownFolders.map((f) => f.id)));
  };
  const toggleSelectAll = () => (allSelected ? clearSelection() : selectAll());
  const sortLabel =
    SORT_OPTIONS.find((o) => o.field === sortField && o.dir === sortDir)?.label ?? "Sort";

  const menuTrigger = (
    <span className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
      <MoreVertical className="h-4 w-4" />
    </span>
  );

  const fileMenu = (file: FileItem) => (
    <Menu label="More actions" trigger={() => menuTrigger}>
      {(close) => (
        <>
          <MenuItem icon={<Eye className="h-4 w-4" />} label="Preview" onClick={() => { close(); setPreview(file); }} />
          <MenuItem icon={<Download className="h-4 w-4" />} label="Download" onClick={() => { close(); download(file); }} />
          <MenuItem icon={<Share2 className="h-4 w-4" />} label="Share" onClick={() => { close(); setAliasFor(file); }} />
          <MenuItem icon={<Pencil className="h-4 w-4" />} label="Rename" onClick={() => { close(); setRenamingFile(file); }} />
          <MenuItem icon={<History className="h-4 w-4" />} label="Versions" onClick={() => { close(); setVersionsFor(file); }} />
          <MenuItem icon={<Tag className="h-4 w-4" />} label="Tags" onClick={() => { close(); setTagsFor(file); }} />
          <MenuItem icon={<FolderInput className="h-4 w-4" />} label="Move to…" onClick={() => { close(); setMovingFile(file); }} />
          <MenuItem icon={<Trash2 className="h-4 w-4" />} label="Delete" danger onClick={() => { close(); if (prefs.confirmDelete) setConfirming({ kind: "file", file }); else removeFile(file); }} />
        </>
      )}
    </Menu>
  );

  const folderMenu = (folder: FolderItem) => (
    <Menu label="More actions" trigger={() => menuTrigger}>
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
              className="h-4 w-4 rounded-full border border-zinc-200 bg-white"
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
          <MenuItem icon={<Trash2 className="h-4 w-4" />} label="Delete" danger onClick={() => { close(); if (prefs.confirmDelete) setConfirming({ kind: "folder", folder }); else removeFolder(folder); }} />
        </>
      )}
    </Menu>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <p className="type-heading-sm max-w-md">
        {searchActive ? (
          <>
            Nothing <span className="type-em">matches</span> that.
          </>
        ) : (
          <>
            This folder is <span className="type-em">empty</span>.
          </>
        )}
      </p>
      <p className="mt-4 text-[1.0625rem] leading-[1.35] text-zinc-600">
        {searchActive ? "Try a different search." : "Drop files here, or use New to upload."}
      </p>
    </div>
  );

  const listSkeleton = (
    <div className="border-t border-zinc-200">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-zinc-200 px-4 py-3.5">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-4 w-[45%]" />
          <Skeleton className="ml-auto h-3 w-14" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );

  const gridSkeleton = (
    <div className={GRID_COLS}>
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
    // Columns drop away as the screen narrows (see LIST_COLS) instead of the
    // rows scrolling sideways; on a phone what they held moves under the name.
    <div>
      <div>
        {/* Column headings are museum-signage labels, not a table chrome bar. */}
      <div className={`grid ${LIST_COLS} items-center gap-4 border-b border-zinc-200 px-4 py-[var(--row-py)] text-[0.8125rem] text-zinc-500`}>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            aria-label="Select all"
            className="h-4 w-4 shrink-0 accent-zinc-900"
          />
          {/* Spacers matching the row's star + file-type icon so "Name" lines up
              with where the file/folder names actually start. */}
          <span className="h-4 w-4 shrink-0" aria-hidden />
          <span className="h-5 w-5 shrink-0" aria-hidden />
          <button
            onClick={() => cycleSort("name")}
            className={`flex items-center text-left hover:text-zinc-800 ${sortField === "name" ? "text-zinc-900" : ""}`}
          >
            Name{sortArrow("name")}
          </button>
        </div>
        <span className="hidden lg:block">Kind</span>
        <span className="hidden lg:block">Stored on</span>
        <button
          onClick={() => cycleSort("modified")}
          className={`hidden items-center text-left hover:text-zinc-800 sm:flex ${sortField === "modified" ? "text-zinc-900" : ""}`}
        >
          Modified{sortArrow("modified")}
        </button>
        <button
          onClick={() => cycleSort("size")}
          className={`hidden items-center text-left hover:text-zinc-800 sm:flex ${sortField === "size" ? "text-zinc-900" : ""}`}
        >
          Size{sortArrow("size")}
        </button>
        <span />
      </div>
      {shownFolders.map((folder) => (
        <div
          key={folder.id}
          draggable
          onDragStart={(e) => {
            // Dragging a selected item moves the whole selection; otherwise just this one.
            const folderIds = selFolders.has(folder.id) ? [...selFolders] : [folder.id];
            const fileIds = selFolders.has(folder.id) ? [...selFiles] : [];
            e.dataTransfer.setData(FOLDER_DRAG_TYPE, folderIds.join(","));
            if (fileIds.length) e.dataTransfer.setData(FILE_DRAG_TYPE, fileIds.join(","));
            e.dataTransfer.effectAllowed = "move";
            const count = fileIds.length + folderIds.length;
            if (count > 1) setMultiDragImage(e.dataTransfer, count);
          }}
          onDragOver={(e) => {
            const t = e.dataTransfer.types;
            if (
              t.includes(FILE_DRAG_TYPE) ||
              t.includes(FOLDER_DRAG_TYPE) ||
              t.includes("Files")
            ) {
              e.preventDefault();
              setDragFolder(folder.id);
            }
          }}
          onDragLeave={() => setDragFolder((d) => (d === folder.id ? null : d))}
          onDrop={(e) => {
            if (e.dataTransfer.files.length > 0) {
              // Finder drop → upload straight into this folder.
              e.preventDefault();
              e.stopPropagation();
              setDragFolder(null);
              setDragging(false);
              upload(e.dataTransfer.files, folder.id);
              return;
            }
            const fileData = e.dataTransfer.getData(FILE_DRAG_TYPE);
            const folderData = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
            if (fileData || folderData) {
              e.preventDefault();
              e.stopPropagation();
              moveItemsToFolder(
                fileData ? fileData.split(",") : [],
                folderData ? folderData.split(",") : [],
                folder.id,
              );
            }
          }}
          onClick={() => { addRecentFolder(folder); openFolder(folder.id); }}
          className={`group grid cursor-pointer ${LIST_COLS} items-center gap-4 border-b border-zinc-200 px-4 py-[var(--row-py)] transition-colors ${
            dragFolder === folder.id
              ? "bg-zinc-100 ring-1 ring-inset ring-zinc-900"
              : selFolders.has(folder.id)
                ? "bg-zinc-100"
                : "hover:bg-zinc-50"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              checked={selFolders.has(folder.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleSelFolder(folder.id)}
              className={`h-4 w-4 shrink-0 accent-zinc-900 ${selCount > 0 || selFolders.has(folder.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"}`}
            />
            {/* Folders have no star — reserve the column so names align with files. */}
            <span className="h-4 w-4 shrink-0" aria-hidden />
            <Folder
              className="h-5 w-5 shrink-0 text-zinc-900"
              fill={folder.color ?? "none"}
              style={folder.color ? { color: folder.color } : undefined}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[0.9375rem] font-medium text-zinc-900">{folder.name}</span>
              <span className="truncate text-[0.75rem] text-zinc-500 sm:hidden">
                {shortDate(folder.created_at)} · {folder.size ? humanSize(folder.size) : "Empty"}
              </span>
            </span>
          </div>
          <span className="hidden text-[0.9375rem] text-zinc-500 lg:block">Folder</span>
          <span className="hidden lg:block" />
          <span className="hidden text-[0.9375rem] text-zinc-500 sm:block">
            {shortDate(folder.created_at)}
          </span>
          <span className="hidden text-[0.9375rem] text-zinc-500 sm:block">
            {folder.size ? humanSize(folder.size) : "Empty"}
          </span>
          {folderMenu(folder)}
        </div>
      ))}
      {shownFiles.map((file) => (
        <div
          key={file.id}
          draggable
          onDragStart={(e) => {
            // Dragging a selected file moves the whole selection; otherwise just this one.
            const fileIds = selFiles.has(file.id) ? [...selFiles] : [file.id];
            const folderIds = selFiles.has(file.id) ? [...selFolders] : [];
            e.dataTransfer.setData(FILE_DRAG_TYPE, fileIds.join(","));
            if (folderIds.length) e.dataTransfer.setData(FOLDER_DRAG_TYPE, folderIds.join(","));
            e.dataTransfer.effectAllowed = "move";
            const count = fileIds.length + folderIds.length;
            if (count > 1) setMultiDragImage(e.dataTransfer, count);
          }}
          onClick={() => { addRecentFile(file); setPreview(file); }}
          className={`group grid cursor-pointer ${LIST_COLS} items-center gap-4 border-b border-zinc-200 px-4 py-[var(--row-py)] transition-colors ${
            selFiles.has(file.id) ? "bg-zinc-100" : "hover:bg-zinc-50"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              checked={selFiles.has(file.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleSelFile(file.id)}
              className={`h-4 w-4 shrink-0 accent-zinc-900 ${selCount > 0 || selFiles.has(file.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"}`}
            />
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
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[0.9375rem] font-medium text-zinc-900">{file.name}</span>
              <span className="flex min-w-0 items-center gap-1 text-[0.75rem] text-zinc-500 sm:hidden">
                {storageSource(file, false)}
                <span className="shrink-0">· {shortDate(file.modified_at)} · {humanSize(file.size)}</span>
              </span>
            </span>
            {file.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                onClick={(e) => { e.stopPropagation(); openTag(tag); }}
                className="hidden shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[0.8125rem] text-zinc-600 hover:bg-zinc-200 xl:inline"
              >
                {tag}
              </button>
            ))}
          </div>
          <span className="hidden truncate text-[0.9375rem] text-zinc-500 lg:block">{kindOf(file)}</span>
          <span className="hidden min-w-0 text-[0.9375rem] lg:flex">{storageSource(file)}</span>
          <span className="hidden text-[0.9375rem] text-zinc-500 sm:block">
            {shortDate(file.modified_at)}
          </span>
          <span className="hidden text-[0.9375rem] text-zinc-500 sm:block">
            {humanSize(file.size)}
          </span>
          {fileMenu(file)}
        </div>
      ))}
      </div>
    </div>
  );

  const gridView = (
    <div className={GRID_COLS}>
      {shownFolders.map((folder) => (
        <div
          key={folder.id}
          draggable
          onDragStart={(e) => {
            // Dragging a selected item moves the whole selection; otherwise just this one.
            const folderIds = selFolders.has(folder.id) ? [...selFolders] : [folder.id];
            const fileIds = selFolders.has(folder.id) ? [...selFiles] : [];
            e.dataTransfer.setData(FOLDER_DRAG_TYPE, folderIds.join(","));
            if (fileIds.length) e.dataTransfer.setData(FILE_DRAG_TYPE, fileIds.join(","));
            e.dataTransfer.effectAllowed = "move";
            const count = fileIds.length + folderIds.length;
            if (count > 1) setMultiDragImage(e.dataTransfer, count);
          }}
          onDragOver={(e) => {
            const t = e.dataTransfer.types;
            if (
              t.includes(FILE_DRAG_TYPE) ||
              t.includes(FOLDER_DRAG_TYPE) ||
              t.includes("Files")
            ) {
              e.preventDefault();
              setDragFolder(folder.id);
            }
          }}
          onDragLeave={() => setDragFolder((d) => (d === folder.id ? null : d))}
          onDrop={(e) => {
            if (e.dataTransfer.files.length > 0) {
              // Finder drop → upload straight into this folder.
              e.preventDefault();
              e.stopPropagation();
              setDragFolder(null);
              setDragging(false);
              upload(e.dataTransfer.files, folder.id);
              return;
            }
            const fileData = e.dataTransfer.getData(FILE_DRAG_TYPE);
            const folderData = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
            if (fileData || folderData) {
              e.preventDefault();
              e.stopPropagation();
              moveItemsToFolder(
                fileData ? fileData.split(",") : [],
                folderData ? folderData.split(",") : [],
                folder.id,
              );
            }
          }}
          onClick={() => { addRecentFolder(folder); openFolder(folder.id); }}
          className={`group flex cursor-pointer items-center justify-between gap-2 rounded-xl border bg-white p-4 ${
 dragFolder === folder.id
              ? "border-zinc-900 ring-2 ring-zinc-900"
              : selFolders.has(folder.id)
                ? "border-zinc-900 ring-1 ring-zinc-900"
                : "border-zinc-200 hover:border-zinc-900/30 hover:bg-zinc-50"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              checked={selFolders.has(folder.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleSelFolder(folder.id)}
              className={`h-4 w-4 shrink-0 accent-zinc-900 ${selCount > 0 || selFolders.has(folder.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"}`}
            />
            <Folder
              className="h-6 w-6 shrink-0 text-zinc-900"
              fill={folder.color ?? "none"}
              style={folder.color ? { color: folder.color } : undefined}
            />
            <div className="min-w-0">
              <span className="block truncate text-[0.9375rem] font-medium text-zinc-900">
                {folder.name}
              </span>
              {folder.size ? (
                <span className="text-[0.8125rem] text-zinc-400">{humanSize(folder.size)}</span>
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
            // Dragging a selected file moves the whole selection; otherwise just this one.
            const fileIds = selFiles.has(file.id) ? [...selFiles] : [file.id];
            const folderIds = selFiles.has(file.id) ? [...selFolders] : [];
            e.dataTransfer.setData(FILE_DRAG_TYPE, fileIds.join(","));
            if (folderIds.length) e.dataTransfer.setData(FOLDER_DRAG_TYPE, folderIds.join(","));
            e.dataTransfer.effectAllowed = "move";
            const count = fileIds.length + folderIds.length;
            if (count > 1) setMultiDragImage(e.dataTransfer, count);
          }}
          onClick={() => { addRecentFile(file); setPreview(file); }}
          className={`group cursor-pointer rounded-xl border bg-white p-4 transition-colors hover:bg-zinc-50 ${
 selFiles.has(file.id)
              ? "border-zinc-900 ring-1 ring-zinc-900"
              : "border-zinc-200 hover:border-zinc-900/30"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selFiles.has(file.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelFile(file.id)}
                className={`h-4 w-4 shrink-0 accent-zinc-900 ${selCount > 0 || selFiles.has(file.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"}`}
              />
              <span aria-hidden>{fileIcon(file.mime, file.ext, "h-7 w-7 text-zinc-500")}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={(e) => { e.stopPropagation(); toggleFavorite(file); }} aria-label="Star">
                <Star
                  className={`h-4 w-4 ${file.is_favorite ? "fill-amber-400 text-amber-400" : "text-zinc-300 hover:text-amber-400"}`}
                />
              </button>
              {fileMenu(file)}
            </div>
          </div>
          <p className="mt-2 truncate text-[0.9375rem] font-medium text-zinc-900">{file.name}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-zinc-500">
            <span className="shrink-0">{humanSize(file.size)}</span>
            <span aria-hidden className="text-zinc-300">·</span>
            {storageSource(file, false)}
          </p>
        </div>
      ))}
    </div>
  );

  // Both the rail's New menu and the phone tab bar's + run these, so uploading
  // and folder creation behave identically wherever they're triggered from.
  const toDrive = () => {
    setView("drive");
    setTagFilter(null);
  };
  const newFolder = () => {
    toDrive();
    setNfOpen(true);
  };
  const pickFiles = () => {
    askStorageNext.current = false; // a cancelled "Upload to…" doesn't linger
    toDrive();
    inputRef.current?.click();
  };
  // "Upload to…": the same, but the storage is chosen once the files are.
  const usableStorages = storages.filter((s) => s.status === "connected");
  const pickFilesTo = () => {
    pickFiles();
    askStorageNext.current = true;
  };

  return (
    <>
      {bootOverlay}
      <div className="flex h-dvh bg-zinc-50">
      <MobileTabs view={view} onView={setView} />
      <Sidebar
        view={view}
        onView={setView}
        onNewFolder={newFolder}
        onUpload={pickFiles}
        onUploadTo={usableStorages.length > 1 ? pickFilesTo : undefined}
        storages={storagesReady ? storages : null}
      />
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
          <LogoMark className="h-8 w-8 md:hidden" />
          <div className="flex flex-1 justify-center">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full max-w-lg items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-left transition-colors hover:border-zinc-900"
            >
              <Search className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="flex-1 text-[0.9375rem] text-zinc-400">Search files &amp; folders…</span>
              <kbd className="hidden shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[0.6875rem] text-zinc-500 sm:inline">
                ⌘K
              </kbd>
            </button>
          </div>
          <Menu
            label="Account"
            trigger={() => (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-[0.9375rem] font-medium text-white">
                {initials}
              </span>
            )}
          >
            {(close) => (
              <>
                <div className="border-b border-zinc-100 px-4 py-2 text-[0.8125rem] text-zinc-500">
                  {user.display_name ?? "Signed in"}
                </div>
                <MenuItem label="Settings" onClick={() => { close(); router.push("/settings?from=drive"); }} />
                {/* Admins only. `is_admin` is computed server-side from config,
                    so hiding this is presentation — the endpoint itself 404s for
                    anyone else regardless of what the client renders. */}
                {user.is_admin ? (
                  <MenuItem
                    label="Admin dashboard"
                    onClick={() => {
                      close();
                      router.push("/admin");
                    }}
                  />
                ) : null}
                {supportEnabled ? (
                  <MenuItem
                    label="Buy me a coffee"
                    onClick={() => {
                      close();
                      openSupport();
                    }}
                  />
                ) : null}
                <MenuItem
                  exit
                  label="Log out"
                  onClick={() => {
                    close();
                    void onLogout();
                  }}
                />
              </>
            )}
          </Menu>
        </header>

        <main
          className="flex-1 overflow-auto px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-24 lg:px-8"
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
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
          {/* Drag-to-upload overlay (hidden while hovering a specific folder,
              which shows its own drop highlight instead). */}
          {dragging && !dragFolder ? (
            <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-zinc-900/5 p-4 sm:p-6">
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-900 bg-white px-8 py-8 text-center shadow-xl sm:px-16 sm:py-12">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 text-white">
                  <UploadCloud className="h-7 w-7" />
                </div>
                <p className="type-heading-sm">
                  Drop to upload
                </p>
                <p className="text-[0.9375rem] text-zinc-500">
                  {folderId ? "Files will be added to this folder" : "Files will be added to My Drive"}
                </p>
              </div>
            </div>
          ) : null}
          {view === "duplicates" ? (
            <DuplicatesPanel scrolled={scrolled} />
          ) : view === "missing" ? (
            <MissingPanel />
          ) : view === "developer" ? (
            <DeveloperPanel />
          ) : view === "links" ? (
            <div className="pt-2">
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
            <div>
              {/* Bulk-action bar (multi-select).
                  Opaque on purpose: it's sticky, so at 80% alpha the column
                  headings underneath bled straight through it. Actions collapse
                  to icons below `sm` — five labelled buttons wrapped into a
                  four-line tower on a phone. */}
              {selCount > 0 ? (
                <div
                  className={`sticky top-0 z-20 mb-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-[0.9375rem] transition-colors sm:gap-3 sm:px-4 sm:py-2.5 ${
                    scrolled ? "border-zinc-300 bg-zinc-100" : "border-zinc-200 bg-zinc-50"
                  }`}
                >
                  <span className="shrink-0 font-medium text-zinc-900">
                    {selCount} <span className="hidden sm:inline">selected</span>
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
                    {selFiles.size > 0 ? (
                      <>
                        <button
                          onClick={bulkDownload}
                          title="Download"
                          aria-label="Download"
                          className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-zinc-700 transition-colors hover:bg-white sm:px-2.5"
                        >
                          <Download className="h-4 w-4 shrink-0" />
                          <span className="hidden sm:inline">Download</span>
                        </button>
                        <button
                          onClick={bulkStar}
                          title="Star"
                          aria-label="Star"
                          className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-zinc-700 transition-colors hover:bg-white sm:px-2.5"
                        >
                          <Star className="h-4 w-4 shrink-0" />
                          <span className="hidden sm:inline">Star</span>
                        </button>
                        <button
                          onClick={() => setBulkTagOpen(true)}
                          title="Tag"
                          aria-label="Tag"
                          className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-zinc-700 transition-colors hover:bg-white sm:px-2.5"
                        >
                          <Tag className="h-4 w-4 shrink-0" />
                          <span className="hidden sm:inline">Tag</span>
                        </button>
                      </>
                    ) : null}
                    <button
                      onClick={() => setBulkConfirm(true)}
                      title="Delete"
                      aria-label="Delete"
                      className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-red-600 transition-colors hover:bg-white sm:px-2.5"
                    >
                      <Trash2 className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                    <button
                      onClick={clearSelection}
                      className="flex items-center rounded-full px-2 py-1.5 text-zinc-500 transition-colors hover:bg-white"
                      title="Clear selection"
                      aria-label="Clear selection"
                    >
                      <X className="h-4 w-4 shrink-0" />
                    </button>
                  </div>
                </div>
              ) : null}
              {/* Title + view toggle */}
              <div className="flex flex-wrap items-end justify-between gap-3 pb-4 pt-6 sm:gap-4 sm:pb-5 sm:pt-8">
                {searchActive ? (
                  <div>
                    <p className="type-label">Search</p>
                    <h1 className="type-heading mt-2">“{search.trim()}”</h1>
                  </div>
                ) : view === "starred" ? (
                  <div>
                    <p className="type-label">Favourites</p>
                    <h1 className="type-heading mt-2">Starred</h1>
                  </div>
                ) : tagFilter ? (
                  <div>
                    <p className="type-label">Tag</p>
                    <h1 className="type-heading mt-2 flex items-baseline gap-3">
                      {tagFilter}
                      <button
                        onClick={() => setTagFilter(null)}
                        className="text-[0.9375rem] text-zinc-500 hover:text-zinc-900 hover:underline"
                      >
                        clear
                      </button>
                    </h1>
                  </div>
                ) : (
                  <nav className="type-heading-sm flex flex-wrap items-baseline gap-1.5">
                    <button
                      onClick={() => setFolderId(undefined)}
                      className={folderId ? "text-zinc-500 hover:text-zinc-800" : ""}
                    >
                      My Drive
                    </button>
                    {(() => {
                      // At most three shown: My Drive › first folder › … › current
                      // folder. "…" opens the folders in between.
                      const collapse = crumbs.length > 2;
                      const head = collapse ? crumbs.slice(0, 1) : crumbs.slice(0, -1);
                      const hidden = collapse ? crumbs.slice(1, -1) : [];
                      const last = crumbs[crumbs.length - 1];
                      const crumb = (c: { id: string; name: string }) => (
                        <span key={c.id} className="flex min-w-0 items-center gap-1.5">
                          <span className="text-zinc-300">›</span>
                          <button
                            onClick={() => setFolderId(c.id)}
                            title={c.name}
                            className={
                              c.id === folderId
                                ? "max-w-[10rem] truncate sm:max-w-[22rem]"
                                : "max-w-[10rem] truncate text-zinc-500 hover:text-zinc-800 sm:max-w-[16rem]"
                            }
                          >
                            {c.name}
                          </button>
                        </span>
                      );
                      return (
                        <>
                          {head.map(crumb)}
                          {hidden.length ? (
                            <span className="flex items-center gap-1.5">
                              <span className="text-zinc-300">›</span>
                              <Menu
                                align="left"
                                trigger={() => (
                                  <span
                                    className="cursor-pointer px-1 text-zinc-500 hover:text-zinc-800"
                                    title={hidden.map((c) => c.name).join(" › ")}
                                  >
                                    …
                                  </span>
                                )}
                              >
                                {(close) =>
                                  hidden.map((c) => (
                                    <MenuItem
                                      key={c.id}
                                      label={c.name}
                                      onClick={() => {
                                        close();
                                        setFolderId(c.id);
                                      }}
                                    />
                                  ))
                                }
                              </Menu>
                            </span>
                          ) : null}
                          {last ? crumb(last) : null}
                        </>
                      );
                    })()}
                  </nav>
                )}
                <div className="flex items-center rounded-full border border-zinc-200 bg-white p-0.5">
                  <button
                    onClick={() => setLayout("list")}
                    aria-label="List view"
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.9375rem] ${layout === "list" ? "bg-zinc-100 text-zinc-900" : "text-zinc-500"}`}
                  >
                    <List className="h-4 w-4" /> List
                  </button>
                  <button
                    onClick={() => setLayout("grid")}
                    aria-label="Grid view"
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.9375rem] ${layout === "grid" ? "bg-zinc-100 text-zinc-900" : "text-zinc-500"}`}
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
                    <span className="flex items-center gap-1 field-sm text-zinc-700 hover:bg-zinc-50">
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
                {storages.length > 1 ? (
                  <Menu
                    align="left"
                    trigger={() => (
                      <span
                        className={`flex items-center gap-1.5 field-sm ${
                          storageFilterOn ? "sel-fill" : "text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {storageFilterOn ? (
                          <>
                            <StorageIcon provider={storageFilterOn.provider} className="h-3.5 w-3.5" />
                            {storageFilterOn.label || providerName(storageFilterOn.provider)}
                          </>
                        ) : (
                          "All storages"
                        )}{" "}
                        ▾
                      </span>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem
                          label="All storages"
                          onClick={() => {
                            close();
                            setStorageFilter("all");
                          }}
                        />
                        {storages.map((s) => (
                          <MenuItem
                            key={s.id}
                            icon={<StorageIcon provider={s.provider} className="h-4 w-4" />}
                            label={storageTitle(s)}
                            onClick={() => {
                              close();
                              setStorageFilter(s.id);
                            }}
                          />
                        ))}
                      </>
                    )}
                  </Menu>
                ) : null}
                {layout === "grid" ? (
                  <Menu
                    align="left"
                    trigger={() => (
                      <span className="flex items-center gap-1.5 field-sm text-zinc-700 hover:bg-zinc-50">
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
                            setSort(o.field, o.dir);
                          }}
                        />
                      ))
                    }
                  </Menu>
                ) : null}
                <MobileNewMenu
                  onNewFolder={newFolder}
                  onUpload={pickFiles}
                  onUploadTo={usableStorages.length > 1 ? pickFilesTo : undefined}
                />
              </div>

              <StorageAlerts storages={storages} />
              {error ? <p className="mb-3 text-[0.9375rem] text-red-600">{error}</p> : null}

              {loading && !searchActive ? (
                layout === "list" ? (
                  listSkeleton
                ) : (
                  gridSkeleton
                )
              ) : shownFolders.length === 0 && shownFiles.length === 0 && !hasMore ? (
                emptyState
              ) : layout === "list" ? (
                listView
              ) : (
                gridView
              )}

              {!searchActive && !loading ? (
                <div ref={sentinelRef} className="py-4 text-center text-[0.9375rem] text-zinc-400">
                  {loadingMore || hasMore ? "Loading more…" : null}
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
        onNavigate={(v) => {
          setView(v);
          setTagFilter(null);
          setSearch("");
        }}
      />
      {preview ? <PreviewModal file={preview} storedOn={storedOn(preview)} onClose={() => setPreview(null)} /> : null}
      {pickStorage ? (
        <StoragePicker
          storages={storages}
          count={pickStorage.files.length}
          onCancel={() => setPickStorage(null)}
          onPick={(storageId) => {
            const { files: picked, targetFolderId } = pickStorage;
            setPickStorage(null);
            void startUpload(picked, targetFolderId, storageId);
          }}
        />
      ) : null}
      {conflict ? (
        <UploadConflictModal
          names={conflict.items.map((c) => c.file.name)}
          folderLabel={conflict.folderLabel}
          onResolve={resolveConflict}
          onCancel={() => setConflict(null)}
        />
      ) : null}
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
      {confirming ? (
        <ConfirmModal
          title={confirming.kind === "file" ? "Delete file?" : "Delete folder?"}
          message={
            confirming.kind === "file"
              ? `“${truncateMiddle(confirming.file.name)}” will be permanently removed from your drive.`
              : `“${truncateMiddle(confirming.folder.name)}” and everything in it will be permanently deleted.`
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (confirming.kind === "file") removeFile(confirming.file);
            else removeFolder(confirming.folder);
            setConfirming(null);
          }}
        />
      ) : null}
      {bulkConfirm ? (
        <ConfirmModal
          title={`Delete ${selCount} item${selCount === 1 ? "" : "s"}?`}
          message="The selected files and folders (and everything inside those folders) will be permanently deleted."
          onCancel={() => setBulkConfirm(false)}
          onConfirm={() => {
            bulkDelete();
            setBulkConfirm(false);
          }}
        />
      ) : null}
      {bulkTagOpen ? (
        <RenameModal
          title={`Tag ${selFiles.size} file${selFiles.size === 1 ? "" : "s"}`}
          initial=""
          placeholder="Tag name"
          confirmLabel="Add tag"
          onClose={() => setBulkTagOpen(false)}
          onSubmit={(tag) => bulkAddTag(tag.toLowerCase())}
        />
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

      {delProgress ? (
        <div className="fixed bottom-32 left-4 right-4 z-40 flex items-center gap-3 rounded-2xl glass-panel px-4 py-3 sm:right-auto md:bottom-4">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-red-600" />
          <div>
            <div className="text-[0.9375rem] font-medium text-zinc-800">
              Deleting {delProgress.done}/{delProgress.total}…
            </div>
            <div className="mt-1.5 h-1 w-44 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-red-500 transition-all duration-200"
                style={{ width: `${Math.round((delProgress.done / delProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {uploads.length > 0 ? (
        <div className="fixed bottom-32 left-4 right-4 z-40 overflow-hidden rounded-2xl glass-panel sm:left-auto sm:w-72 md:bottom-4">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-[0.9375rem] font-medium text-zinc-800">
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
              <li key={u.id} className="px-3 py-2 text-[0.9375rem]">
                <div className="flex items-center gap-2">
                  {u.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-900" />
                  ) : u.status === "done" ? (
                    <Check className="h-4 w-4 shrink-0 text-zinc-900" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-zinc-700">{u.name}</span>
                  {u.status === "uploading" ? (
                    <span className="shrink-0 text-[0.8125rem] tabular-nums text-zinc-500">
                      {u.progress >= 100 ? "Processing…" : `${u.progress}%`}
                    </span>
                  ) : null}
                </div>
                {u.status === "uploading" ? (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                    {u.progress >= 100 ? (
                      // Bytes are all sent; the server is still saving them to storage.
                      <div className="h-full w-full animate-pulse rounded-full bg-zinc-900" />
                    ) : (
                      <div
                        className="h-full rounded-full bg-zinc-900 transition-all duration-200"
                        style={{ width: `${u.progress}%` }}
                      />
                    )}
                  </div>
                ) : u.note ? (
                  <p className="mt-0.5 pl-6 text-[0.8125rem] text-red-600">{u.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>
    </>
  );
}
