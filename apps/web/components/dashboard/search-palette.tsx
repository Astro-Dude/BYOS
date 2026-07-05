"use client";

import { type FileItem, type FolderItem } from "@byos/api-client";
import { CornerDownLeft, Folder as FolderIcon, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fileIcon } from "@/components/dashboard/file-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

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

// Filter operators shown in the help panel. `insert` is appended to the query.
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

type Item =
  | { kind: "folder"; folder: FolderItem }
  | { kind: "file"; file: FileItem };

export function SearchPalette({
  open,
  onClose,
  onOpenFile,
  onOpenFolder,
}: {
  open: boolean;
  onClose: () => void;
  onOpenFile: (file: FileItem) => void;
  onOpenFolder: (folderId: string) => void;
}) {
  const authed = useAuthed();
  const [query, setQuery] = useState("");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flat list backing keyboard navigation (folders first, then files).
  const items = useMemo<Item[]>(
    () => [
      ...folders.map((folder) => ({ kind: "folder" as const, folder })),
      ...files.map((file) => ({ kind: "file" as const, file })),
    ],
    [folders, files],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setFolders([]);
      setFiles([]);
      setSearched(false);
      setActive(0);
      setShowHelp(false);
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
      if (item.kind === "folder") onOpenFolder(item.folder.id);
      else onOpenFile(item.file);
      onClose();
    },
    [onOpenFile, onOpenFolder, onClose],
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

  const empty = query.trim() !== "" && !loading && searched && items.length === 0;

  if (!open) return null;

  const rowClass = (i: number) =>
    `flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${
      i === active ? "bg-indigo-50" : "hover:bg-zinc-50"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4">
          <Search className="h-5 w-5 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search files & folders —  try  type:pdf  after:2026-06-01  invoice"
            className="w-full bg-transparent py-4 text-sm outline-none placeholder:text-zinc-400"
          />
          <button
            onClick={() => setShowHelp((v) => !v)}
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
              showHelp ? "bg-indigo-50 text-indigo-600" : "text-zinc-400 hover:text-zinc-700"
            }`}
          >
            Filters
          </button>
        </div>

        {/* Filter help */}
        {showHelp ? (
          <div className="border-b border-zinc-100 bg-zinc-50/60 p-3">
            <p className="px-1 pb-2 text-xs font-medium text-zinc-500">
              Click to add a filter — combine as many as you like
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => insertFilter(f.insert)}
                  className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white"
                >
                  <code className="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs font-medium text-indigo-600">
                    {f.label}
                  </code>
                  <span className="truncate text-[11px] text-zinc-400">{f.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Results */}
        <div className="max-h-[46vh] overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : empty ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-400">
              Nothing matches “{query.trim()}”.
            </p>
          ) : items.length > 0 ? (
            <div className="p-2">
              {folders.length > 0 ? (
                <ul>
                  <li className="px-2 pb-1 pt-1 text-xs font-medium text-zinc-400">Folders</li>
                  {folders.map((folder, i) => (
                    <li key={folder.id}>
                      <button
                        onMouseEnter={() => setActive(i)}
                        onClick={() => chooseItem({ kind: "folder", folder })}
                        className={rowClass(i)}
                      >
                        <FolderIcon
                          className="h-5 w-5 shrink-0 text-indigo-500"
                          fill={folder.color ?? "none"}
                          style={folder.color ? { color: folder.color } : undefined}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                          {folder.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {files.length > 0 ? (
                <ul>
                  <li className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-400">Files</li>
                  {files.map((file, i) => {
                    const idx = folders.length + i;
                    return (
                      <li key={file.id}>
                        <button
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => chooseItem({ kind: "file", file })}
                          className={rowClass(idx)}
                        >
                          {fileIcon(file.mime, file.ext, "h-5 w-5 shrink-0 text-zinc-400")}
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                            {file.name}
                          </span>
                          <span className="shrink-0 text-xs text-zinc-400">
                            {humanSize(file.size)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-zinc-400">
              Start typing to search, or open <strong>Filters</strong> for operators.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">↑</kbd>
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
