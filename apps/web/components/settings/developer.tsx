"use client";

import { type ApiKeyItem, ApiError, type WebhookItem } from "@byos/api-client";
import { Check, Copy, Eye, EyeOff, KeyRound, Plus, Webhook as WebhookIcon, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { Terminal } from "@/components/dashboard/terminal";
import { Segmented, SettingsGroup, SettingsHeader } from "@/components/settings/controls";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { MAX_ACTIVE_API_KEYS, MAX_WEBHOOKS } from "@/lib/limits";
import { useToast } from "@/lib/toast";

/* API keys and webhooks. The managers (list, create, revoke) are shared by
   Settings and the Developer page in the Drive, so both look and work the same. */

const RESOURCES = [
  { id: "files", label: "Files" },
  { id: "folders", label: "Folders" },
  { id: "aliases", label: "Links" },
] as const;
type Access = "none" | "read" | "write";

const EXPIRY: { value: string; label: string; days: number | null }[] = [
  { value: "never", label: "Never", days: null },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "365", label: "1 year", days: 365 },
];

const EVENTS = [
  { id: "file.created", label: "File added" },
  { id: "file.replaced", label: "File replaced" },
  { id: "file.deleted", label: "File deleted" },
];

const label = "mb-1.5 block text-[0.8125rem] text-zinc-500";
// Long lists scroll inside their card instead of stretching the page. Rows keep
// their hairlines, since the wrapper replaces the card's own dividers.
const LIST_SCROLL = "thin-scroll -mr-3 max-h-[min(34rem,60vh)] divide-y divide-zinc-200 overflow-y-auto pr-3";
const input =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-[0.9375rem] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Sheet({ title, subtitle, icon, onClose, children }: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-scrim z-50" onClick={onClose}>
      <div className="modal-surface max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="type-heading-sm">{title}</h3>
            <p className="mt-0.5 text-[0.875rem] text-zinc-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon-sm -mr-2 -mt-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/** The top of a manager: what it's for at a glance, how much of the limit is
 *  used (a meter that turns amber near the end), and the create button. */
function UsageBar({ icon, label, used, limit, noun, onCreate }: {
  icon: ReactNode;
  label: string;
  used: number;
  limit: number;
  noun: string;
  onCreate: () => void;
}) {
  const full = used >= limit;
  const near = !full && used >= limit - 1;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-800">
        {icon}
      </span>
      <div className="min-w-[10rem] flex-1">
        <p className="text-[0.9375rem] text-zinc-900">
          <span className="font-medium tabular-nums">{used}</span>
          <span className="text-zinc-500">
            {" "}
            of {limit} {noun}
          </span>
        </p>
        <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-zinc-100">
          <div
            className={`h-full rounded-full transition-all ${
              full ? "bg-[rgb(var(--c-danger-500))]" : near ? "bg-[rgb(var(--c-caution-500))]" : "bg-zinc-900"
            }`}
            style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
          />
        </div>
        {full ? <p className="mt-1.5 text-[0.75rem] text-zinc-500">Remove one to add another.</p> : null}
      </div>
      <button
        type="button"
        onClick={onCreate}
        disabled={full}
        className="pill-sm-filled inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> {label}
      </button>
    </div>
  );
}

/** Nothing here yet: what it's for, and the one button that starts it. */
function EmptyState({ icon, title, body, action, onAction }: {
  icon: ReactNode;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">{icon}</span>
      <p className="mt-4 text-[0.9375rem] font-medium text-zinc-900">{title}</p>
      <p className="mt-1 max-w-sm text-[0.8125rem] leading-[1.5] text-zinc-500">{body}</p>
      <button type="button" onClick={onAction} className="pill-sm-ghost mt-5 inline-flex items-center gap-1.5">
        <Plus className="h-4 w-4" /> {action}
      </button>
    </div>
  );
}

/** A small rounded label. The tone shows as a dot, so the text stays ink and
 *  reads on every theme. */
function Badge({ tone = "zinc", children }: { tone?: "zinc" | "go" | "caution" | "danger"; children: ReactNode }) {
  const dot = {
    zinc: "bg-zinc-400",
    go: "bg-[rgb(var(--c-go-500))]",
    caution: "bg-[rgb(var(--c-caution-500))]",
    danger: "bg-[rgb(var(--c-danger-500))]",
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[0.6875rem] font-medium text-zinc-700">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

const DAY_MS = 86_400_000;

/** Active, expiring within a fortnight, or expired. */
function keyStatus(k: ApiKeyItem): { tone: "go" | "caution" | "danger"; text: string } {
  if (!k.expires_at) return { tone: "go", text: "Active" };
  const left = new Date(k.expires_at).getTime() - Date.now();
  if (left <= 0) return { tone: "danger", text: "Expired" };
  const days = Math.ceil(left / DAY_MS);
  return days <= 14 ? { tone: "caution", text: `Expires in ${days} day${days === 1 ? "" : "s"}` } : { tone: "go", text: "Active" };
}

function CopyButton({ value, label: what = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="pill-sm-ghost inline-flex shrink-0 items-center gap-1.5"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : what}
    </button>
  );
}

/** One chip per resource a key can reach: "Files · Read and write". */
function AccessChips({ scopes }: { scopes: string[] | null }) {
  if (!scopes) return <Badge tone="caution">Full access</Badge>;
  const parts = RESOURCES.flatMap((r) => {
    const w = scopes.includes(`${r.id}:write`);
    const rd = scopes.includes(`${r.id}:read`);
    return w || rd ? [{ label: r.label, write: w }] : [];
  });
  if (!parts.length) return <Badge>No access</Badge>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {parts.map((p) => (
        <span
          key={p.label}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[0.75rem] text-zinc-700"
        >
          {p.label}
          <span className="text-zinc-400">·</span>
          <span className={p.write ? "font-medium text-zinc-900" : "text-zinc-500"}>{p.write ? "Read and write" : "Read"}</span>
        </span>
      ))}
    </span>
  );
}

function CreateKey({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const authed = useAuthed();
  const [name, setName] = useState("");
  // Safe start: read-only everywhere.
  const [access, setAccess] = useState<Record<string, Access>>({ files: "read", folders: "read", aliases: "read" });
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const scopes = RESOURCES.flatMap((r) =>
    access[r.id] === "write" ? [`${r.id}:read`, `${r.id}:write`] : access[r.id] === "read" ? [`${r.id}:read`] : [],
  );

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const days = EXPIRY.find((e) => e.value === expiry)?.days ?? null;
      const result = await authed((t) => api.createApiKey(t, name.trim(), scopes, days));
      setCreated(result.key);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't create the key.");
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Sheet title="Your new key" subtitle="Copy it now. You won't be able to see it again." icon={<KeyRound className="h-5 w-5" />} onClose={onClose}>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-[0.8125rem] text-zinc-900">{created}</code>
          <CopyButton value={created} />
        </div>
        <p className="mt-3 text-[0.8125rem] text-zinc-500">
          Send it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. If it&apos;s lost, revoke it and make another.
        </p>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="pill-sm-filled">
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Create an API key" subtitle="Give it only the access it needs." icon={<KeyRound className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-5">
        <div>
          <span className={label}>Name</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Backup script" autoFocus />
        </div>
        <div>
          <span className={label}>Access</span>
          <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200">
            {RESOURCES.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-[0.9375rem] text-zinc-900">{r.label}</span>
                <Segmented<Access>
                  label={`${r.label} access`}
                  value={access[r.id] ?? "none"}
                  onChange={(v) => setAccess((a) => ({ ...a, [r.id]: v }))}
                  options={[
                    { value: "none", label: "None" },
                    { value: "read", label: "Read" },
                    { value: "write", label: "Read and write" },
                  ]}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>Expires</span>
          <Segmented label="Expires" value={expiry} onChange={setExpiry} options={EXPIRY.map((e) => ({ value: e.value, label: e.label }))} />
        </div>
        {error ? <p className="text-[0.875rem] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="pill-sm-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !name.trim() || scopes.length === 0}
            className="pill-sm-filled disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create key"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function ApiKeysSettings() {
  return (
    <>
      <SettingsHeader
        title="API keys"
        description="Let your own scripts and apps use BYOS. Each key only gets the access you give it, and can be revoked at any time."
      />
      <ApiKeysManager />
    </>
  );
}

/** Create, list and revoke API keys. */
export function ApiKeysManager() {
  const authed = useAuthed();
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyItem | null>(null);

  const load = useCallback(() => {
    authed((t) => api.listApiKeys(t))
      .then(setKeys)
      .catch(() => setKeys([]));
  }, [authed]);
  useEffect(load, [load]);

  const active = keys ?? [];

  // Expired keys are left in the list but don't count toward the limit.
  const counted = active.filter((k) => !k.expires_at || new Date(k.expires_at) > new Date()).length;

  return (
    <>
      <UsageBar
        icon={<KeyRound className="h-5 w-5" />}
        label="Create key"
        used={counted}
        limit={MAX_ACTIVE_API_KEYS}
        noun="active keys"
        onCreate={() => setCreating(true)}
      />

      <SettingsGroup title="Your keys">
        {keys === null ? (
          <div className="space-y-3 py-4">
            <div className="h-14 animate-pulse rounded-xl bg-zinc-100" />
            <div className="h-14 animate-pulse rounded-xl bg-zinc-100" />
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-5 w-5" />}
            title="No API keys yet"
            body="A key lets a script or app read and change your drive over the API, with only the access you give it."
            action="Create your first key"
            onAction={() => setCreating(true)}
          />
        ) : (
          <div className={LIST_SCROLL}>
            {active.map((k) => {
              const status = keyStatus(k);
              return (
                <div key={k.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.9375rem] font-medium text-zinc-900">{k.name}</span>
                      <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.6875rem] text-zinc-600">
                        {k.prefix}…
                      </code>
                      <Badge tone={status.tone}>{status.text}</Badge>
                    </p>
                    <AccessChips scopes={k.scopes} />
                    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem] text-zinc-500">
                      <span>Created {day(k.created_at)}</span>
                      <span>{k.last_used_at ? `Last used ${day(k.last_used_at)}` : "Never used"}</span>
                      <span>{k.expires_at ? `Expires ${day(k.expires_at)}` : "Never expires"}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRevoking(k)}
                    className="pill-sm-ghost shrink-0 self-start hover:!border-[rgb(var(--c-danger-600))] hover:!text-[rgb(var(--c-danger-600))]"
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SettingsGroup>

      <section className="mb-8">
        <h2 className="type-label mb-3">Try it</h2>
        <Terminal
          title="list your files"
          lines={[
            { kind: "cmd", text: `curl -s ${api.apiBase}/files \\` },
            { kind: "cont", text: '-H "Authorization: Bearer byosk_your_key"' },
            { kind: "comment", text: "# 401 = wrong key · 403 = outside the key's access" },
          ]}
        />
      </section>

      {creating ? <CreateKey onClose={() => setCreating(false)} onCreated={load} /> : null}
      {revoking ? (
        <ConfirmModal
          title="Revoke this key?"
          message={`Anything using “${revoking.name}” stops working right away, and the key is deleted.`}
          confirmLabel="Revoke"
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            const k = revoking;
            setRevoking(null);
            authed((t) => api.revokeApiKey(t, k.id))
              .then(() => {
                toast("Key revoked");
                load();
              })
              .catch(() => toast("Couldn't revoke the key", "error"));
          }}
        />
      ) : null}
    </>
  );
}

function Secret({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 font-mono text-[0.75rem] text-zinc-700">
        {shown ? value : "•".repeat(28)}
      </code>
      <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide secret" : "Show secret"} className="btn-icon-sm">
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <CopyButton value={value} />
    </div>
  );
}

function AddWebhook({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const authed = useAuthed();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    setBusy(true);
    try {
      await authed((t) => api.createWebhook(t, url.trim(), events));
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't add the webhook.");
      setBusy(false);
    }
  };

  return (
    <Sheet title="Add a webhook" subtitle="We'll send a signed POST to this URL when files change." icon={<WebhookIcon className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-5">
        <div>
          <span className={label}>URL</span>
          <input className={`${input} font-mono`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/byos" autoFocus spellCheck={false} />
        </div>
        <div>
          <span className={label}>Send for</span>
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((ev) => {
              const on = events.includes(ev.id);
              return (
                <button
                  key={ev.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setEvents((cur) => (on ? cur.filter((e) => e !== ev.id) : [...cur, ev.id]))}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                    on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-700 hover:border-zinc-400"
                  }`}
                >
                  {on ? <Check className="h-3.5 w-3.5" /> : null}
                  {ev.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[0.8125rem] text-zinc-500">{events.length ? "Only these." : "Nothing picked means every event."}</p>
        </div>
        {error ? <p className="text-[0.875rem] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="pill-sm-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || !/^https?:\/\/.+/.test(url.trim())}
            className="pill-sm-filled disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add webhook"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function WebhooksSettings() {
  return (
    <>
      <SettingsHeader
        title="Webhooks"
        description="Get a signed POST when files are added, replaced or deleted. Check the signature with the webhook's secret."
      />
      <WebhooksManager />
    </>
  );
}

/** Add, list and delete webhooks. */
export function WebhooksManager() {
  const authed = useAuthed();
  const toast = useToast();
  const [hooks, setHooks] = useState<WebhookItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<WebhookItem | null>(null);

  const load = useCallback(() => {
    authed((t) => api.listWebhooks(t))
      .then(setHooks)
      .catch(() => setHooks([]));
  }, [authed]);
  useEffect(load, [load]);

  return (
    <>
      <UsageBar
        icon={<WebhookIcon className="h-5 w-5" />}
        label="Add webhook"
        used={hooks?.length ?? 0}
        limit={MAX_WEBHOOKS}
        noun="webhooks"
        onCreate={() => setAdding(true)}
      />

      <SettingsGroup title="Your webhooks">
        {hooks === null ? (
          <div className="space-y-3 py-4">
            <div className="h-20 animate-pulse rounded-xl bg-zinc-100" />
          </div>
        ) : hooks.length === 0 ? (
          <EmptyState
            icon={<WebhookIcon className="h-5 w-5" />}
            title="No webhooks yet"
            body="Point one at your server and BYOS will POST to it whenever a file is added, replaced or deleted."
            action="Add your first webhook"
            onAction={() => setAdding(true)}
          />
        ) : (
          <div className={LIST_SCROLL}>
            {hooks.map((h) => {
              // A webhook made with nothing picked is stored as ["*"]: every event.
              const all = !h.events.length || h.events.includes("*");
              return (
                <div key={h.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                    <WebhookIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-mono text-[0.875rem] text-zinc-900" title={h.url}>
                        {h.url}
                      </span>
                      <Badge tone={h.active ? "go" : "zinc"}>{h.active ? "Active" : "Paused"}</Badge>
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5">
                      {(all ? ["Every event"] : h.events.map((id) => EVENTS.find((e) => e.id === id)?.label ?? id)).map(
                        (ev) => (
                          <span
                            key={ev}
                            className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[0.75rem] text-zinc-700"
                          >
                            {ev}
                          </span>
                        ),
                      )}
                      <span className="text-[0.75rem] text-zinc-500">· Added {day(h.created_at)}</span>
                    </p>
                    <div className="rounded-xl bg-zinc-50 p-2 ring-1 ring-inset ring-zinc-200">
                      <span className="mb-1 block px-0.5 text-[0.6875rem] font-medium uppercase tracking-wide text-zinc-500">
                        Signing secret
                      </span>
                      <Secret value={h.secret} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleting(h)}
                    className="pill-sm-ghost shrink-0 self-start hover:!border-[rgb(var(--c-danger-600))] hover:!text-[rgb(var(--c-danger-600))]"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SettingsGroup>

      <section className="mb-8">
        <h2 className="type-label mb-3">What arrives</h2>
        <Terminal
          title="a delivery"
          lines={[
            { kind: "out", text: "POST https://your-server/byos" },
            { kind: "out", text: "X-BYOS-Signature: sha256=<hex>" },
            { kind: "out", text: '{"event": "file.created", "data": {…}}' },
            { kind: "comment", text: "# check it: HMAC-SHA256 of the raw body with the signing secret" },
          ]}
        />
      </section>

      {adding ? <AddWebhook onClose={() => setAdding(false)} onAdded={load} /> : null}
      {deleting ? (
        <ConfirmModal
          title="Delete this webhook?"
          message={`${deleting.url} will stop getting events.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const h = deleting;
            setDeleting(null);
            authed((t) => api.deleteWebhook(t, h.id))
              .then(() => {
                toast("Webhook deleted");
                load();
              })
              .catch(() => toast("Couldn't delete the webhook", "error"));
          }}
        />
      ) : null}
    </>
  );
}
