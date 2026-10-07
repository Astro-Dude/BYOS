"use client";

import {
  ApiError,
  type ApiKeyItem,
  type WebhookItem,
} from "@byos/api-client";
import { useCallback, useEffect, useState } from "react";

import { Endpoint, Terminal } from "@/components/dashboard/terminal";
import { Segmented } from "@/components/settings/controls";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { MAX_ACTIVE_API_KEYS, MAX_WEBHOOKS } from "@/lib/limits";

const EVENT_TYPES = ["file.created", "file.replaced", "file.deleted"];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const SCOPE_GROUPS = [
  { resource: "files", label: "Files" },
  { resource: "folders", label: "Folders" },
  { resource: "aliases", label: "Links" },
] as const;

const EXPIRY_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: "never", label: "Never", days: null },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "365", label: "1 year", days: 365 },
];

type Access = "none" | "read" | "write";

// The pickers are the ones Settings uses; on this grey card their track is
// white so the choice still stands out.
const ON_CARD = "[&_[role=radiogroup]]:bg-white";

// Long lists scroll in place rather than stretching the page.
const LIST_SCROLL = "thin-scroll max-h-[min(32rem,60vh)] overflow-y-auto pr-2";

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

  const accessOf = (resource: string): Access =>
    scopes.has(`${resource}:write`) ? "write" : scopes.has(`${resource}:read`) ? "read" : "none";
  // Write includes read, so "Read and write" grants both scopes.
  const setAccess = (resource: string, access: Access) =>
    setScopes((prev) => {
      const next = new Set(prev);
      next.delete(`${resource}:read`);
      next.delete(`${resource}:write`);
      if (access !== "none") next.add(`${resource}:read`);
      if (access === "write") next.add(`${resource}:write`);
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

  // Expired keys stay listed but don't count toward the limit (the API agrees).
  const counted = keys.filter(
    (k) => !k.expires_at || new Date(k.expires_at) > new Date(),
  ).length;
  const full = counted >= MAX_ACTIVE_API_KEYS;
  const canCreate = !busy && !full && name.trim().length > 0 && scopes.size > 0;
  const active = keys;

  return (
    <div className="grid items-start gap-10 xl:grid-cols-2">
      <div>
        <h2 className="type-heading-sm">Your keys</h2>
        <p className="mt-4 text-[1.0625rem] leading-[1.4] text-zinc-600">
          Each key carries its own permissions and expiry, so a key handed to a script reaches
          exactly that script&apos;s job and nothing else.
        </p>

        {/* Existing keys read as a hairline list, newest first — the same rhythm
            as the endpoint reference above. */}
        {active.length > 0 ? (
          <ul className={`mt-8 ${LIST_SCROLL}`}>
            {active.map((key) => (
              <li key={key.id} className="group border-b border-zinc-200 py-4">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-[1rem] text-zinc-900">
                    {key.name}
                  </span>
                  <button
                    onClick={() => revoke(key.id)}
                    className="shrink-0 text-[0.8125rem] text-zinc-400 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    Revoke
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <code className="font-mono text-[0.8125rem] text-zinc-500">
                    byosk_{key.prefix}…
                  </code>
                  <span className="text-[0.8125rem] text-zinc-400">
                    created {shortDate(key.created_at)}
                  </span>
                  {key.expires_at ? (
                    <span className="text-[0.8125rem] text-zinc-400">
                      expires {shortDate(key.expires_at)}
                    </span>
                  ) : null}
                  {key.last_used_at ? (
                    <span className="text-[0.8125rem] text-zinc-400">
                      last used {shortDate(key.last_used_at)}
                    </span>
                  ) : null}
                </div>
                {key.scopes && key.scopes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {key.scopes.map((sc) => (
                      <span
                        key={sc}
                        className="rounded-full border border-zinc-200 px-2.5 py-0.5 font-mono text-[0.6875rem] text-zinc-600"
                      >
                        {sc}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[0.8125rem] text-amber-600">full access (legacy key)</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-label mt-8">No active keys yet.</p>
        )}

      </div>

      {/* The form is one flat mist card. Scopes and expiry are chips rather than
          checkboxes and a native select: they share the pill geometry used
          everywhere else, and the whole choice is visible at a glance. */}
      <div className="surface-card p-7 xl:sticky xl:top-6">
        <p className="type-label">New key</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canCreate && create()}
          placeholder="Name, e.g. CI or laptop"
          className="field mt-3 bg-white"
        />

        <p className="type-label mt-7">Permissions</p>
        <p className="mt-1 text-[0.9375rem] text-zinc-600">Grant only what this key needs.</p>
        <div className={`mt-4 space-y-3 ${ON_CARD}`}>
          {SCOPE_GROUPS.map((g) => (
            <div key={g.resource} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.9375rem] text-zinc-900">{g.label}</span>
              <Segmented<Access>
                label={`${g.label} access`}
                value={accessOf(g.resource)}
                onChange={(v) => setAccess(g.resource, v)}
                options={[
                  { value: "none", label: "None" },
                  { value: "read", label: "Read" },
                  { value: "write", label: "Read and write" },
                ]}
              />
            </div>
          ))}
        </div>

        <p className="type-label mt-7">Expires</p>
        <div className={`mt-3 ${ON_CARD}`}>
          <Segmented
            label="Expires"
            value={EXPIRY_OPTIONS.find((o) => o.days === expiryDays)?.value ?? "never"}
            onChange={(v) => setExpiryDays(EXPIRY_OPTIONS.find((o) => o.value === v)?.days ?? null)}
            options={EXPIRY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>

        <button
          onClick={create}
          disabled={!canCreate}
          className="pill-filled mt-7 w-full disabled:bg-transparent disabled:text-zinc-400 disabled:ring-1 disabled:ring-inset disabled:ring-zinc-200"
        >
          {busy ? "Creating…" : "Create key"}
        </button>
        <p className="mt-3 text-center text-[0.8125rem] text-zinc-500">
          {full
            ? `You have ${MAX_ACTIVE_API_KEYS} active keys. Revoke one to make another.`
            : `${counted} of ${MAX_ACTIVE_API_KEYS} active keys`}
        </p>
        {error ? <p className="mt-3 text-[0.9375rem] text-red-600">{error}</p> : null}

        {/* Shown once, so it gets the accent surface — this is the moment that
            matters on the page. */}
        {freshKey ? (
          <div className="surface-blush mt-5 p-5">
            <p className="text-[0.8125rem]">Copy this now. It won&apos;t be shown again.</p>
            <code className="mt-3 block break-all font-mono text-[0.8125rem]">{freshKey}</code>
            <div className="mt-4 flex items-center gap-4">
              <button onClick={copyKey} className="text-[0.9375rem] underline underline-offset-2">
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={() => setFreshKey(null)}
                className="text-[0.9375rem] opacity-60 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RevealSecret({ secret }: { secret: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — reveal and select instead */
    }
  };

  return (
    <div className="mt-2 flex items-baseline gap-3">
      <span className="type-label">Signing secret</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-zinc-600">
        {shown ? secret : "•".repeat(24)}
      </code>
      <button
        onClick={() => setShown((v) => !v)}
        className="shrink-0 text-[0.8125rem] text-zinc-500 hover:text-zinc-900"
      >
        {shown ? "Hide" : "Reveal"}
      </button>
      <button
        onClick={() => void copy()}
        className="shrink-0 text-[0.8125rem] text-zinc-500 hover:text-zinc-900"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
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

  const fullHooks = hooks.length >= MAX_WEBHOOKS;
  const canAdd = !busy && !fullHooks && url.trim().length > 0;

  return (
    <div className="grid items-start gap-10 xl:grid-cols-2">
      <div>
        <h2 className="type-heading-sm">Your webhooks</h2>
        <p className="mt-4 text-[1.0625rem] leading-[1.4] text-zinc-600">
          We send a signed POST when files change. Each webhook&apos;s secret stays visible here.
        </p>

        {hooks.length > 0 ? (
          <ul className={`mt-8 ${LIST_SCROLL}`}>
            {hooks.map((hook) => (
              <li key={hook.id} className="group border-b border-zinc-200 py-4">
                <div className="flex items-baseline gap-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-[0.9375rem] text-zinc-900">
                    {hook.url}
                  </code>
                  <button
                    onClick={() => remove(hook.id)}
                    className="shrink-0 text-[0.8125rem] text-zinc-400 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {/* Made with nothing picked, a webhook is stored as ["*"]. */}
                  {(hook.events.length && !hook.events.includes("*") ? hook.events : ["all events"]).map((event) => (
                    <span
                      key={event}
                      className="rounded-full border border-zinc-200 px-2.5 py-0.5 font-mono text-[0.6875rem] text-zinc-600"
                    >
                      {event}
                    </span>
                  ))}
                </div>
                <RevealSecret secret={hook.secret} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-label mt-8">No webhooks yet.</p>
        )}
      </div>

      <div className="surface-card p-7 xl:sticky xl:top-6">
        <p className="type-label">New endpoint</p>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canAdd && create()}
          placeholder="https://your-app.com/webhooks/byos"
          className="field mt-3 bg-white font-mono text-[0.875rem]"
        />

        <p className="type-label mt-7">Events</p>
        <p className="mt-1 text-[0.9375rem] text-zinc-600">Choose none to receive all of them.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {EVENT_TYPES.map((event) => {
            const on = events.includes(event);
            return (
              <button
                key={event}
                type="button"
                onClick={() => toggleEvent(event)}
                aria-pressed={on}
                className={on ? "chip-active font-mono" : "chip font-mono"}
              >
                {event}
              </button>
            );
          })}
        </div>

        <button
          onClick={create}
          disabled={!canAdd}
          className="pill-filled mt-7 w-full disabled:bg-transparent disabled:text-zinc-400 disabled:ring-1 disabled:ring-inset disabled:ring-zinc-200"
        >
          {busy ? "Adding…" : "Add endpoint"}
        </button>
        <p className="mt-3 text-center text-[0.8125rem] text-zinc-500">
          {fullHooks
            ? `You have ${MAX_WEBHOOKS} webhooks. Delete one to add another.`
            : `${hooks.length} of ${MAX_WEBHOOKS} webhooks`}
        </p>
        {error ? <p className="mt-3 text-[0.9375rem] text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: "quickstart", label: "Quickstart" },
  { id: "auth", label: "Authentication" },
  { id: "scopes", label: "Scopes & safety" },
  { id: "endpoints", label: "Endpoints" },
  { id: "webhooks-doc", label: "Webhooks" },
  { id: "keys", label: "Your keys" },
  { id: "hooks", label: "Your webhooks" },
];

function DocNav() {
  const [active, setActive] = useState(SECTIONS[0]?.id ?? "");

  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-12% 0px -70% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="hidden w-48 shrink-0 lg:block">
      <div className="sticky top-6 space-y-0.5">
        <p className="type-label mb-3 px-3.5">On this page</p>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={active === s.id ? "nav-item-active" : "nav-item"}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/** A documentation section.
 *
 *  `aside` switches it to the landing page's rhythm: prose on one side, product
 *  artifacts on the other, sticky so the example stays put while you read past
 *  it. Without an aside the section runs full width — right for a reference
 *  table, wrong for a paragraph, which is why the two are separate cases.
 */
function DocSection({
  id,
  title,
  intro,
  children,
  aside,
  flip = false,
}: {
  id: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  children?: React.ReactNode;
  aside?: React.ReactNode;
  /** Put the aside on the left instead, so consecutive sections alternate. */
  flip?: boolean;
}) {
  const head = (
    <>
      <h2 className="type-heading-sm">{title}</h2>
      {intro ? (
        <p className="mt-4 text-[1.0625rem] leading-[1.4] text-zinc-600">{intro}</p>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </>
  );

  if (!aside) {
    return (
      <section
        id={id}
        className="scroll-mt-6 border-t border-zinc-200 pt-10 first:border-0 first:pt-0"
      >
        <div className="max-w-2xl">{head}</div>
      </section>
    );
  }

  return (
    <section
      id={id}
      className="scroll-mt-6 border-t border-zinc-200 pt-10 first:border-0 first:pt-0"
    >
      <div className="grid items-start gap-10 xl:grid-cols-2">
        <div className={flip ? "xl:order-2" : undefined}>{head}</div>
        <div className={`min-w-0 xl:sticky xl:top-6 ${flip ? "xl:order-1" : ""}`}>{aside}</div>
      </div>
    </section>
  );
}

/** Asides stack in a plain column. No overlap: these are mostly ink terminals,
 *  and dark-on-dark overlap reads as a broken corner rather than depth — the
 *  landing hero gets away with it because those artifacts are white cards with
 *  shadows to separate them. */
function Stack({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

const FILE_ENDPOINTS: [string, string, string][] = [
  ["GET", "/files", "List files (paged, filterable)"],
  ["POST", "/files", "Upload a file"],
  ["GET", "/files/{id}/content", "Download the bytes"],
  ["POST", "/files/{id}/replace", "Replace it, keeping history"],
  ["PATCH", "/files/{id}", "Rename"],
  ["POST", "/files/{id}/move", "Move to a folder"],
  ["DELETE", "/files/{id}", "Delete permanently"],
  ["GET", "/files/search", "Search by name, extension and type"],
];

const OTHER_ENDPOINTS: [string, string, string][] = [
  ["GET", "/folders", "List folders in a parent"],
  ["POST", "/folders", "Create a folder"],
  ["GET", "/aliases", "List permanent links"],
  ["POST", "/aliases", "Create a permanent link"],
  ["PATCH", "/aliases/{id}", "Point a link at another file"],
];

/** The API reference. Laid out like the landing page rather than as a stack of
 *  full-width blocks: prose one side, working examples the other, alternating so
 *  the eye keeps moving down the page. */
function DocsSection() {
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

  const keysLink = (
    <a href="#keys" className="text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
      Your keys
    </a>
  );

  return (
    <div className="space-y-14">
      <DocSection
        id="quickstart"
        title={
          <>
            Talk to your drive in <span className="type-em">three lines</span>.
          </>
        }
        intro={
          <>
            Create a key in {keysLink} below and you can call every endpoint with curl. It&apos;s
            plain REST and JSON.
          </>
        }
        aside={
          <Terminal
            title="quickstart"
            lines={[
              { kind: "comment", text: "# 1. Your key, from 'Your keys' below" },
              { kind: "cmd", text: `export BYOS=${base}` },
              { kind: "cmd", text: "export KEY=byosk_your_key_here" },
              { kind: "comment", text: "" },
              { kind: "comment", text: "# 2. List your drive" },
              { kind: "cmd", text: "curl -s $BYOS/files \\" },
              { kind: "cont", text: '-H "Authorization: Bearer $KEY" | jq \'.[0]\'' },
              { kind: "out", text: "{" },
              { kind: "out", text: '  "id": "0c6114be-db77-4501-9c28-770423dc48aa",' },
              { kind: "out", text: '  "name": "Q3 Report.pdf",' },
              { kind: "out", text: '  "size": 1248322,' },
              { kind: "out", text: '  "provider": "telegram"' },
              { kind: "out", text: "}" },
              { kind: "comment", text: "" },
              { kind: "comment", text: "# 3. Upload a file" },
              { kind: "cmd", text: "curl -s $BYOS/files \\" },
              { kind: "cont", text: '-H "Authorization: Bearer $KEY" \\' },
              { kind: "cont", text: "-F file=@report.pdf" },
            ]}
          />
        }
      >
        <p className="type-label">Getting a key</p>
        <ol className="mt-3 space-y-2.5">
          {[
            <>Open {keysLink} below.</>,
            <>Name it, pick its scopes, and set an expiry if you want one.</>,
            <>
              Copy the key. It starts with <code>byosk_</code>.
            </>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-[1rem] leading-[1.5] text-zinc-600">
              <span className="shrink-0 font-mono text-[0.8125rem] text-zinc-400">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {interactiveDocs ? (
          <a href={api.docsUrl()} target="_blank" rel="noreferrer" className="link-arrow mt-6">
            Interactive reference ↗
          </a>
        ) : (
          <p className="type-label mt-6">
            The interactive reference is off in production. Use this page instead.
          </p>
        )}
      </DocSection>

      <DocSection
        id="auth"
        flip
        title="Authentication"
        intro={
          <>
            Send your API key as a bearer token with every request. You can only create keys
            in {keysLink} below.
          </>
        }
        aside={
          <Stack>
            <Terminal
              title="authorization"
              lines={[
                { kind: "cmd", text: "curl $BYOS/files \\" },
                { kind: "cont", text: '-H "Authorization: Bearer byosk_…"' },
                { kind: "comment", text: "" },
                { kind: "comment", text: "# missing or wrong key" },
                { kind: "out", text: '401  {"detail": "Not authenticated"}' },
                { kind: "comment", text: "# outside the key\'s scopes" },
                { kind: "out", text: '403  {"detail": "API key is missing the required scope: files:write"}' },
              ]}
            />
            <div className="surface-card p-6">
              <p className="type-label">Shown once</p>
              <p className="mt-3 text-[1rem] leading-[1.5] text-zinc-600">
                The full key appears only at creation. Afterwards BYOS keeps a hash and the short
                prefix, so the list can identify a key without being able to reveal it.
              </p>
              <p className="mt-3 text-[1rem] leading-[1.5] text-zinc-600">
                Lost it? It can&apos;t be recovered. Revoke it and create a new one. Revoking
                works right away.
              </p>
            </div>
          </Stack>
        }
      >
        <p className="text-[1rem] leading-[1.5] text-zinc-600">
          Send it on every request as <code>Authorization: Bearer …</code>. A wrong or missing key
          is a <code>401</code>; a valid key reaching outside its scopes is a <code>403</code>, so
          the two failures are easy to tell apart in logs.
        </p>
      </DocSection>

      <DocSection
        id="scopes"
        title="Scopes & safety"
        intro="A key only reaches what you grant it. Scopes pair a resource with an access level, and write implies read."
        aside={
          <Stack>
            <div className="surface-card p-6">
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
                {SCOPE_GROUPS.map((g) => (
                  <div key={g.resource}>
                    <p className="type-label">{g.label}</p>
                    <p className="mt-2 font-mono text-[0.8125rem] text-zinc-900">
                      {g.resource}:read
                    </p>
                    <p className="font-mono text-[0.8125rem] text-zinc-900">{g.resource}:write</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="surface-blush p-6">
              <p className="text-[0.8125rem]">Deliberate limitation</p>
              <p className="mt-2 text-[1rem] leading-[1.45]">
                Keys can&apos;t manage your account or use Bao. Creating keys, webhooks, storage,
                your username and the assistant all need you to be logged in, so a leaked key
                can&apos;t do more than it was given.
              </p>
            </div>
          </Stack>
        }
      >
        <p className="text-[1rem] leading-[1.5] text-zinc-600">
          A call outside a key&apos;s scopes returns <code>403</code>. Keys are rate-limited
          individually and can carry an expiry, so a key handed to a script can be scoped to
          exactly that script&apos;s job and expire on its own.
        </p>
      </DocSection>

      {/* Full width: a reference reads better as two columns than as one long
          list squeezed beside prose. */}
      <DocSection id="endpoints" title="Endpoints" />
      <div className="-mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <div>
          <p className="type-label">Files</p>
          <div className="mt-3">
            {FILE_ENDPOINTS.map(([m, path, desc]) => (
              <Endpoint key={m + path} method={m} path={path}>
                {desc}
              </Endpoint>
            ))}
          </div>
        </div>
        <div>
          <p className="type-label">Folders &amp; links</p>
          <div className="mt-3">
            {OTHER_ENDPOINTS.map(([m, path, desc]) => (
              <Endpoint key={m + path} method={m} path={path}>
                {desc}
              </Endpoint>
            ))}
          </div>
        </div>
      </div>

      <DocSection
        id="webhooks-doc"
        flip
        title="Webhooks"
        intro="Register a URL and BYOS posts there when files change. Every delivery is signed, so you can verify it came from us."
        aside={
          <Terminal
            title="verify a delivery"
            lines={[
              { kind: "comment", text: "# what we send" },
              { kind: "out", text: "POST /your-endpoint" },
              { kind: "out", text: "X-BYOS-Signature: sha256=9f86d081…" },
              { kind: "out", text: '{"event": "file.created", …}' },
              { kind: "comment", text: "" },
              { kind: "comment", text: "# recompute with your signing secret" },
              { kind: "cmd", text: 'printf "$BODY" \\' },
              { kind: "cont", text: "| openssl dgst -sha256 \\" },
              { kind: "cont", text: '  -hmac "$BYOS_WEBHOOK_SECRET"' },
            ]}
          />
        }
      >
        <p className="text-[1rem] leading-[1.5] text-zinc-600">
          Compare with a constant-time equality check and reject anything that doesn&apos;t match.
          Events available today: {EVENT_TYPES.map((e) => <code key={e}>{e} </code>)}
        </p>
        <p className="mt-4 text-[1rem] leading-[1.5] text-zinc-600">
          Each webhook gets a signing secret, which you can view any time in{" "}
          <a href="#hooks" className="text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
            Your webhooks
          </a>
          . Managing webhooks needs you to be logged in, so an API key can&apos;t change them.
        </p>
      </DocSection>
    </div>
  );
}

export function DeveloperPanel() {
  return (
    <div className="pt-2">
      <header className="max-w-2xl">
        <p className="type-label">Developer</p>
        <h1 className="type-heading mt-4">
          The BYOS <span className="type-em">API</span>.
        </h1>
        <p className="mt-5 text-[1.125rem] leading-[1.4] text-zinc-600">
          Your code can do everything the app does: list, upload, replace, move, search and
          update permanent links. Your files stay in your storage.
        </p>
      </header>

      <div className="mt-14 flex gap-12">
        <DocNav />
        <div className="min-w-0 flex-1 space-y-12">
          <DocsSection />
          <section id="keys" className="scroll-mt-6 border-t border-zinc-200 pt-10">
            <ApiKeysSection />
          </section>
          <section id="hooks" className="scroll-mt-6 border-t border-zinc-200 pt-10">
            <WebhooksSection />
          </section>
        </div>
      </div>
    </div>
  );
}
