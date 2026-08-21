"use client";

import { ApiError, type FileItem, type FolderItem } from "@byos/api-client";
import { Check, ChevronRight, FileText, Folder as FolderIcon, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useIndexing } from "@/lib/indexing";

type Crumb = { id: string; name: string };

/** Pick files/folders (or all) and embed them for drive-wide RAG. Browse into
 *  folders to check individual files. Requires a key with an embedding model. */
export function IndexPanel({ keyId, keyHasEmbedding }: { keyId: string; keyHasEmbedding: boolean }) {
  const authed = useAuthed();
  // The run itself lives in IndexingProvider, above this modal — closing the
  // modal used to tear the stream down mid-index.
  const indexing = useIndexing();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [path, setPath] = useState<Crumb[]>([]);
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(true);
  const [folderSel, setFolderSel] = useState<Set<string>>(new Set());
  const [fileSel, setFileSel] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [indexedIds, setIndexedIds] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [statusReady, setStatusReady] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Which files are already embedded for THIS key's embedding model — indexing
  // is per-model, so status is refetched whenever the key changes. `statusReady`
  // gates the UI so the Index button never flashes enabled before we know.
  const refreshStatus = useCallback(() => {
    setConfirmClear(false);
    if (!keyHasEmbedding) {
      setIndexedIds(new Set());
      setTotal(0);
      setStatusReady(true);
      return;
    }
    setStatusReady(false);
    authed((t) => api.indexStatus(t, keyId))
      .then((s) => {
        setIndexedIds(new Set(s.indexed_file_ids));
        setTotal(s.total);
      })
      .catch(() => undefined)
      .finally(() => setStatusReady(true));
  }, [authed, keyId, keyHasEmbedding]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authed((t) =>
      Promise.all([api.listFolders(t, cwd ?? undefined), api.listFiles(t, cwd ?? undefined)]),
    )
      .then(([fo, fi]) => {
        if (cancelled) return;
        setFolders(fo);
        setFiles(fi);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, cwd]);

  const enterFolder = (f: FolderItem) => {
    setPath((p) => [...p, { id: f.id, name: f.name }]);
    setCwd(f.id);
  };
  const goTo = (index: number) => {
    // index -1 = root; otherwise navigate to path[index]
    setPath((p) => p.slice(0, index + 1));
    setCwd(index < 0 ? null : (path[index]?.id ?? null));
  };

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    apply(n);
  };

  const run = (override?: { all?: boolean; remaining?: boolean }) => {
    setStatus(null);
    if (override?.remaining) {
      // Filtered server-side: the panel only knows the files in the folder it's
      // browsing, but "index remaining" is a drive-wide action.
      indexing.start({ keyId, all: true, remaining: true });
      return;
    }
    const useAll = override?.all ?? all;
    indexing.start({
      keyId,
      all: useAll,
      folderIds: useAll ? [] : [...folderSel],
      fileIds: useAll ? [] : [...fileSel],
    });
  };

  // A run that ended (here or after the modal was closed) means the embedded set
  // changed, so pull fresh status and drop the now-stale selection.
  useEffect(() => {
    if (!indexing.finishedAt) return;
    setFileSel(new Set());
    setFolderSel(new Set());
    refreshStatus();
  }, [indexing.finishedAt, refreshStatus]);

  const unindexFiles = async (ids: string[]) => {
    setStatus(null);
    try {
      await authed((t) => api.unindex(t, { fileIds: ids }));
    } catch {
      setStatus("Couldn't remove those embeddings.");
    } finally {
      refreshStatus();
    }
  };
  const clearAll = async () => {
    setConfirmClear(false);
    setClearing(true);
    setStatus(null);
    try {
      const { removed } = await authed((t) => api.unindex(t, { all: true }));
      // Reflect it immediately; refreshStatus then confirms against the server.
      setIndexedIds(new Set());
      setStatus(`Cleared ${removed} embedded chunk${removed === 1 ? "" : "s"}.`);
    } catch {
      setStatus("Couldn't clear the index — nothing was removed.");
    } finally {
      setClearing(false);
      refreshStatus();
    }
  };

  const busy = indexing.running;
  const progress = busy || indexing.finishedAt ? indexing : null;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const checkbox = "h-4 w-4 shrink-0 accent-zinc-900";

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[0.9375rem] font-medium text-zinc-900">Index for drive-wide chat</h3>
        <p className="text-[0.8125rem] text-zinc-500">
          Embed files so you can chat across them. Choose what to include.
        </p>
      </div>

      {!keyHasEmbedding ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[0.8125rem] text-amber-300">
          The selected key has no embedding model — set one (e.g. text-embedding-3-small) to index.
        </p>
      ) : statusReady && total > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-[0.8125rem]">
          <span className="text-zinc-700">
            {indexedIds.size} of {total} files indexed
            {total - indexedIds.size > 0 ? (
              <span className="text-zinc-500"> · {total - indexedIds.size} remaining</span>
            ) : (
              <span className="text-emerald-400"> · all done</span>
            )}
          </span>
          {total - indexedIds.size > 0 ? (
            <button
              onClick={() => run({ remaining: true })}
              disabled={busy}
              className="pill-sm-filled disabled:bg-transparent disabled:text-zinc-400 disabled:ring-1 disabled:ring-inset disabled:ring-zinc-200"
            >
              Index remaining
            </button>
          ) : null}
        </div>
      ) : null}

      <label className="flex cursor-pointer items-center gap-2 text-[0.9375rem] text-zinc-800">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
          className={checkbox}
        />
        All files
      </label>

      {!all ? (
        <div className="rounded-lg border border-zinc-200">
          {/* Breadcrumb */}
          <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 px-2 py-1.5 text-[0.8125rem] text-zinc-500">
            <button onClick={() => goTo(-1)} className="rounded px-1.5 py-0.5 hover:bg-zinc-100">
              Drive
            </button>
            {path.map((c, i) => (
              <span key={c.id} className="flex items-center gap-0.5">
                <ChevronRight className="h-3 w-3 text-zinc-400" />
                <button
                  onClick={() => goTo(i)}
                  className="max-w-[9rem] truncate rounded px-1.5 py-0.5 hover:bg-zinc-100"
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>

          <div className="thin-scroll max-h-56 space-y-1 overflow-y-auto p-2">
            {folders.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-[0.9375rem] text-zinc-700 hover:bg-zinc-100"
              >
                <input
                  type="checkbox"
                  checked={folderSel.has(f.id)}
                  onChange={() => toggle(folderSel, f.id, setFolderSel)}
                  className={checkbox}
                  title="Index this whole folder"
                />
                <button
                  onClick={() => enterFolder(f)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <FolderIcon className="h-4 w-4 shrink-0 text-zinc-600" />
                  <span className="truncate">{f.name}</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" />
                </button>
              </div>
            ))}
            {files.map((f) =>
              indexedIds.has(f.id) ? (
                <div
                  key={f.id}
                  title="Already indexed for this model"
                  className="group flex items-center gap-2 rounded px-1.5 py-1 text-[0.9375rem] text-zinc-500"
                >
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate line-through decoration-zinc-700">
                    {f.name}
                  </span>
                  <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-emerald-500/80 group-hover:hidden">
                    Indexed
                  </span>
                  <button
                    onClick={() => void unindexFiles([f.id])}
                    title="Remove from index (free space)"
                    className="hidden shrink-0 text-zinc-500 hover:text-red-400 group-hover:block"
                    aria-label="Remove from index"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[0.9375rem] text-zinc-700 hover:bg-zinc-100"
                >
                  <input
                    type="checkbox"
                    checked={fileSel.has(f.id)}
                    onChange={() => toggle(fileSel, f.id, setFileSel)}
                    className={checkbox}
                  />
                  <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="truncate">{f.name}</span>
                </label>
              ),
            )}
            {loading ? (
              <p className="flex items-center gap-2 px-1.5 py-1 text-[0.8125rem] text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : folders.length === 0 && files.length === 0 ? (
              <p className="px-1.5 py-1 text-[0.8125rem] text-zinc-500">This folder is empty.</p>
            ) : null}
          </div>

          {folderSel.size || fileSel.size ? (
            <div className="flex items-center justify-between border-t border-zinc-200 px-2 py-1.5 text-[0.8125rem] text-zinc-500">
              <span>
                {fileSel.size} file{fileSel.size === 1 ? "" : "s"}, {folderSel.size} folder
                {folderSel.size === 1 ? "" : "s"} selected
              </span>
              <button
                onClick={() => {
                  setFileSel(new Set());
                  setFolderSel(new Set());
                }}
                className="rounded px-1.5 py-0.5 hover:bg-zinc-100 hover:text-zinc-800"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {(() => {
        const remaining = total - indexedIds.size;
        const allDone = all && total > 0 && remaining === 0;
        const disabled =
          busy ||
          !keyHasEmbedding ||
          !statusReady ||
          allDone ||
          (!all && !folderSel.size && !fileSel.size);
        return (
          <button
            onClick={() => run()}
            disabled={disabled}
            className="flex items-center gap-2 pill-filled disabled:opacity-50"
          >
            {busy || (keyHasEmbedding && !statusReady) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {busy
              ? "Indexing…"
              : keyHasEmbedding && !statusReady
                ? "Checking…"
                : allDone
                  ? "All files indexed"
                  : all
                    ? "Index all files"
                    : "Index selected"}
          </button>
        );
      })()}

      {progress ? (
        <div>
          <div className="mb-1 flex justify-between text-[0.8125rem] text-zinc-500">
            <span>
              {progress.done}/{progress.total} files
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-zinc-900 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}
      {status ? <p className="text-[0.8125rem] text-zinc-500">{status}</p> : null}

      {/* A file that couldn't be embedded stays unsearchable, so name it and say
          why instead of just leaving the "indexed" count short. */}
      {indexing.skipped.length ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-[0.8125rem] font-medium text-amber-600">
            {indexing.skipped.length} file{indexing.skipped.length === 1 ? "" : "s"} skipped
          </p>
          <ul className="thin-scroll mt-1 max-h-32 space-y-0.5 overflow-y-auto">
            {indexing.skipped.map((sk, i) => (
              <li key={i} className="text-[0.7rem] leading-snug text-zinc-500">
                {sk}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {indexing.error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[0.8125rem] text-red-500">
          {indexing.error}
        </p>
      ) : null}

      {/* Free up space — always visible once anything is indexed. */}
      {statusReady && indexedIds.size > 0 ? (
        // The label wraps and the buttons don't: without min-w-0 on the text and
        // shrink-0 on the actions, flex squeezes "Confirm clear" onto two lines.
        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-3">
          <span className="min-w-0 flex-1 text-[0.8125rem] text-zinc-500">
            Free space by removing embeddings (re-index anytime).
          </span>
          {confirmClear ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[0.8125rem]">
              <button
                onClick={() => void clearAll()}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-red-600 px-2.5 py-1.5 font-medium text-white transition hover:bg-red-500"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" /> Confirm
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="whitespace-nowrap rounded-md px-2 py-1.5 text-zinc-500 transition hover:text-zinc-800"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={clearing}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-200 px-2.5 py-1.5 text-[0.8125rem] text-zinc-700 transition hover:border-red-400/40 hover:text-red-400 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              {clearing ? "Clearing…" : `Clear index (${indexedIds.size})`}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
