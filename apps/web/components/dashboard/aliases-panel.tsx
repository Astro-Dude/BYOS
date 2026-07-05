"use client";

import { ApiError, type AliasItem } from "@byos/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

export function AliasesPanel({ refreshKey }: { refreshKey: number }) {
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

  const copy = async (slug: string) => {
    await navigator.clipboard.writeText(api.aliasUrl(username, slug));
    setCopied(slug);
    toast("Link copied");
    setTimeout(() => setCopied(null), 1500);
  };

  if (!loading && aliases.length === 0) return null; // nothing to show yet

  return (
    <section className="rounded-lg border border-zinc-200 p-5">
      <h2 className="font-semibold text-zinc-900">Permanent links</h2>
      <p className="text-sm text-zinc-500">
        Share these URLs — replacing the underlying file updates them everywhere.
      </p>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <ul className="mt-4 divide-y divide-zinc-100">
        {aliases.map((alias) => (
          <li key={alias.id} className="flex items-center justify-between gap-4 py-2">
            <code className="truncate text-sm text-indigo-600">/{username}/{alias.slug}</code>
            <div className="flex shrink-0 gap-3">
              <button
                onClick={() => copy(alias.slug)}
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
              >
                {copied === alias.slug ? "Copied" : "Copy URL"}
              </button>
              <button
                onClick={() => remove(alias)}
                className="text-sm font-medium text-red-600 hover:text-red-500"
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
