"use client";

import { ApiError, type AliasItem } from "@byos/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAliases(await authed((t) => api.listAliases(t)));
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
    try {
      await authed((t) => api.deleteAlias(t, alias.id));
      await load();
      toast("Link deleted");
    } catch (err) {
      const m = err instanceof ApiError ? err.detail : "Delete failed";
      setError(m);
      toast(m, "error");
    }
  };

  const linkUrl = (alias: AliasItem) =>
    alias.target_type === "folder"
      ? `${window.location.origin}/${username}/${alias.slug}` // browsable web page
      : api.aliasUrl(username, alias.slug); // API streams the file

  const copy = async (alias: AliasItem) => {
    await navigator.clipboard.writeText(linkUrl(alias));
    setCopied(alias.slug);
    toast("Link copied");
    setTimeout(() => setCopied(null), 1500);
  };

  if (!loading && aliases.length === 0) return null; // nothing to show yet

  return (
    <section className="surface-card p-6">
      <h2 className="font-medium text-zinc-900">Permanent links</h2>
      <p className="text-[0.9375rem] text-zinc-500">
        Share these URLs — replacing the underlying file updates them everywhere.
      </p>
      {error ? <p className="mt-2 text-[0.9375rem] text-red-600">{error}</p> : null}
      <ul className="mt-4 divide-y divide-zinc-200">
        {aliases.map((alias) => (
          <li key={alias.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <div className="min-w-0 flex-1 basis-full sm:basis-0">
              <code className="block truncate text-[0.9375rem] text-zinc-900">/{username}/{alias.slug}</code>
              {alias.target_name ? (
                <button
                  onClick={() => onOpenLocation(alias.parent_folder_id)}
                  className="mt-0.5 block max-w-full truncate text-left text-[0.8125rem] text-zinc-500 hover:text-zinc-800 hover:underline"
                  title={alias.target_type === "folder" ? "Open folder" : "Go to file location"}
                >
                  {alias.target_type === "folder" ? "📁" : "→"} {alias.target_name}
                </button>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-3">
              <button
                onClick={() => copy(alias)}
                className="text-[0.9375rem] font-medium text-zinc-600 hover:text-zinc-900"
              >
                {copied === alias.slug ? "Copied" : "Copy URL"}
              </button>
              <button
                onClick={() => remove(alias)}
                className="text-[0.9375rem] font-medium text-red-600 hover:text-red-500"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
