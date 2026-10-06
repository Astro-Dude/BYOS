"use client";

import { type FileItem, type FolderItem } from "@byos/api-client";
import {
  ArrowRight,
  CalendarDays,
  Code2,
  Copy,
  CornerDownLeft,
  FileText,
  FileWarning,
  Folder as FolderIcon,
  HardDrive,
  Image as ImageIcon,
  Link2,
  Scale,
  Search,
  SearchX,
  SlidersHorizontal,
  Star,
  Tag,
  X,
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
  { view: "duplicates", label: "Duplicates", Icon: Copy },
  { view: "missing", label: "Missing", Icon: FileWarning },
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

/** The filters most people want, one tap away under the search box. */
const QUICK: { insert: string; label: string; Icon: typeof HardDrive }[] = [
  { insert: "type:pdf", label: "PDFs", Icon: FileText },
  { insert: "type:image", label: "Images", Icon: ImageIcon },
  { insert: "is:starred", label: "Starred", Icon: Star },
  { insert: "tag:", label: "Tag", Icon: Tag },
  { insert: "in:", label: "In folder", Icon: FolderIcon },
  { insert: "size:>", label: "Size", Icon: Scale },
  { insert: "after:", label: "Date", Icon: CalendarDays },
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
  const listRef = useRef<HTMLDivElement>(null);

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

  // Arrow keys move the highlight; keep it in view as it goes.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const insertFilter = (insert: string) => {
    setQuery((q) => `${q.trimEnd()} ${insert}`.trimStart());
    inputRef.current?.focus();
  };

  const noMatches = hasQuery && !loading && searched && folders.length === 0 && files.length === 0;

  if (!open) return null;

  // Words to highlight in names: the query without its filters (type:pdf …).
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((w) => w && !w.includes(":"))
    .map((w) => w.toLowerCase());

  const rowClass = (i: number) =>
    `group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
      i === active ? "bg-zinc-900/[0.07]" : "hover:bg-zinc-900/[0.04]"
    }`;
  const heading = "px-2.5 pb-1.5 pt-3 text-[0.75rem] font-medium uppercase tracking-[0.08em] text-zinc-400";
  const nameText = "min-w-0 flex-1 truncate text-[0.9375rem] text-zinc-900";
  const tile = "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900/[0.05]";

  // Section index bases.
  const searchOffset = hasQuery ? 1 : 0;
  const pageBase = 0;
  const folderBase = hasQuery ? searchOffset : PAGES.length;
  const shownFolders = hasQuery ? folders : recentFolders;
  const shownFiles = hasQuery ? files : recentFiles;
  const fileBase = folderBase + shownFolders.length;

  return (
    <div className="modal-scrim z-[130] items-stretch p-0 sm:items-start sm:px-4 sm:pt-[10vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Search"
        // Phones: a solid full screen (glass over the whole page reads as noise).
        // Wider: a floating glass window.
        className="glass-panel flex h-dvh w-full flex-col overflow-hidden rounded-none max-sm:!border-0 max-sm:![background:rgb(var(--c-paper))] max-sm:![backdrop-filter:none] max-sm:![box-shadow:none] sm:h-auto sm:max-h-[78vh] sm:max-w-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-3 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-4 sm:pt-4">
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-zinc-900/[0.05] px-3.5 transition-colors focus-within:bg-zinc-900/[0.07]">
            <Search className="h-5 w-5 shrink-0 text-zinc-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search your drive"
              enterKeyHint="search"
              className="w-full min-w-0 bg-transparent py-3 text-[1rem] text-zinc-900 outline-none placeholder:text-zinc-400"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900/10 text-zinc-600 hover:bg-zinc-900/20"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="hidden shrink-0 rounded-md border border-zinc-900/10 px-1.5 py-0.5 text-[0.6875rem] text-zinc-500 sm:block">
                esc
              </kbd>
            )}
          </label>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-1.5 text-[0.9375rem] font-medium text-zinc-900 sm:hidden"
          >
            Cancel
          </button>
        </div>

        {/* Quick filters: tap to add; "All filters" explains every one. */}
        <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 pb-2.5 sm:flex-wrap sm:overflow-visible sm:px-4">
          {QUICK.map((f) => (
            <button
              key={f.insert}
              type="button"
              onClick={() => insertFilter(f.insert)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-900/10 px-3 py-1 text-[0.8125rem] text-zinc-700 transition-colors hover:border-zinc-900/30 hover:text-zinc-900"
            >
              <f.Icon className="h-3.5 w-3.5" /> {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] transition-colors ${
              showHelp ? "bg-zinc-900 text-[rgb(var(--c-paper))]" : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> All filters
          </button>
        </div>

        {/* Filter help */}
        {showHelp ? (
          <div className="mx-3 mb-2 shrink-0 rounded-2xl bg-zinc-900/[0.04] p-2 sm:mx-4">
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              {FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => insertFilter(f.insert)}
                  className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-900/[0.05]"
                >
                  <code className="shrink-0 font-mono text-[0.8125rem] font-medium text-zinc-900">{f.label}</code>
                  <span className="truncate text-[0.75rem] text-zinc-500">{f.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Results */}
        <div
          ref={listRef}
          className="thin-scroll min-h-0 flex-1 overflow-y-auto border-t border-zinc-900/[0.06] px-2 pb-3 pt-1 sm:max-h-[52vh]"
        >
          {hasQuery ? (
            <button
              data-index={0}
              onMouseEnter={() => setActive(0)}
              onClick={() => chooseItem({ kind: "search" })}
              className={`${rowClass(0)} mt-1`}
            >
              <span className={`${tile} bg-zinc-900 text-[rgb(var(--c-paper))]`}>
                <Search className="h-4 w-4" />
              </span>
              <span className={nameText}>
                See all results for <span className="font-medium">“{query.trim()}”</span>
              </span>
              <CornerDownLeft className="hidden h-3.5 w-3.5 shrink-0 text-zinc-400 sm:block" />
            </button>
          ) : (
            <>
              <p className={heading}>Go to</p>
              <div className="grid grid-cols-2 gap-1.5 px-1 sm:grid-cols-3">
                {PAGES.map((p, i) => (
                  <button
                    key={p.view}
                    data-index={pageBase + i}
                    onMouseEnter={() => setActive(pageBase + i)}
                    onClick={() => chooseItem({ kind: "page", view: p.view })}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[0.875rem] transition-colors ${
                      pageBase + i === active
                        ? "border-zinc-900/20 bg-zinc-900/[0.07] text-zinc-900"
                        : "border-zinc-900/[0.06] text-zinc-700 hover:bg-zinc-900/[0.04]"
                    }`}
                  >
                    <p.Icon className="h-4 w-4 shrink-0 text-zinc-500" />
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {loading && folders.length === 0 && files.length === 0 && hasQuery ? (
            <div className="space-y-1.5 px-1 pt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-xl" />
              ))}
            </div>
          ) : noMatches ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900/[0.05] text-zinc-500">
                <SearchX className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[0.9375rem] font-medium text-zinc-900">No quick matches</p>
              <p className="mt-1 max-w-xs text-[0.8125rem] leading-[1.5] text-zinc-500">
                Try fewer words, or a filter like <span className="font-mono">type:pdf</span>. The full search
                looks inside more.
              </p>
              <button
                type="button"
                onClick={() => chooseItem({ kind: "search" })}
                className="pill-sm-filled mt-4 inline-flex items-center gap-1.5"
              >
                See all results <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              {shownFolders.length > 0 ? (
                <ul>
                  <li className={heading}>{hasQuery ? "Folders" : "Recent folders"}</li>
                  {shownFolders.map((folder, i) => (
                    <li key={folder.id}>
                      <button
                        data-index={folderBase + i}
                        onMouseEnter={() => setActive(folderBase + i)}
                        onClick={() => chooseItem({ kind: "folder", folder })}
                        className={rowClass(folderBase + i)}
                      >
                        <span className={tile}>
                          <FolderIcon
                            className="h-[18px] w-[18px] text-zinc-800"
                            fill={folder.color ?? "none"}
                            style={folder.color ? { color: folder.color } : undefined}
                          />
                        </span>
                        <span className={nameText}>
                          <Highlight text={folder.name} terms={terms} />
                        </span>
                        <span className="hidden shrink-0 text-[0.75rem] text-zinc-400 sm:inline">Folder</span>
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
                        data-index={fileBase + i}
                        onMouseEnter={() => setActive(fileBase + i)}
                        onClick={() => chooseItem({ kind: "file", file })}
                        className={rowClass(fileBase + i)}
                      >
                        <span className={tile}>{fileIcon(file.mime, file.ext, "h-[18px] w-[18px] text-zinc-600")}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.9375rem] text-zinc-900">
                            <Highlight text={file.name} terms={terms} />
                          </span>
                          <span className="block truncate text-[0.75rem] text-zinc-500">
                            {humanSize(file.size)} ·{" "}
                            {new Date(file.modified_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        </span>
                        {file.is_favorite ? <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!hasQuery && !shownFolders.length && !shownFiles.length ? (
                <p className="px-3 pb-2 pt-4 text-[0.8125rem] text-zinc-500">
                  Files and folders you open show up here, so you can get back to them quickly.
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* Keyboard hints: laptops only. */}
        <div className="hidden shrink-0 items-center gap-4 border-t border-zinc-900/[0.06] px-4 py-2 text-[0.6875rem] text-zinc-500 sm:flex">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-900/10 px-1">↑</kbd>
            <kbd className="rounded border border-zinc-900/10 px-1">↓</kbd>
            move
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-900/10 px-1">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-900/10 px-1">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}

/** A name with the searched words picked out. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return (
    <>
      {text.split(re).map((part, i) =>
        terms.includes(part.toLowerCase()) ? (
          <mark key={i} className="rounded-sm bg-[rgb(var(--c-caution-300)/0.45)] px-px text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
