"use client";

import { ApiError, type FileItem, type FolderItem } from "@byos/api-client";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Database,
  FileText,
  Folder as FolderIcon,
  Loader2,
  Trash2,
} from "lucide-react";
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
      setStatus("Couldn't clear the index. Nothing was removed.");
    } finally {
      setClearing(false);
      refreshStatus();
    }
  };

  const busy = indexing.running;
  const progress = busy || indexing.finishedAt ? indexing : null;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const checkbox = "h-4 w-4 shrink-0 accent-zinc-900";

  const remaining = total - indexedIds.size;
  const coverage = total ? Math.round((indexedIds.size / total) * 100) : 0;
  const allDone = all && total > 0 && remaining === 0;
  const runDisabled =
    busy || !keyHasEmbedding || !statusReady || allDone || (!all && !folderSel.size && !fileSel.size);
  const scopeTab = (on: boolean) =>
    `rounded-full px-3.5 py-1 text-[0.8125rem] transition-colors ${
      on ? "bg-zinc-900 text-[rgb(var(--c-paper))] shadow-sm" : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900"
    }`;

  return (
    <div className="space-y-6">
      {/* Where the drive stands: how much chat can already search. */}
      {!keyHasEmbedding ? (
        <div className="flex items-start gap-3 rounded-2xl bg-[rgb(var(--c-caution-50))] px-4 py-3 text-[0.875rem] leading-[1.5] text-zinc-900 ring-1 ring-inset ring-[rgb(var(--c-caution-300))]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--c-caution-500))]" />
          <span>
            This key has no embedding model, so it can&apos;t index. Edit the key in Model keys and add one,
            like <span className="font-mono text-[0.8125rem]">text-embedding-3-small</span>.
          </span>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="type-label">Searchable in chat</p>
              {statusReady ? (
                <p className="mt-1 text-zinc-900">
                  <span className="font-display text-[2rem] leading-none tabular-nums">{indexedIds.size}</span>
                  <span className="text-[0.9375rem] text-zinc-500"> of {total} files</span>
                </p>
              ) : (
                <div className="mt-2 h-8 w-32 animate-pulse rounded-lg bg-zinc-100" />
              )}
            </div>
            {statusReady && remaining > 0 ? (
              <button
                onClick={() => run({ remaining: true })}
                disabled={busy}
                className="pill-sm-filled inline-flex items-center gap-1.5 disabled:bg-transparent disabled:text-zinc-400 disabled:ring-1 disabled:ring-inset disabled:ring-zinc-200"
              >
                <Database className="h-3.5 w-3.5" /> Index the {remaining} remaining
              </button>
            ) : statusReady && total > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-zinc-700">
                <Check className="h-4 w-4 text-[rgb(var(--c-go-500))]" /> Everything is indexed
              </span>
            ) : null}
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-zinc-900 transition-all duration-500"
              style={{ width: `${busy && progress?.total ? pct : coverage}%` }}
            />
          </div>
          <p className="mt-2 flex justify-between text-[0.75rem] text-zinc-500">
            {busy && progress ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Indexing {progress.done} of {progress.total}
                </span>
                <span className="tabular-nums">{pct}%</span>
              </>
            ) : (
              <>
                <span>{coverage}% of your drive</span>
                {remaining > 0 && statusReady ? <span>{remaining} not yet</span> : null}
              </>
            )}
          </p>
        </div>
      )}

      {/* What to index: everything, or a hand-picked set. */}
      <section className={keyHasEmbedding ? "" : "pointer-events-none opacity-50"}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-label">What to index</h2>
          <div role="tablist" aria-label="What to index" className="inline-flex gap-1 rounded-full bg-zinc-100 p-1">
            <button type="button" role="tab" aria-selected={all} onClick={() => setAll(true)} className={scopeTab(all)}>
              All files
            </button>
            <button type="button" role="tab" aria-selected={!all} onClick={() => setAll(false)} className={scopeTab(!all)}>
              Choose files
            </button>
          </div>
        </div>

        {!all ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {/* Breadcrumb */}
            <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.8125rem] text-zinc-500">
              <button onClick={() => goTo(-1)} className="rounded-md px-1.5 py-0.5 hover:bg-zinc-200/60 hover:text-zinc-900">
                Drive
              </button>
              {path.map((c, i) => (
                <span key={c.id} className="flex items-center gap-0.5">
                  <ChevronRight className="h-3 w-3 text-zinc-400" />
                  <button
                    onClick={() => goTo(i)}
                    className="max-w-[9rem] truncate rounded-md px-1.5 py-0.5 hover:bg-zinc-200/60 hover:text-zinc-900"
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>

            <div className="thin-scroll max-h-72 divide-y divide-zinc-100 overflow-y-auto">
              {folders.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2 text-[0.9375rem] text-zinc-800 hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={folderSel.has(f.id)}
                    onChange={() => toggle(folderSel, f.id, setFolderSel)}
                    className={checkbox}
                    title="Index this whole folder"
                  />
                  <button onClick={() => enterFolder(f)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <FolderIcon className="h-4 w-4 shrink-0 text-zinc-500" />
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
                    className="group flex items-center gap-3 px-3 py-2 text-[0.9375rem] text-zinc-500"
                  >
                    <Check className="h-4 w-4 shrink-0 text-[rgb(var(--c-go-500))]" />
                    <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[0.6875rem] text-zinc-600 group-hover:hidden">
                      Indexed
                    </span>
                    <button
                      onClick={() => void unindexFiles([f.id])}
                      title="Remove from index (free space)"
                      className="hidden shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] text-zinc-600 hover:bg-[rgb(var(--c-danger-50))] hover:text-[rgb(var(--c-danger-600))] group-hover:block"
                      aria-label="Remove from index"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label
                    key={f.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[0.9375rem] text-zinc-800 hover:bg-zinc-50"
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
                <p className="flex items-center gap-2 px-3 py-3 text-[0.8125rem] text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </p>
              ) : folders.length === 0 && files.length === 0 ? (
                <p className="px-3 py-6 text-center text-[0.8125rem] text-zinc-500">This folder is empty.</p>
              ) : null}
            </div>

            {folderSel.size || fileSel.size ? (
              <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.8125rem] text-zinc-600">
                <span>
                  {fileSel.size} file{fileSel.size === 1 ? "" : "s"}, {folderSel.size} folder
                  {folderSel.size === 1 ? "" : "s"} picked
                </span>
                <button
                  onClick={() => {
                    setFileSel(new Set());
                    setFolderSel(new Set());
                  }}
                  className="rounded-md px-1.5 py-0.5 hover:bg-zinc-200/60 hover:text-zinc-900"
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[0.8125rem] leading-[1.5] text-zinc-500">
            Every file in your drive. Files already indexed for this model are skipped, so running it again
            only picks up what&apos;s new.
          </p>
        )}

        <button onClick={() => run()} disabled={runDisabled} className="pill-filled mt-4 flex items-center gap-2 disabled:opacity-50">
          {busy || (keyHasEmbedding && !statusReady) ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy
            ? "Indexing…"
            : keyHasEmbedding && !statusReady
              ? "Checking…"
              : allDone
                ? "All files indexed"
                : all
                  ? "Index all files"
                  : "Index picked files"}
        </button>
      </section>

      {status ? <p className="text-[0.8125rem] text-zinc-500">{status}</p> : null}

      {/* A file that couldn't be embedded stays unsearchable, so name it and say
          why instead of just leaving the "indexed" count short. */}
      {indexing.skipped.length ? (
        <div className="rounded-2xl bg-[rgb(var(--c-caution-50))] px-4 py-3 ring-1 ring-inset ring-[rgb(var(--c-caution-300))]">
          <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-zinc-900">
            <AlertTriangle className="h-3.5 w-3.5 text-[rgb(var(--c-caution-500))]" />
            {indexing.skipped.length} file{indexing.skipped.length === 1 ? "" : "s"} skipped
          </p>
          <ul className="thin-scroll mt-1.5 max-h-32 space-y-0.5 overflow-y-auto">
            {indexing.skipped.map((sk, i) => (
              <li key={i} className="text-[0.75rem] leading-snug text-zinc-600">
                {sk}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {indexing.error ? (
        <p className="rounded-2xl bg-[rgb(var(--c-danger-50))] px-4 py-3 text-[0.8125rem] text-[rgb(var(--c-danger-600))] ring-1 ring-inset ring-[rgb(var(--c-danger-300))]">
          {indexing.error}
        </p>
      ) : null}

      {/* Free up space — always visible once anything is indexed. */}
      {statusReady && indexedIds.size > 0 ? (
        // The label wraps and the buttons don't: without min-w-0 on the text and
        // shrink-0 on the actions, flex squeezes "Confirm clear" onto two lines.
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 px-4 py-3">
          <span className="min-w-0 flex-1 text-[0.8125rem] leading-[1.45] text-zinc-500">
            <span className="block text-zinc-900">Clear the index</span>
            Frees the space embeddings take. You can index again any time.
          </span>
          {confirmClear ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[0.8125rem]">
              <button
                onClick={() => void clearAll()}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[rgb(var(--c-danger-600))] px-3 py-1.5 font-medium text-[rgb(var(--c-paper))] transition hover:opacity-90"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" /> Clear {indexedIds.size}
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="whitespace-nowrap rounded-full px-2.5 py-1.5 text-zinc-500 transition hover:text-zinc-900"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              disabled={clearing}
              className="pill-sm-ghost inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap hover:!border-[rgb(var(--c-danger-600))] hover:!text-[rgb(var(--c-danger-600))] disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              {clearing ? "Clearing…" : "Clear index"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
