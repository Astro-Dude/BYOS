"use client";

import { ApiError, type StorageAccount } from "@byos/api-client";
import { AlertTriangle, Clock, ExternalLink, Globe, HelpCircle, KeyRound, Lock, Plus, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Dropdown } from "@/components/byok/dropdown";
import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { Segmented, SettingRow, SettingsGroup, SettingsHeader } from "@/components/settings/controls";
import { StorageIcon, credentialName, inDays, providerName, storageHealth } from "@/components/storage-icon";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { usePreferences } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { formatBytes } from "@/lib/utils";

/** The "None" choice in the default-storage list: ask where each upload goes. */
const NONE = "__ask__";

const label = "mb-1.5 block text-[0.8125rem] text-zinc-500";
const input =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-[0.9375rem] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900";

/** A modal shell for the connect forms. */
function Sheet({
  title,
  subtitle,
  icon,
  onClose,
  children,
}: {
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

/** Connect a repository, or with `existing`, give a storage that stopped
 *  working a new token (same repository, so its files come back). */
function ConnectGitHub({
  existing,
  onClose,
  onDone,
}: {
  existing?: StorageAccount;
  onClose: () => void;
  onDone: (all: StorageAccount[]) => void;
}) {
  const authed = useAuthed();
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState(existing?.label?.split("/")[1] ?? "byos-storage");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      onDone(await authed((t) => api.connectGitHub(t, token.trim(), repo.trim(), visibility === "private")));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : existing ? "Couldn't reconnect GitHub." : "Couldn't connect GitHub.",
      );
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={existing ? "Reconnect GitHub" : "Connect GitHub"}
      subtitle={
        existing
          ? `Add a new token for ${existing.label}. Its files work again as soon as GitHub accepts it.`
          : "Files are kept as release files in a repository you own."
      }
      icon={<StorageIcon provider="github" className="h-5 w-5" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <span className={label}>Personal access token</span>
          <PasswordInput
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_… or github_pat_…"
            autoComplete="off"
          />
          <p className="mt-1.5 text-[0.8125rem] leading-[1.5] text-zinc-500">
            Only the <span className="font-mono">repo</span> scope is needed, and the link ticks it for you.
            GitHub doesn&apos;t let links set the expiry, so pick{" "}
            <span className="text-zinc-900">No expiration</span> there, or you&apos;ll need to reconnect when it
            runs out.{" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=BYOS%20storage"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900"
            >
              Create one <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div>
          <span className={label}>Repository</span>
          <input
            className={`${input} font-mono ${existing ? "cursor-not-allowed bg-zinc-50 text-zinc-500" : ""}`}
            value={existing ? existing.label ?? repo : repo}
            onChange={(e) => setRepo(e.target.value)}
            readOnly={Boolean(existing)}
            spellCheck={false}
          />
          <p className="mt-1.5 text-[0.8125rem] text-zinc-500">
            {existing
              ? "Make the token on the account that owns this repository."
              : "Created if it doesn't exist. An existing one is used as it is."}
          </p>
        </div>
        <div className={existing ? "hidden" : undefined}>
          <span className={label}>Visibility for a new repository</span>
          <Segmented
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: "private", label: <><Lock className="h-3.5 w-3.5" /> Private</> },
              { value: "public", label: <><Globe className="h-3.5 w-3.5" /> Public</> },
            ]}
          />
          {visibility === "public" ? (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[0.8125rem] text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Anyone on the internet could download every file you store there.
            </p>
          ) : null}
        </div>
        <p className="text-[0.8125rem] leading-[1.5] text-zinc-500">
          GitHub isn&apos;t meant for general file hosting, so very heavy use may get the account flagged.
          The token is encrypted and only used for your files.
        </p>
        {error ? <p className="text-[0.875rem] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="pill-sm-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || token.trim().length < 10 || !repo.trim()}
            className="pill-sm-filled disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

const S3_PRESETS = {
  aws: { label: "AWS S3", endpoint: "", endpointHint: "Leave empty for AWS", region: "us-east-1" },
  r2: {
    label: "Cloudflare R2",
    endpoint: "",
    endpointHint: "https://<account id>.r2.cloudflarestorage.com",
    region: "auto",
  },
  b2: { label: "Backblaze B2", endpoint: "", endpointHint: "https://s3.<region>.backblazeb2.com", region: "" },
  other: { label: "Other", endpoint: "", endpointHint: "https://minio.example.com", region: "" },
} as const;
type Preset = keyof typeof S3_PRESETS;

/** Connect a bucket, or with `existing`, give one that stopped working new
 *  keys (same bucket and folder, so its files come back). */
function ConnectS3({
  existing,
  onClose,
  onDone,
}: {
  existing?: StorageAccount;
  onClose: () => void;
  onDone: (all: StorageAccount[]) => void;
}) {
  const authed = useAuthed();
  const [preset, setPreset] = useState<Preset>(existing ? (existing.endpoint ? "other" : "aws") : "aws");
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? "");
  const [region, setRegion] = useState<string>(existing ? existing.region ?? "" : S3_PRESETS.aws.region);
  const [bucket, setBucket] = useState(existing?.bucket ?? "");
  const [prefix, setPrefix] = useState(existing ? existing.prefix ?? "" : "byos/");
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = S3_PRESETS[preset];
  const needsEndpoint = preset !== "aws";

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      onDone(
        await authed((t) =>
          api.connectS3(t, {
            endpoint: needsEndpoint ? endpoint.trim() : null,
            region: region.trim() || null,
            bucket: bucket.trim(),
            prefix: prefix.trim() || null,
            access_key_id: keyId.trim(),
            secret_access_key: secret.trim(),
          }),
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : existing ? "Couldn't reconnect the bucket." : "Couldn't connect the bucket.",
      );
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={existing ? "Reconnect S3" : "Connect S3"}
      subtitle={
        existing
          ? `Add new keys for ${existing.bucket ?? existing.label}. Its files work again as soon as the bucket accepts them.`
          : "Any S3-compatible bucket: AWS, Cloudflare R2, Backblaze B2, MinIO."
      }
      icon={<StorageIcon provider="s3" className="h-5 w-5" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Segmented<Preset>
          label="Provider"
          value={preset}
          onChange={(next) => {
            setPreset(next);
            setRegion(S3_PRESETS[next].region);
          }}
          options={(Object.keys(S3_PRESETS) as Preset[]).map((k) => ({ value: k, label: S3_PRESETS[k].label }))}
        />
        {needsEndpoint ? (
          <div>
            <span className={label}>Endpoint</span>
            <input className={input} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={p.endpointHint} spellCheck={false} />
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className={label}>Bucket</span>
            <input className={input} value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-files" spellCheck={false} />
          </div>
          <div>
            <span className={label}>Region</span>
            <input className={input} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Optional" spellCheck={false} />
          </div>
        </div>
        <div>
          <span className={label}>Folder in the bucket</span>
          <input className={`${input} font-mono`} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Optional" spellCheck={false} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className={label}>Access key ID</span>
            <input className={`${input} font-mono`} value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" spellCheck={false} />
          </div>
          <div>
            <span className={label}>Secret access key</span>
            <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <p className="text-[0.8125rem] text-zinc-500">
          The keys need to read, write and delete in this bucket. They&apos;re encrypted and only used for your files.
        </p>
        {error ? <p className="text-[0.875rem] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="pill-sm-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || !bucket.trim() || !keyId.trim() || !secret.trim() || (needsEndpoint && !endpoint.trim())}
            className="pill-sm-filled disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Checking the bucket…" : "Connect"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The line under a storage that says whether it needs anything. */
function statusText(s: StorageAccount): { text: string; tone: "ok" | "warn" | "muted" } | null {
  const health = storageHealth(s);
  const what = credentialName(s.provider);
  if (health.state === "ok") {
    return health.expiresAt ? { text: `Token expires ${DATE.format(health.expiresAt)}`, tone: "muted" } : null;
  }
  if (health.state === "expiring") {
    return {
      text: `Token expires ${inDays(health.days)} (${DATE.format(health.expiresAt)}). Add a new one before then to keep things working.`,
      tone: "warn",
    };
  }
  if (health.state === "expired") {
    if (s.provider === "telegram") return { text: "Logged out. Sign in again to reconnect.", tone: "warn" };
    return {
      text: `The ${what} expired or ${what === "keys" ? "were" : "was"} revoked. Its files can't be opened, and uploads go elsewhere, until you reconnect.`,
      tone: "warn",
    };
  }
  return { text: "Disconnected. Connect it again to reach its files.", tone: "warn" };
}

/** One connected storage: what it is, what's on it, and what you can do. */
function StorageCard({
  s,
  onDefault,
  onVisibility,
  onDisconnect,
  onReconnect,
}: {
  s: StorageAccount;
  onDefault: () => void;
  onVisibility: (makePrivate: boolean) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const status = statusText(s);
  const health = storageHealth(s).state;
  const working = s.status === "connected" && health !== "expired";
  // Telegram reconnects by signing in; the others take new credentials here.
  const canReconnect = s.provider !== "telegram" && health !== "ok";
  const detail =
    s.provider === "s3"
      ? [s.endpoint ? s.endpoint.replace(/^https?:\/\//, "") : "AWS", s.region, s.prefix ? `/${s.prefix}` : null]
          .filter(Boolean)
          .join(" · ")
      : null;
  return (
    <div
      className={`flex flex-col gap-4 rounded-2xl border bg-white p-5 sm:flex-row sm:items-center ${
        health === "expired" || health === "disconnected" ? "border-amber-400" : "border-zinc-200"
      }`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800">
        <StorageIcon provider={s.provider} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[0.9375rem] text-zinc-900">{s.label || providerName(s.provider)}</p>
          {s.is_default ? (
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[0.6875rem] text-white">Default</span>
          ) : null}
          {s.provider === "github" && s.private !== null ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[0.6875rem] text-zinc-600">
              {s.private ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
              {s.private ? "Private" : "Public"}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
          {providerName(s.provider)} · {s.files.toLocaleString()} {s.files === 1 ? "file" : "files"} ·{" "}
          {formatBytes(s.bytes)}
          {detail ? ` · ${detail}` : ""}
        </p>
        {status ? (
          <p
            className={`mt-1 flex items-start gap-1.5 text-[0.8125rem] ${
              status.tone === "warn" ? "text-amber-700" : "text-zinc-500"
            }`}
          >
            {status.tone === "warn" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {status.text}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {s.repo_url ? (
          <a href={s.repo_url} target="_blank" rel="noreferrer" className="pill-sm-ghost inline-flex items-center gap-1.5">
            Open <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {canReconnect ? (
          <button type="button" className="pill-sm-filled inline-flex items-center gap-1.5" onClick={onReconnect}>
            <KeyRound className="h-3.5 w-3.5" />
            {health === "expiring" ? `Update ${credentialName(s.provider)}` : "Reconnect"}
          </button>
        ) : null}
        {s.provider === "github" && working ? (
          <button type="button" className="pill-sm-ghost" onClick={() => onVisibility(!s.private)}>
            Make {s.private ? "public" : "private"}
          </button>
        ) : null}
        {!s.is_default && working ? (
          <button type="button" className="pill-sm-ghost" onClick={onDefault}>
            Make default
          </button>
        ) : null}
        {s.provider !== "telegram" && s.status !== "disconnected" ? (
          <button
            type="button"
            className="pill-sm-ghost hover:!border-[rgb(var(--c-danger-600))] hover:!text-[rgb(var(--c-danger-600))]"
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Add-a-storage tile. */
function AddTile({ provider, title, blurb, onClick }: { provider: string; title: string; blurb: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-4 rounded-2xl border border-dashed border-zinc-300 bg-white p-5 text-left transition-colors hover:border-zinc-900 hover:bg-zinc-50"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800 transition-colors group-hover:bg-zinc-900 group-hover:text-white">
        <StorageIcon provider={provider} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] text-zinc-900">{title}</span>
        <span className="block text-[0.8125rem] text-zinc-500">{blurb}</span>
      </span>
      <Plus className="h-4 w-4 shrink-0 text-zinc-400 group-hover:text-zinc-900" />
    </button>
  );
}

export function StorageSettings() {
  const authed = useAuthed();
  const toast = useToast();
  const { prefs, setPrefs } = usePreferences();
  const [storages, setStorages] = useState<StorageAccount[] | null>(null);
  const [adding, setAdding] = useState<"github" | "s3" | null>(null);
  const [reconnecting, setReconnecting] = useState<StorageAccount | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "disconnect"; s: StorageAccount } | { kind: "public"; s: StorageAccount } | null
  >(null);

  const load = useCallback(() => {
    authed((t) => api.listStorage(t))
      .then(setStorages)
      .catch(() => setStorages([]));
  }, [authed]);
  useEffect(load, [load]);

  // Links elsewhere (the Drive's storage card and banner) can open a storage's
  // reconnect sheet straight away with ?reconnect=<id>.
  const [deepLinked, setDeepLinked] = useState(false);
  useEffect(() => {
    if (deepLinked || !storages) return;
    setDeepLinked(true);
    const id = new URLSearchParams(window.location.search).get("reconnect");
    const target = storages.find((s) => s.id === id);
    if (target && target.provider !== "telegram") setReconnecting(target);
  }, [storages, deepLinked]);

  const run = async (work: () => Promise<StorageAccount[]>, done: string) => {
    try {
      setStorages(await work());
      toast(done);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "That didn't work.", "error");
    }
  };

  const connected = (storages ?? []).filter((s) => s.status === "connected" && storageHealth(s).state !== "expired");
  const defaultId = connected.find((s) => s.is_default)?.id ?? connected[0]?.id ?? "";
  const asking = prefs.uploadTarget === "ask";

  return (
    <>
      <SettingsHeader
        title="Storage"
        description="Where your files are kept. Connect as many as you like; the Drive shows files from all of them together."
      />

      <SettingsGroup title="Your storage">
        <div className="space-y-3 py-5">
          {storages === null ? (
            <div className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
          ) : storages.length === 0 ? (
            <p className="text-[0.9375rem] text-zinc-500">Nothing connected yet.</p>
          ) : (
            storages.map((s) => (
              <StorageCard
                key={s.id}
                s={s}
                onDefault={() => void run(() => authed((t) => api.updateStorage(t, s.id, { is_default: true })), "Default storage changed")}
                onVisibility={(makePrivate) =>
                  makePrivate
                    ? void run(() => authed((t) => api.updateStorage(t, s.id, { private: true })), "Repository is now private")
                    : setConfirm({ kind: "public", s })
                }
                onDisconnect={() => setConfirm({ kind: "disconnect", s })}
                onReconnect={() => setReconnecting(s)}
              />
            ))
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Add storage">
        <div className="grid grid-cols-1 gap-3 py-5 md:grid-cols-2">
          <AddTile provider="github" title="GitHub" blurb="A private repository on your account" onClick={() => setAdding("github")} />
          <AddTile provider="s3" title="S3" blurb="AWS, Cloudflare R2, Backblaze B2 or MinIO" onClick={() => setAdding("s3")} />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Uploads">
        <SettingRow
          label="Default storage"
          description={
            asking
              ? "You'll pick where each upload goes."
              : "New uploads go here. Pick None to choose each time."
          }
        >
          <Dropdown
            align="right"
            ariaLabel="Default storage"
            // "None" is the ask-every-time choice. The server still keeps a
            // default underneath, for uploads made through the API.
            value={asking ? NONE : defaultId}
            onChange={(id) => {
              if (id === NONE) {
                setPrefs({ uploadTarget: "ask" });
                return;
              }
              setPrefs({ uploadTarget: "default" });
              if (id !== defaultId) {
                void run(() => authed((t) => api.updateStorage(t, id, { is_default: true })), "Default storage changed");
              }
            }}
            options={[
              {
                value: NONE,
                label: "None",
                hint: "Ask every time",
                icon: <HelpCircle className="h-3.5 w-3.5" />,
              },
              ...connected.map((s) => ({
                value: s.id,
                label: s.label || providerName(s.provider),
                icon: <StorageIcon provider={s.provider} className="h-3.5 w-3.5" />,
                hint: `${providerName(s.provider)} · ${formatBytes(s.bytes)} used`,
              })),
            ]}
            placeholder="None connected"
            className="min-w-[16rem] rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[0.8125rem] text-zinc-900 hover:border-zinc-900"
          />
        </SettingRow>
      </SettingsGroup>

      {adding === "github" ? (
        <ConnectGitHub
          onClose={() => setAdding(null)}
          onDone={(all) => {
            setStorages(all);
            setAdding(null);
            toast("GitHub connected");
          }}
        />
      ) : null}
      {adding === "s3" ? (
        <ConnectS3
          onClose={() => setAdding(null)}
          onDone={(all) => {
            setStorages(all);
            setAdding(null);
            toast("Bucket connected");
          }}
        />
      ) : null}

      {reconnecting?.provider === "github" ? (
        <ConnectGitHub
          existing={reconnecting}
          onClose={() => setReconnecting(null)}
          onDone={(all) => {
            setStorages(all);
            setReconnecting(null);
            toast("GitHub reconnected");
          }}
        />
      ) : null}
      {reconnecting?.provider === "s3" ? (
        <ConnectS3
          existing={reconnecting}
          onClose={() => setReconnecting(null)}
          onDone={(all) => {
            setStorages(all);
            setReconnecting(null);
            toast("Bucket reconnected");
          }}
        />
      ) : null}

      {confirm?.kind === "public" ? (
        <ConfirmModal
          title="Make the repository public?"
          message={`Anyone on the internet could download every file stored in ${confirm.s.label}.`}
          confirmLabel="Make public"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const s = confirm.s;
            setConfirm(null);
            void run(() => authed((t) => api.updateStorage(t, s.id, { private: false })), "Repository is now public");
          }}
        />
      ) : null}
      {confirm?.kind === "disconnect" ? (
        <ConfirmModal
          title={`Disconnect ${providerName(confirm.s.provider)}?`}
          message={
            confirm.s.files > 0
              ? `The ${confirm.s.files.toLocaleString()} files on it stay where they are, but you can't open them in BYOS until you connect ${confirm.s.label} again.`
              : `${confirm.s.label} will be removed from BYOS.`
          }
          confirmLabel="Disconnect"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const s = confirm.s;
            setConfirm(null);
            void run(() => authed((t) => api.disconnectStorage(t, s.id)), "Storage disconnected");
          }}
        />
      ) : null}
    </>
  );
}
