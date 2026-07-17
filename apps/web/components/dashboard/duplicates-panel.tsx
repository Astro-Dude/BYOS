"use client";

import { ApiError, type DuplicateGroup, type FileItem } from "@byos/api-client";
import { ChevronRight, FileText, Loader2, Trash2, X } from "lucide-react";
import { type UIEvent, useCallback, useEffect, useRef, useState } from "react";

import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

type Kind = "image" | "text" | "pdf" | "other";

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "py", "csv", "log", "yaml", "yml",
  "html", "css", "xml", "sql", "sh",
]);

function kindOf(file: FileItem): Kind {
  const mime = (file.mime ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || mime === "application/json" || mime.includes("xml")) return "text";
  return TEXT_EXT.has((file.ext ?? "").toLowerCase()) ? "text" : "other";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// Render a PDF blob's pages to image data-URLs (client-only, via pdf.js) so they
// live in our DOM and can be scroll-synced. Capped to keep it light.
async function renderPdf(blob: Blob, maxPages = 15): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const out: string[] = [];
  const count = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= count; i += 1) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 700 / base.width }); // ~700px wide
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    out.push(canvas.toDataURL("image/png"));
  }
  return out;
}

/** All copies of one duplicate group, side by side. Content is byte-identical,
 *  so the preview is fetched/rendered once and shown in every column; the panes
 *  scroll in lockstep (VS Code diff style). */
function DuplicateGroupView({
  group,
  onDelete,
  selected,
  onToggleSelect,
}: {
  group: DuplicateGroup;
  onDelete: (file: FileItem) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const authed = useAuthed();
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const kind = group.files[0] ? kindOf(group.files[0]) : "other";
  const scrollers = useRef<Array<HTMLDivElement | null>>([]);
  const syncing = useRef(false);

  const onScroll = (i: number) => (e: UIEvent<HTMLDivElement>) => {
    if (syncing.current) return;
    syncing.current = true;
    const src = e.currentTarget;
    scrollers.current.forEach((el, j) => {
      if (el && j !== i) {
        el.scrollTop = src.scrollTop;
        el.scrollLeft = src.scrollLeft;
      }
    });
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const rep = group.files[0];
    (async () => {
      const entries = await Promise.all(
        group.files.map(async (f) => {
          if (!f.folder_id) return [f.id, "My Drive"] as const;
          try {
            const crumbs = await authed((t) => api.folderBreadcrumb(t, f.folder_id!));
            return [f.id, `My Drive / ${crumbs.map((c) => c.name).join(" / ")}`] as const;
          } catch {
            return [f.id, "—"] as const;
          }
        }),
      );
      if (!cancelled) setPaths(Object.fromEntries(entries));

      if (rep && kind !== "other") {
        try {
          const blob = await authed((t) => api.downloadBlob(t, rep.id));
          if (cancelled) return;
          if (kind === "text") setText((await blob.text()).slice(0, 50_000));
          else if (kind === "pdf") setPdfPages(await renderPdf(blob));
          else {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        } catch {
          /* preview unavailable — cards still show metadata */
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authed, group, kind]);

  const body = loading ? (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
    </div>
  ) : kind === "image" && url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="preview" className="w-full" />
  ) : kind === "pdf" && pdfPages?.length ? (
    <div className="space-y-1 bg-zinc-100 p-1 dark:bg-zinc-800">
      {pdfPages.map((src, p) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={p} src={src} alt={`page ${p + 1}`} className="block w-full bg-white shadow-sm" />
      ))}
    </div>
  ) : kind === "text" && text != null ? (
    <pre className="whitespace-pre-wrap p-2 text-[0.65rem] leading-snug text-zinc-500">{text}</pre>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-zinc-400">
      <FileText className="h-8 w-8" />
      <span className="text-[0.65rem] uppercase">{group.files[0]?.ext || kind}</span>
    </div>
  );

  return (
    <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
      {group.files.map((f, i) => (
        <div
          key={f.id}
          className={`relative flex w-64 shrink-0 flex-col gap-2 rounded-lg border p-2.5 ${
            selected.has(f.id)
              ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-500/50 dark:bg-indigo-500/10"
              : "border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/40"
          }`}
        >
          <input
            type="checkbox"
            checked={selected.has(f.id)}
            onChange={() => onToggleSelect(f.id)}
            className="absolute left-3.5 top-3.5 z-10 h-4 w-4 accent-indigo-600"
            title="Select for bulk delete"
          />
          <div
            ref={(el) => {
              scrollers.current[i] = el;
            }}
            onScroll={onScroll(i)}
            className="h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          >
            {body}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200" title={f.name}>
              {f.name}
            </p>
            <p className="truncate text-xs text-zinc-500" title={paths[f.id]}>
              {paths[f.id] ?? "…"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {formatBytes(f.size)} · {new Date(f.modified_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={() => onDelete(f)}
            className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete this copy
          </button>
        </div>
      ))}
    </div>
  );
}

export function DuplicatesPanel({ scrolled = false }: { scrolled?: boolean }) {
  const authed = useAuthed();
  const toast = useToast();
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<FileItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDuplicates(await authed((t) => api.listDuplicates(t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (hash: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(hash)) n.delete(hash);
      else n.add(hash);
      return n;
    });

  // Drop the given ids from state in place; a group with <2 copies is no longer
  // a duplicate and disappears.
  const dropLocal = (ids: Set<string>) =>
    setDuplicates((prev) =>
      prev
        .map((g) => ({ ...g, files: g.files.filter((f) => !ids.has(f.id)) }))
        .filter((g) => g.files.length > 1),
    );

  const remove = async (file: FileItem) => {
    setConfirmDel(null);
    try {
      await authed((t) => api.deleteFile(t, file.id));
      toast("Copy deleted");
      dropLocal(new Set([file.id]));
    } catch {
      toast("Couldn't delete file", "error");
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const removeSelected = async () => {
    setConfirmBulk(false);
    const ids = [...selected];
    setSelected(new Set());
    dropLocal(new Set(ids)); // optimistic
    try {
      await Promise.all(ids.map((id) => authed((t) => api.deleteFile(t, id))));
      toast(`Deleted ${ids.length} ${ids.length === 1 ? "copy" : "copies"}`);
    } catch {
      toast("Some copies couldn't be deleted", "error");
      void load(); // resync only if something failed
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h1 className="text-2xl font-normal text-zinc-800 dark:text-zinc-200">Duplicates</h1>
        <p className="text-sm text-zinc-500">
          Files with identical content, grouped by hash. Expand a group to compare copies (they
          scroll together) before deleting.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {selected.size > 0 ? (
        <div
          className={`sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 px-4 py-2.5 text-sm backdrop-blur transition-colors dark:border-indigo-500/30 ${
            scrolled
              ? "bg-indigo-100/95 shadow-sm dark:bg-indigo-900/95"
              : "bg-indigo-50/80 dark:bg-indigo-500/10"
          }`}
        >
          <span className="font-medium text-indigo-800 dark:text-indigo-200">
            {selected.size} selected
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setConfirmBulk(true)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-red-600 hover:bg-white dark:hover:bg-zinc-800"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-zinc-500 hover:bg-white dark:hover:bg-zinc-800"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : duplicates.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 p-10 text-center text-sm text-zinc-400 dark:border-zinc-800">
          No duplicates found — nice and tidy.
        </div>
      ) : (
        <ul className="space-y-3">
          {duplicates.map((group) => {
            const open = expanded.has(group.hash);
            return (
              <li
                key={group.hash}
                className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <button
                  onClick={() => toggle(group.hash)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">
                    {group.files[0]?.name}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-zinc-500">
                    {group.files.length} copies
                  </span>
                </button>

                {open ? (
                  <DuplicateGroupView
                    group={group}
                    onDelete={setConfirmDel}
                    selected={selected}
                    onToggleSelect={toggleSelect}
                  />
                ) : (
                  <ul className="mt-1.5 space-y-1 pl-6">
                    {group.files.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate">{file.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {confirmDel ? (
        <ConfirmModal
          title="Delete this copy?"
          message={`“${confirmDel.name}” will be permanently deleted. Other copies stay.`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => void remove(confirmDel)}
        />
      ) : null}

      {confirmBulk ? (
        <ConfirmModal
          title={`Delete ${selected.size} ${selected.size === 1 ? "copy" : "copies"}?`}
          message="The selected copies will be permanently deleted."
          onCancel={() => setConfirmBulk(false)}
          onConfirm={() => void removeSelected()}
        />
      ) : null}
    </div>
  );
}
