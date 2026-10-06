"use client";

import { ApiError, type AliasItem } from "@byos/api-client";
import { Check, Copy, ExternalLink, Folder, Link2, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { fileIcon } from "@/components/dashboard/file-icon";
import { ViewEmpty, ViewHeader } from "@/components/dashboard/view-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

type Filter = "all" | "file" | "folder";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Every permanent link: what it points at, copy and open it, jump to the file,
 *  or retire it. Replacing a file keeps its link, so these never go stale. */
export function AliasesPanel({
  refreshKey,
  onOpenLocation,
}: {
  refreshKey: number;
  onOpenLocation: (folderId: string | null) => void;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const { user } = useAuth();
  const username = user?.username ?? "";
  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [deleting, setDeleting] = useState<AliasItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAliases(await authed((t) => api.listAliases(t)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const remove = async (alias: AliasItem) => {
    setDeleting(null);
    setAliases((prev) => prev.filter((a) => a.id !== alias.id)); // optimistic
    try {
      await authed((t) => api.deleteAlias(t, alias.id));
      toast("Link deleted");
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Delete failed", "error");
      void load();
    }
  };

  const linkUrl = (alias: AliasItem) =>
    alias.target_type === "folder"
      ? `${window.location.origin}/${username}/${alias.slug}` // browsable web page
      : api.aliasUrl(username, alias.slug); // API streams the file

  const copy = async (alias: AliasItem) => {
    await navigator.clipboard.writeText(linkUrl(alias));
    setCopied(alias.id);
    toast("Link copied");
    setTimeout(() => setCopied(null), 1500);
  };

  const counts = useMemo(
    () => ({
      file: aliases.filter((a) => a.target_type === "file").length,
      folder: aliases.filter((a) => a.target_type === "folder").length,
    }),
    [aliases],
  );
  const shown = aliases.filter((a) => {
    if (filter !== "all" && a.target_type !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || a.slug.toLowerCase().includes(q) || (a.target_name ?? "").toLowerCase().includes(q);
  });

  const tab = (on: boolean) =>
    `rounded-full px-3 py-1 text-[0.8125rem] transition-colors ${
      on ? "bg-zinc-900 text-[rgb(var(--c-paper))] shadow-sm" : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900"
    }`;

  return (
    <div>
      <ViewHeader
        label="Public"
        title="Links"
        description="Permanent links to your files and folders. Replace a file and its link serves the new version, so nothing you've shared ever breaks."
        stats={
          aliases.length
            ? [
                { value: aliases.length, label: aliases.length === 1 ? "link" : "links" },
                { value: counts.file, label: counts.file === 1 ? "file shared" : "files shared" },
                { value: counts.folder, label: counts.folder === 1 ? "folder shared" : "folders shared" },
              ]
            : undefined
        }
      />

      {error ? <p className="mb-4 text-[0.9375rem] text-red-600">{error}</p> : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[4.25rem] w-full rounded-2xl" />
          ))}
        </div>
      ) : aliases.length === 0 ? (
        <ViewEmpty
          icon={<Link2 className="h-6 w-6" />}
          title="No links yet"
          body={
            <>
              Open a file or folder&apos;s menu in your drive and choose <strong className="font-medium text-zinc-700">Share</strong>{" "}
              to give it a permanent link like <span className="font-mono text-[0.8125rem]">/{username || "you"}/notes</span>.
            </>
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-2 transition-colors focus-within:border-zinc-900">
              <Search className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a link or file"
                className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-zinc-900 outline-none placeholder:text-zinc-400"
              />
            </label>
            <div role="tablist" aria-label="Show" className="inline-flex gap-1 rounded-full bg-zinc-100 p-1">
              {(
                [
                  ["all", `All ${aliases.length}`],
                  ["file", `Files ${counts.file}`],
                  ["folder", `Folders ${counts.folder}`],
                ] as const
              ).map(([v, text]) => (
                <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={tab(filter === v)}>
                  {text}
                </button>
              ))}
            </div>
          </div>

          <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {shown.map((alias) => {
              const folder = alias.target_type === "folder";
              const ext = alias.target_name?.split(".").pop() ?? null;
              return (
                <li
                  key={alias.id}
                  className="group flex flex-col gap-3 border-b border-zinc-200 px-4 py-3.5 last:border-b-0 hover:bg-zinc-50 sm:flex-row sm:items-center"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
                    {folder ? <Folder className="h-5 w-5 text-zinc-500" /> : fileIcon(null, ext)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-baseline gap-0.5 font-mono text-[0.875rem]">
                      <span className="shrink-0 text-zinc-400">/{username}/</span>
                      <span className="truncate font-medium text-zinc-900">{alias.slug}</span>
                    </p>
                    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-zinc-500">
                      <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-px text-[0.6875rem] text-zinc-600">
                        {folder ? "Folder" : "File"}
                      </span>
                      {alias.target_name ? (
                        <button
                          onClick={() => onOpenLocation(alias.parent_folder_id)}
                          className="min-w-0 truncate text-left hover:text-zinc-900 hover:underline"
                          title={folder ? "Open folder" : "Go to file location"}
                        >
                          {alias.target_name}
                        </button>
                      ) : (
                        <span className="italic text-zinc-400">Target removed</span>
                      )}
                      <span className="hidden shrink-0 text-zinc-400 sm:inline">· {day(alias.created_at)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => void copy(alias)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                        copied === alias.id
                          ? "bg-zinc-900 text-[rgb(var(--c-paper))]"
                          : "border border-zinc-200 text-zinc-800 hover:border-zinc-900"
                      }`}
                    >
                      {copied === alias.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === alias.id ? "Copied" : "Copy link"}
                    </button>
                    <a
                      href={linkUrl(alias)}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-icon-sm"
                      title="Open link"
                      aria-label="Open link"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => setDeleting(alias)}
                      className="btn-icon-sm hover:!bg-[rgb(var(--c-danger-50))] hover:!text-[rgb(var(--c-danger-600))]"
                      title="Delete link"
                      aria-label="Delete link"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
            {shown.length === 0 ? (
              <li className="px-4 py-10 text-center text-[0.875rem] text-zinc-500">No links match.</li>
            ) : null}
          </ul>
        </>
      )}

      {deleting ? (
        <ConfirmModal
          title="Delete this link?"
          message={`/${username}/${deleting.slug} will stop working for anyone who has it. The ${deleting.target_type} itself stays.`}
          confirmLabel="Delete link"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </div>
  );
}
