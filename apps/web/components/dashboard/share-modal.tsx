"use client";

import { ApiError, type AliasItem, type ShareItem } from "@byos/api-client";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Folder,
  Globe2,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { fileIcon } from "@/components/dashboard/file-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

/** What's being shared: a file (permanent link, plus expiring links) or a
 *  folder (a browsable permanent link). */
export type ShareTarget =
  | { kind: "file"; id: string; name: string; mime: string | null; ext: string | null }
  | { kind: "folder"; id: string; name: string };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

/** A link name from a file name: "Lisbon Boarding Pass.pdf" → "lisbon-boarding-pass". */
function suggestSlug(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]{1,6}$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "my-link"
  );
}

/** As typed: lowercase, spaces become hyphens, anything else is dropped. */
const cleanSlug = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

const EXPIRY = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Sharing in one place. The permanent link comes first: name it (prefilled
 *  from the file name, cleaned as you type, shown as …/you/name), then copy or
 *  open it, rename it or stop sharing. Files can also get expiring links that
 *  run out after a few days, listed with when each one ends. */
export function ShareModal({
  target,
  onClose,
  onCreated,
}: {
  target: ShareTarget;
  onClose: () => void;
  /** The set of links changed (Links page refreshes). */
  onCreated: () => void;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const { user } = useAuth();
  const username = user?.username ?? "";
  const isFile = target.kind === "file";

  const [existing, setExisting] = useState<AliasItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState(() => suggestSlug(target.name));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const slugRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    authed((t) => api.listAliases(t))
      .then((aliases) => {
        const found = aliases.find((a) =>
          target.kind === "file" ? a.file_id === target.id : a.target_type === "folder" && a.folder_id === target.id,
        );
        if (found) setExisting(found);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [authed, target.id, target.kind]);

  // Escape closes, as every other dialog does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Folder links are browsable pages on the web app; file links stream from the API.
  const urlFor = (s: string) =>
    isFile ? api.aliasUrl(username, s) : `${window.location.origin}/${username}/${s}`;
  const linkUrl = existing ? urlFor(existing.slug) : null;
  const slugValid = SLUG_RE.test(slug);
  const showEditor = !loading && (editing || !existing);

  const submit = async () => {
    if (!slugValid) return;
    setError(null);
    setBusy(true);
    try {
      if (editing && existing) {
        setExisting(await authed((t) => api.updateAlias(t, existing.id, { slug })));
        setEditing(false);
        toast("Link renamed");
      } else {
        const created = await authed((t) =>
          isFile ? api.createAlias(t, slug, target.id) : api.createFolderAlias(t, slug, target.id),
        );
        setExisting(created);
        toast(isFile ? "Link created" : "Folder shared");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async () => {
    if (!existing) return;
    setConfirmStop(false);
    setBusy(true);
    try {
      await authed((t) => api.deleteAlias(t, existing.id));
      setExisting(null);
      setSlug(existing.slug);
      toast("Link deleted");
      onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't delete the link", "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    toast("Link copied");
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
  };

  return (
    <div className="modal-scrim z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Share ${target.name}`}
        className="modal-surface max-w-lg p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: what's being shared. */}
        <div className="flex items-start gap-3 px-6 pt-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
            {target.kind === "folder" ? <Folder className="h-5 w-5 text-zinc-600" /> : fileIcon(target.mime, target.ext)}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="type-heading-sm">Share {isFile ? "file" : "folder"}</h3>
            <p className="mt-0.5 truncate text-[0.875rem] text-zinc-500" title={target.name}>
              {target.name}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon-sm -mr-2 -mt-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-6 pt-5">
          <SectionTitle icon={<Globe2 className="h-3.5 w-3.5" />}>Permanent link</SectionTitle>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : showEditor ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {/* One field: the fixed part of the address, then the name you pick. */}
              <label
                onClick={() => slugRef.current?.focus()}
                className={`flex items-center rounded-xl border bg-white pl-3.5 transition-colors focus-within:ring-1 ${
                  slug && !slugValid
                    ? "border-[rgb(var(--c-danger-500))] focus-within:ring-[rgb(var(--c-danger-500))]"
                    : "border-zinc-200 focus-within:border-zinc-900 focus-within:ring-zinc-900"
                }`}
              >
                <span className="shrink-0 font-mono text-[0.8125rem] text-zinc-400">/{username}/</span>
                <input
                  ref={slugRef}
                  value={slug}
                  onChange={(e) => setSlug(cleanSlug(e.target.value))}
                  onFocus={(e) => e.currentTarget.select()}
                  autoFocus
                  spellCheck={false}
                  aria-label="Link name"
                  placeholder={isFile ? "resume" : "design-assets"}
                  className="min-w-0 flex-1 bg-transparent py-3 pr-3.5 font-mono text-[0.875rem] text-zinc-900 outline-none placeholder:text-zinc-400"
                />
              </label>
              <p className={`mt-1.5 text-[0.75rem] ${slug && !slugValid ? "text-[rgb(var(--c-danger-600))]" : "text-zinc-500"}`}>
                {slug && !slugValid
                  ? "Start with a letter or digit; then letters, digits and hyphens."
                  : `…/${username}/${slug || "name"}`}
              </p>
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-[0.8125rem] leading-[1.45] text-zinc-600">
                <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {isFile
                  ? "Anyone with the link can open the file. Replace the file later and the same link serves the new version."
                  : "Anyone with the link can browse and download what's in this folder, including files you add later."}
              </p>
              {error ? <p className="mt-2 text-[0.875rem] text-[rgb(var(--c-danger-600))]">{error}</p> : null}
              <div className="mt-4 flex justify-end gap-2">
                {editing ? (
                  <button type="button" onClick={() => setEditing(false)} className="pill-sm-ghost">
                    Cancel
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={busy || !slugValid}
                  className="pill-sm-filled inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  {editing ? "Save name" : "Create link"}
                </button>
              </div>
            </form>
          ) : existing && linkUrl ? (
            <div>
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-1.5 pl-3.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-zinc-900" title={linkUrl}>
                  {`…/${username}/${existing.slug}`}
                </span>
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-icon-sm"
                  title="Open link"
                  aria-label="Open link"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <CopyPill url={linkUrl} copied={copied === linkUrl} onCopy={copy} />
              </div>
              <p className="mt-2 text-[0.8125rem] leading-[1.45] text-zinc-500">
                {isFile
                  ? "Anyone with it can open the file. It always serves the latest version."
                  : "Anyone with it can browse the folder. It updates as you add or remove files."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSlug(existing.slug);
                    setError(null);
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.8125rem] text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </button>
                {confirmStop ? (
                  <span className="inline-flex items-center gap-1.5 text-[0.8125rem]">
                    <span className="text-zinc-600">Anyone holding it loses access.</span>
                    <button
                      type="button"
                      onClick={() => void stopSharing()}
                      className="rounded-full bg-[rgb(var(--c-danger-600))] px-2.5 py-1 font-medium text-[rgb(var(--c-paper))] hover:opacity-90"
                    >
                      Stop sharing
                    </button>
                    <button type="button" onClick={() => setConfirmStop(false)} className="px-1.5 py-1 text-zinc-500 hover:text-zinc-900">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmStop(true)}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.8125rem] text-zinc-600 transition-colors hover:bg-[rgb(var(--c-danger-50))] hover:text-[rgb(var(--c-danger-600))]"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Stop sharing
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {target.kind === "file" ? (
            <ExpiringLinks fileId={target.id} copied={copied} onCopy={copy} />
          ) : null}
        </div>

        <div className="flex justify-end border-t border-zinc-200 px-6 py-3">
          <button type="button" onClick={onClose} className="pill-sm-filled">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, children, aside }: { icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h4 className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-zinc-800">
        <span className="text-zinc-500">{icon}</span>
        {children}
      </h4>
      {aside}
    </div>
  );
}

function CopyPill({ url, copied, onCopy }: { url: string; copied: boolean; onCopy: (url: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(url)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
        copied ? "bg-[rgb(var(--c-go-500))] text-[rgb(var(--c-paper))]" : "bg-zinc-900 text-[rgb(var(--c-paper))] hover:bg-zinc-800"
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Links that run out after a number of days. For sending something once
 *  without leaving it shared for good. */
function ExpiringLinks({
  fileId,
  copied,
  onCopy,
}: {
  fileId: string;
  copied: string | null;
  onCopy: (url: string) => void;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const [shares, setShares] = useState<ShareItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authed((t) => api.listShares(t))
      .then((all) => setShares(all.filter((s) => s.file_id === fileId)))
      .catch(() => setShares([]));
  }, [authed, fileId]);

  const create = async () => {
    setBusy(true);
    try {
      const s = await authed((t) =>
        api.createShare(t, { file_id: fileId, expires_in_days: days }),
      );
      setShares((cur) => [s, ...(cur ?? [])]);
      setOpen(false);
      void onCopy(api.shareUrl(s.token));
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't create the link", "error");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (s: ShareItem) => {
    setShares((cur) => (cur ?? []).filter((x) => x.id !== s.id));
    try {
      await authed((t) => api.deleteShare(t, s.id));
      toast("Link revoked");
    } catch {
      toast("Couldn't revoke the link", "error");
      setShares((cur) => [s, ...(cur ?? [])]);
    }
  };

  const live = (shares ?? []).filter((s) => !s.expires_at || new Date(s.expires_at) > new Date());
  const pill = (on: boolean) =>
    `rounded-full px-2.5 py-1 text-[0.75rem] transition-colors ${
      on ? "sel-fill" : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900"
    }`;

  return (
    <div className="mt-6 border-t border-zinc-200 pt-5">
      <SectionTitle
        icon={<Clock className="h-3.5 w-3.5" />}
        aside={
          !open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[0.8125rem] font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-[3px] hover:decoration-zinc-900"
            >
              New expiring link
            </button>
          ) : null
        }
      >
        Expiring links
      </SectionTitle>

      {open ? (
        <div className="rounded-xl border border-zinc-200 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.8125rem] text-zinc-600">Expires after</span>
            <div role="radiogroup" aria-label="Expires after" className="inline-flex gap-0.5 rounded-full bg-zinc-100 p-0.5">
              {EXPIRY.map((e) => (
                <button key={e.days} type="button" role="radio" aria-checked={days === e.days} onClick={() => setDays(e.days)} className={pill(days === e.days)}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3.5 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="pill-sm-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="pill-sm-filled inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Create &amp; copy
            </button>
          </div>
        </div>
      ) : null}

      {shares === null ? (
        <Skeleton className="mt-2 h-10 w-full rounded-xl" />
      ) : live.length === 0 && !open ? (
        <p className="text-[0.8125rem] leading-[1.45] text-zinc-500">
          Send it once without sharing it for good: a link that stops working after a few days.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {live.map((s) => {
            const url = api.shareUrl(s.token);
            return (
              <li key={s.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 py-1.5 pl-3 pr-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[0.75rem] text-zinc-800">…/s/{s.token.slice(0, 10)}…</p>
                  <p className="text-[0.6875rem] text-zinc-500">
                    {s.expires_at ? `Until ${day(s.expires_at)}` : "No expiry"}
                  </p>
                </div>
                <CopyPill url={url} copied={copied === url} onCopy={onCopy} />
                <button
                  type="button"
                  onClick={() => void revoke(s)}
                  className="btn-icon-sm hover:!bg-[rgb(var(--c-danger-50))] hover:!text-[rgb(var(--c-danger-600))]"
                  title="Revoke"
                  aria-label="Revoke"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
