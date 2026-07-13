"use client";

import {
  ApiError,
  type ApiKeyItem,
  type WebhookItem,
} from "@byos/api-client";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

const EVENT_TYPES = ["file.created", "file.replaced", "file.deleted"];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const SCOPE_GROUPS = [
  { resource: "files", label: "Files" },
  { resource: "folders", label: "Folders" },
  { resource: "aliases", label: "Links" },
] as const;

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: "Never", days: null },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

function ApiKeysSection() {
  const authed = useAuthed();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState("");
  // Safe default: a read-only key across all resources.
  const [scopes, setScopes] = useState<Set<string>>(
    () => new Set(["files:read", "folders:read", "aliases:read"]),
  );
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleScope = (scope: string) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  const load = useCallback(async () => {
    try {
      setKeys(await authed((t) => api.listApiKeys(t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load keys");
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const clean = name.trim();
    if (!clean || scopes.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authed((t) =>
        api.createApiKey(t, clean, Array.from(scopes), expiryDays),
      );
      setFreshKey(result.key);
      setCopied(false);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to create key");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await authed((t) => api.revokeApiKey(t, id));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to revoke");
    }
  };

  const copyKey = async () => {
    if (!freshKey) return;
    await navigator.clipboard.writeText(freshKey);
    setCopied(true);
  };

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">API keys</h2>
      <p className="text-sm text-zinc-500">
        Authenticate programmatic requests with{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1">Authorization: Bearer byosk_…</code>
      </p>

      <div className="mt-4 space-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 p-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Key name (e.g. CI, laptop)"
        />

        <div>
          <p className="text-xs font-medium text-zinc-500">
            Permissions — grant only what this key needs
          </p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {SCOPE_GROUPS.map((g) => (
              <div key={g.resource} className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{g.label}</p>
                {(["read", "write"] as const).map((action) => {
                  const scope = `${g.resource}:${action}`;
                  return (
                    <label
                      key={scope}
                      className="mt-1 flex items-center gap-2 text-xs text-zinc-600"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.has(scope)}
                        onChange={() => toggleScope(scope)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700 accent-indigo-600"
                      />
                      {action}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-zinc-600">
            Expires
            <select
              value={expiryDays ?? ""}
              onChange={(e) => setExpiryDays(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.days ?? ""}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={create} disabled={busy || !name.trim() || scopes.size === 0}>
            Create key
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {freshKey ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">
            Copy this key now — it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-white dark:bg-zinc-900 px-2 py-1 text-sm">
              {freshKey}
            </code>
            <button onClick={copyKey} className="shrink-0 text-sm font-medium text-indigo-600">
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setFreshKey(null)}
              className="shrink-0 text-sm text-zinc-400 hover:text-zinc-700 dark:text-zinc-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {keys.length > 0 ? (
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{key.name}</span>
                  {key.revoked_at ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                      Revoked
                    </span>
                  ) : null}
                </div>
                <code className="text-xs text-zinc-400">byosk_{key.prefix}…</code>
                <span className="ml-2 text-xs text-zinc-400">created {shortDate(key.created_at)}</span>
                {key.expires_at ? (
                  <span className="ml-2 text-xs text-zinc-400">
                    · expires {shortDate(key.expires_at)}
                  </span>
                ) : null}
                {key.last_used_at ? (
                  <span className="ml-2 text-xs text-zinc-400">
                    · last used {shortDate(key.last_used_at)}
                  </span>
                ) : null}
                {key.scopes && key.scopes.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {key.scopes.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="ml-2 text-xs text-amber-600">· full access (legacy)</span>
                )}
              </div>
              {key.revoked_at ? null : (
                <button
                  onClick={() => revoke(key.id)}
                  className="shrink-0 text-sm font-medium text-red-600 hover:text-red-500"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function WebhooksSection() {
  const authed = useAuthed();
  const [hooks, setHooks] = useState<WebhookItem[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setHooks(await authed((t) => api.listWebhooks(t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load webhooks");
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEvent = (event: string) =>
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));

  const create = async () => {
    const clean = url.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      await authed((t) => api.createWebhook(t, clean, events));
      setUrl("");
      setEvents([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to create webhook");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await authed((t) => api.deleteWebhook(t, id));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to delete");
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Webhooks</h2>
      <p className="text-sm text-zinc-500">
        Receive signed POSTs on file events. Verify with the{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1">X-BYOS-Signature</code> header.
      </p>

      <div className="mt-4 space-y-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-app.com/webhooks/byos"
        />
        <div className="flex flex-wrap items-center gap-3">
          {EVENT_TYPES.map((event) => (
            <label key={event} className="flex items-center gap-1.5 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={() => toggleEvent(event)}
                className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700 accent-indigo-600"
              />
              {event}
            </label>
          ))}
          <span className="text-xs text-zinc-400">(none = all events)</span>
          <Button onClick={create} disabled={busy || !url.trim()} className="ml-auto">
            Add
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {hooks.length > 0 ? (
        <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex items-start justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <code className="block truncate text-sm text-zinc-800 dark:text-zinc-200">{hook.url}</code>
                <div className="mt-1 flex flex-wrap gap-1">
                  {hook.events.map((event) => (
                    <span
                      key={event}
                      className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
                    >
                      {event}
                    </span>
                  ))}
                </div>
                <code className="mt-1 block truncate text-xs text-zinc-400">
                  secret: {hook.secret}
                </code>
              </div>
              <button
                onClick={() => remove(hook.id)}
                className="shrink-0 text-sm font-medium text-red-600 hover:text-red-500"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-100">
      <code>{children}</code>
    </pre>
  );
}

function DocsSection() {
  const [open, setOpen] = useState(false);
  // Swagger UI (/docs) is gated off in production, so the external link would
  // 404 there — only offer it once we've confirmed a non-prod environment.
  const [interactiveDocs, setInteractiveDocs] = useState(false);
  const base = api.apiBase;

  useEffect(() => {
    let active = true;
    api
      .health()
      .then((h) => {
        if (active) setInteractiveDocs(h.environment !== "production");
      })
      .catch(() => {
        if (active) setInteractiveDocs(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Documentation</h2>
          <p className="text-sm text-zinc-500">
            {interactiveDocs
              ? "Everything you need to build against the BYOS API."
              : "Interactive docs are disabled in production — use the guide below."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {interactiveDocs ? (
            <a
              href={api.docsUrl()}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Interactive API reference ↗
            </a>
          ) : null}
          <Button onClick={() => setOpen((v) => !v)}>
            {open ? "Hide guide" : "Show guide"}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-5 space-y-6 text-sm text-zinc-700 dark:text-zinc-300">
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Authentication</h3>
            <p className="mt-1 text-zinc-600">
              Create an API key above, then send it as a Bearer token on every request.
              The full key is shown only once.
            </p>
            <CodeBlock>{`curl ${base}/files \\
  -H "Authorization: Bearer byosk_your_key_here"`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Scopes &amp; safety</h3>
            <p className="mt-1 text-zinc-600">
              Each key is limited to the scopes you grant it —{" "}
              <code>files</code>, <code>folders</code>, and <code>aliases</code>, each with{" "}
              <code>:read</code> and <code>:write</code> (write implies read). A call outside a
              key&apos;s scopes returns <code>403</code>. Keys can also carry an expiry and are
              rate-limited per key.
            </p>
            <p className="mt-2 text-zinc-600">
              For safety, keys <strong>cannot</strong> perform account administration —
              creating/revoking keys, reading provider (Telegram) credentials, or managing
              webhooks all require an interactive login. A leaked key can never escalate its own
              access.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Core endpoints</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Method</th>
                    <th className="py-1 pr-4 font-medium">Path</th>
                    <th className="py-1 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-700 dark:text-zinc-300">
                  {[
                    ["GET", "/files", "List files (paginated, filterable)"],
                    ["POST", "/files", "Upload a file"],
                    ["PUT", "/files/{id}", "Replace a file (new version)"],
                    ["PATCH", "/files/{id}", "Rename a file"],
                    ["POST", "/files/{id}/move", "Move a file to a folder"],
                    ["GET", "/files/{id}/download", "Stream file bytes"],
                    ["GET", "/search?q=", "Full-text + fuzzy search"],
                    ["POST", "/folders", "Create a folder (name + color)"],
                    ["PATCH", "/folders/{id}", "Rename / recolor a folder"],
                    ["POST", "/aliases", "Create a link to a file OR folder"],
                    ["PATCH", "/aliases/{id}", "Rename or repoint a link"],
                    ["GET", "/aliases", "List your links"],
                    ["GET", "/public/{user}/{slug}/list", "Browse a shared folder (public)"],
                  ].map(([m, p, d]) => (
                    <tr key={`${m} ${p}`} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1 pr-4 text-indigo-600">{m}</td>
                      <td className="py-1 pr-4">{p}</td>
                      <td className="py-1 font-sans text-zinc-600">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Upload &amp; replace</h3>
            <p className="mt-1 text-zinc-600">
              Uploads are multipart. Replacing a file keeps its permanent link and every
              existing version — the alias simply serves the newest one.
            </p>
            <CodeBlock>{`# Upload
curl -X POST ${base}/files \\
  -H "Authorization: Bearer byosk_..." \\
  -F "file=@report.pdf"

# Replace (link stays identical, version bumps)
curl -X PUT ${base}/files/FILE_ID \\
  -H "Authorization: Bearer byosk_..." \\
  -F "file=@report-v2.pdf"`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Links &amp; folder sharing</h3>
            <p className="mt-1 text-zinc-600">
              A link (alias) targets <em>either</em> a file or a folder. File links stream
              the current version inline at <code>/{"{username}"}/{"{slug}"}</code>. Folder
              links resolve to a browsable public page; its contents are readable
              unauthenticated via the <code>/public</code> endpoints.
            </p>
            <CodeBlock>{`# Share a file (permanent link that survives replacement)
curl -X POST ${base}/aliases \\
  -H "Authorization: Bearer byosk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"slug": "resume", "file_id": "FILE_ID"}'

# Share a folder (browsable page)
curl -X POST ${base}/aliases \\
  -H "Authorization: Bearer byosk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"slug": "design-assets", "folder_id": "FOLDER_ID"}'

# Browse a shared folder — no auth
curl ${base}/public/USERNAME/design-assets/list`}</CodeBlock>
          </div>

          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Webhooks</h3>
            <p className="mt-1 text-zinc-600">
              Register an endpoint below to receive <code>file.created</code>,{" "}
              <code>file.replaced</code>, and <code>file.deleted</code> events. Each
              delivery is signed with your webhook secret in the{" "}
              <code>X-BYOS-Signature</code> header (HMAC-SHA256 of the raw body) — verify it
              before trusting the payload.
            </p>
            <CodeBlock>{`POST https://your-app.com/webhook
X-BYOS-Signature: sha256=...

{
  "event": "file.replaced",
  "file_id": "…",
  "version_no": 3,
  "occurred_at": "2026-07-06T10:00:00Z"
}`}</CodeBlock>
          </div>

          {interactiveDocs ? (
            <p className="text-xs text-zinc-400">
              Full schemas, response bodies, and every parameter are in the{" "}
              <a href={api.docsUrl()} target="_blank" rel="noreferrer" className="underline">
                interactive API reference
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function DeveloperPanel() {
  return (
    <div className="space-y-6 pt-2">
      <h1 className="text-2xl font-normal text-zinc-800 dark:text-zinc-200">Developer</h1>
      <DocsSection />
      <ApiKeysSection />
      <WebhooksSection />
    </div>
  );
}
