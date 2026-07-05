"use client";

import { type FileItem, type FolderItem } from "@byos/api-client";
import {
  ArrowRight,
  BarChart3,
  Code2,
  CornerDownLeft,
  Folder as FolderIcon,
  HardDrive,
  Link2,
  Search,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fileIcon } from "@/components/dashboard/file-icon";
import type { DriveView } from "@/components/dashboard/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { addRecentFile, addRecentFolder, getRecents } from "@/lib/recents";

function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

const PAGES: { view: DriveView; label: string; Icon: typeof HardDrive }[] = [
  { view: "drive", label: "My Drive", Icon: HardDrive },
  { view: "starred", label: "Starred", Icon: Star },
  { view: "links", label: "Links", Icon: Link2 },
  { view: "insights", label: "Insights", Icon: BarChart3 },
  { view: "developer", label: "Developer", Icon: Code2 },
];

const FILTERS: { insert: string; label: string; hint: string }[] = [
  { insert: "type:", label: "type:pdf", hint: "pdf · image · video · audio · doc" },
  { insert: "ext:", label: "ext:png", hint: "by file extension" },
  { insert: "tag:", label: "tag:invoice", hint: "has a tag (repeatable)" },
  { insert: "in:", label: "in:reports", hint: "inside a folder" },
  { insert: "size:>", label: "size:>2mb", hint: "size:>2mb · size:<500kb" },
  { insert: "after:", label: "after:2026-06-01", hint: "created after a date" },
  { insert: "before:", label: "before:2026-07-01", hint: "created before a date" },
  { insert: "during:", label: "during:2026-06", hint: "a year / month / day" },
  { insert: "is:starred", label: "is:starred", hint: "favorites only" },
];

const RECENT_LIMIT = 5;

type Item =
  | { kind: "page"; view: DriveView }
  | { kind: "search" }
  | { kind: "folder"; folder: FolderItem }
  | { kind: "file"; file: FileItem };

export function SearchPalette({
  open,
  onClose,
  onOpenFile,
  onOpenFolder,
  onSearchAll,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onOpenFile: (file: FileItem) => void;
  onOpenFolder: (folderId: string) => void;
  onSearchAll: (query: string) => void;
  onNavigate: (view: DriveView) => void;
}) {
  const authed = useAuthed();
  const [query, setQuery] = useState("");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [recentFolders, setRecentFolders] = useState<FolderItem[]>([]);
  const [recentFiles, setRecentFiles] = useState<FileItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasQuery = query.trim() !== "";

  // Flat list backing keyboard nav.
  const items = useMemo<Item[]>(() => {
    if (hasQuery) {
      return [
        { kind: "search" as const },
        ...folders.map((folder) => ({ kind: "folder" as const, folder })),
        ...files.map((file) => ({ kind: "file" as const, file })),
      ];
    }
    return [
      ...PAGES.map((p) => ({ kind: "page" as const, view: p.view })),
      ...recentFolders.map((folder) => ({ kind: "folder" as const, folder })),
      ...recentFiles.map((file) => ({ kind: "file" as const, file })),
    ];
  }, [hasQuery, folders, files, recentFolders, recentFiles]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFolders([]);
      setFiles([]);
      setSearched(false);
      setActive(0);
      setShowHelp(false);
      const r = getRecents();
      setRecentFolders(r.folders.slice(0, RECENT_LIMIT));
      setRecentFiles(r.files.slice(0, RECENT_LIMIT));
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced search across folders + files.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setFolders([]);
      setFiles([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      authed((tok) => Promise.all([api.searchFolders(tok, q), api.nlSearch(tok, q)]))
        .then(([fld, fls]) => {
          setFolders(fld);
          setFiles(fls);
          setActive(0);
        })
        .catch(() => {
          setFolders([]);
          setFiles([]);
        })
        .finally(() => {
          setSearched(true);
          setLoading(false);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, authed]);

  const chooseItem = useCallback(
    (item: Item) => {
      if (item.kind === "search") onSearchAll(query.trim());
      else if (item.kind === "page") onNavigate(item.view);
      else if (item.kind === "folder") {
        addRecentFolder(item.folder);
        onOpenFolder(item.folder.id);
      } else {
        addRecentFile(item.file);
        onOpenFile(item.file);
      }
      onClose();
    },
    [onSearchAll, onNavigate, onOpenFolder, onOpenFile, onClose, query],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      chooseItem(items[active]);
    }
  };

  const insertFilter = (insert: string) => {
    setQuery((q) => `${q.trimEnd()} ${insert}`.trimStart());
    inputRef.current?.focus();
  };

  const noMatches = hasQuery && !loading && searched && folders.length === 0 && files.length === 0;

  if (!open) return null;

  const rowClass = (i: number) =>
    `flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${
      i === active
        ? "bg-indigo-50 dark:bg-indigo-500/15"
        : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
    }`;
  const heading = "px-2 pb-1 pt-2 text-xs font-medium text-zinc-400 dark:text-zinc-500";
  const nameText = "min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200";

  // Section index bases.
  const searchOffset = hasQuery ? 1 : 0;
  const pageBase = 0;
  const folderBase = hasQuery ? searchOffset : PAGES.length;
  const shownFolders = hasQuery ? folders : recentFolders;
  const shownFiles = hasQuery ? files : recentFiles;
  const fileBase = folderBase + shownFolders.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 dark:border-zinc-800">
          <Search className="h-5 w-5 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search files & folders —  try  type:pdf  after:2026-06-01  invoice"
            className="w-full bg-transparent py-4 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
          <button
            onClick={() => setShowHelp((v) => !v)}
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
              showHelp
                ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
          >
            Filters
          </button>
        </div>

        {/* Filter help */}
        {showHelp ? (
          <div className="border-b border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
            <p className="px-1 pb-2 text-xs font-medium text-zinc-500">
              Click to add a filter — combine as many as you like
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => insertFilter(f.insert)}
                  className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white dark:hover:bg-zinc-800"
                >
                  <code className="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs font-medium text-indigo-600 dark:bg-zinc-900 dark:text-indigo-300">
                    {f.label}
                  </code>
                  <span className="truncate text-[11px] text-zinc-400">{f.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Results */}
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {hasQuery ? (
            <button
              onMouseEnter={() => setActive(0)}
              onClick={() => chooseItem({ kind: "search" })}
              className={rowClass(0)}
            >
              <Search className="h-5 w-5 shrink-0 text-indigo-500" />
              <span className={nameText}>
                Search all results for <span className="font-medium">“{query.trim()}”</span>
              </span>
              <span className="shrink-0 text-[11px] text-zinc-400">see everything</span>
            </button>
          ) : (
            <ul>
              <li className={heading}>Pages</li>
              {PAGES.map((p, i) => (
                <li key={p.view}>
                  <button
                    onMouseEnter={() => setActive(pageBase + i)}
                    onClick={() => chooseItem({ kind: "page", view: p.view })}
                    className={rowClass(pageBase + i)}
                  >
                    <p.Icon className="h-[18px] w-[18px] shrink-0 text-zinc-400" />
                    <span className={nameText}>{p.label}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {loading && folders.length === 0 && files.length === 0 && hasQuery ? (
            <div className="space-y-1 pt-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : noMatches ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-400">
              No files or folders match — press{" "}
              <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-700 dark:bg-zinc-800">
                ↵
              </kbd>{" "}
              anyway to open the results page.
            </p>
          ) : (
            <>
              {shownFolders.length > 0 ? (
                <ul>
                  <li className={heading}>{hasQuery ? "Folders" : "Recent folders"}</li>
                  {shownFolders.map((folder, i) => (
                    <li key={folder.id}>
                      <button
                        onMouseEnter={() => setActive(folderBase + i)}
                        onClick={() => chooseItem({ kind: "folder", folder })}
                        className={rowClass(folderBase + i)}
                      >
                        <FolderIcon
                          className="h-5 w-5 shrink-0 text-indigo-500"
                          fill={folder.color ?? "none"}
                          style={folder.color ? { color: folder.color } : undefined}
                        />
                        <span className={nameText}>{folder.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {shownFiles.length > 0 ? (
                <ul>
                  <li className={heading}>{hasQuery ? "Files" : "Recent files"}</li>
                  {shownFiles.map((file, i) => (
                    <li key={file.id}>
                      <button
                        onMouseEnter={() => setActive(fileBase + i)}
                        onClick={() => chooseItem({ kind: "file", file })}
                        className={rowClass(fileBase + i)}
                      >
                        {fileIcon(file.mime, file.ext, "h-5 w-5 shrink-0 text-zinc-400")}
                        <span className={nameText}>{file.name}</span>
                        <span className="shrink-0 text-xs text-zinc-400">
                          {humanSize(file.size)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-700 dark:bg-zinc-800">
              ↑
            </kbd>
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-700 dark:bg-zinc-800">
              ↓
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-700 dark:bg-zinc-800">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 dark:border-zinc-700 dark:bg-zinc-800">
              esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
