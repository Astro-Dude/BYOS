"use client";

import { ApiError, type PublicFolderView } from "@byos/api-client";
import { ChevronRight, Download, File as FileIcon, Folder } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

function humanSize(bytes: number | null): string {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function SharedFolderPage() {
  const params = useParams<{ username: string; slug: string }>();
  const username = params.username;
  const slug = params.slug;

  const [view, setView] = useState<PublicFolderView | null>(null);
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (fid?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.publicFolderList(username, slug, fid);
        setView(data);
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [username, slug],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meta = await api.publicMeta(username, slug);
        if (cancelled) return;
        if (meta.type === "file") {
          // File links stream directly from the API.
          window.location.replace(api.aliasUrl(username, slug));
          return;
        }
        await load(undefined);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.detail : "Not found");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, slug]);

  const openFolder = (id: string) => {
    setFolderId(id);
    void load(id);
  };

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-10">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Folder className="h-4 w-4 text-indigo-500" />
          <span>Shared folder</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-zinc-900">
          {view?.root_name ?? slug}
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">by @{view?.owner_username ?? username}</p>
      </header>

      {view && view.breadcrumb.length > 0 ? (
        <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-zinc-500">
          {view.breadcrumb.map((c, i) => (
            <span key={c.id ?? "root"} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-zinc-300" /> : null}
              <button
                onClick={() => c.id && openFolder(c.id)}
                className={
                  i === view.breadcrumb.length - 1
                    ? "font-medium text-zinc-900"
                    : "hover:text-zinc-800 hover:underline"
                }
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          {error}
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100" />
          ))}
        </div>
      ) : view && view.folders.length === 0 && view.files.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 p-10 text-center text-sm text-zinc-500">
          This folder is empty.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {view?.folders.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => openFolder(f.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50"
              >
                <Folder className="h-5 w-5 shrink-0 text-indigo-500" />
                <span className="truncate text-sm font-medium text-zinc-900">{f.name}</span>
              </button>
            </li>
          ))}
          {view?.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
              <a
                href={api.publicFolderFileUrl(username, slug, f.id)}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <FileIcon className="h-5 w-5 shrink-0 text-zinc-400" />
                <span className="truncate text-sm text-zinc-900">{f.name}</span>
              </a>
              <span className="shrink-0 text-xs text-zinc-400">{humanSize(f.size)}</span>
              <a
                href={api.publicFolderFileUrl(username, slug, f.id, true)}
                className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-10 text-center text-xs text-zinc-400">
        Powered by BYOS — bring your own storage.
      </footer>
    </main>
  );
}
