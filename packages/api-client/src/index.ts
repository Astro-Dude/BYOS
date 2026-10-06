// BYOS API client.
//
// Phase 0–2: a small, dependency-free typed wrapper around fetch covering auth,
// storage providers (Telegram connect flow), and the file pipeline. `pnpm
// codegen` generates a full typed client from the live OpenAPI schema into
// ./generated/ (git-ignored). App code imports only from "@byos/api-client".

export interface User {
  id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  is_verified: boolean;
  phone: string | null;
  has_password: boolean;
  /** Granted in the database, or named by the server's break-glass ADMIN_IDS. */
  is_admin: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface TelegramLoginResult {
  status: "code_sent" | "password_needed" | "connected";
  ticket: string | null;
  access_token: string | null;
  token_type: string | null;
  expires_in: number | null;
}

export interface HealthResponse {
  status: string;
  environment: string;
  providers: string[];
}

/** A connected storage (Telegram, GitHub, S3) and what's on it. */
export interface StorageAccount {
  id: string;
  provider: "telegram" | "github" | "s3" | string;
  label: string | null;
  /** "connected", "expired" (Telegram logged out), or "disconnected". */
  status: string;
  is_default: boolean;
  files: number;
  bytes: number;
  repo_url: string | null;
  /** When a GitHub token stops working (ISO); null if it never expires. */
  token_expires_at: string | null;
  private: boolean | null;
  bucket: string | null;
  endpoint: string | null;
  region: string | null;
  prefix: string | null;
}

export interface S3ConnectInput {
  endpoint?: string | null;
  region?: string | null;
  bucket: string;
  prefix?: string | null;
  access_key_id: string;
  secret_access_key: string;
}

export interface ProviderStatus {
  provider: string;
  status: string;
  label: string | null;
}

export interface ConnectResult {
  status: string; // "code_sent" | "password_needed" | "connected"
}

export interface FileItem {
  id: string;
  name: string;
  ext: string | null;
  mime: string | null;
  size: number;
  provider: string;
  /** Which of the user's storages holds it; null on files from before
   *  multi-storage (those are on Telegram). */
  storage_account_id: string | null;
  folder_id: string | null;
  is_favorite: boolean;
  tags: string[];
  created_at: string;
  modified_at: string;
  // Set when the underlying bytes are gone from the provider (deleted directly
  // in Telegram); null while the file is available.
  missing_at: string | null;
}

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
  size: number; // total bytes contained, including nested subfolders
}

export interface Breadcrumb {
  id: string;
  name: string;
}

export interface AliasItem {
  id: string;
  slug: string;
  target_type: "file" | "folder";
  file_id: string | null;
  folder_id: string | null;
  description: string | null;
  created_at: string;
  // File links: the folder the file lives in (go-to-file). Folder links: the
  // shared folder's own id.
  parent_folder_id: string | null;
  target_name: string | null;
}

export interface PublicMeta {
  type: "file" | "folder";
  name: string;
  owner_username: string;
}

export interface PublicEntry {
  id: string;
  name: string;
  type: "folder" | "file";
  size: number | null;
  mime: string | null;
  ext: string | null;
}

export interface PublicCrumb {
  id: string | null;
  name: string;
}

export interface PublicFolderView {
  slug: string;
  owner_username: string;
  root_name: string;
  breadcrumb: PublicCrumb[];
  folders: PublicEntry[];
  files: PublicEntry[];
}

export interface VersionItem {
  id: string;
  version_no: number;
  size: number;
  hash: string | null;
  created_at: string;
  is_current: boolean;
}

export interface ShareItem {
  id: string;
  file_id: string;
  token: string;
  expires_at: string | null;
  download_count: number;
  created_at: string;
}

export interface ShareInput {
  file_id: string;
  expires_in_days?: number;
}

/** Platform-wide analytics. Admin only — the endpoint 404s for everyone else. */
export interface PlatformStats {
  generated_at: string;
  window_days: number;
  totals: {
    users: number;
    files: number;
    folders: number;
    bytes: number;
    aliases: number;
    shares: number;
    api_keys: number;
    webhooks: number;
    ai_keys: number;
    conversations: number;
    indexed_chunks: number;
  };
  signups: { day: string; value: number }[];
  uploads: { day: string; value: number }[];
  types: { ext: string; count: number; bytes: number }[];
  sizes: { bucket: string; count: number }[];
  hours: { hour: number; value: number }[];
  actions: { action: string; count: number }[];
  top_users: { label: string; bytes: number; files: number }[];
  growth: { day: string; value: number }[];
  active: { day: string; value: number }[];
  providers: { label: string; count: number; bytes: number }[];
  /** Connected storage accounts per provider, across all users. */
  storage_accounts?: { label: string; count: number }[];
  versions: { total: number; versioned_files: number; revisions: number };
  shares_by_kind: { label: string; count: number; bytes: number }[];
  aliases_by_kind: { label: string; count: number; bytes: number }[];
  duplicates: { groups: number; reclaimable_bytes: number };
  index_coverage: { indexed: number; files: number };
  tags: { label: string; count: number; bytes: number }[];
  /** Distinct people active (an audited action or a question to Bao). */
  engagement?: { dau: number; wau: number; mau: number };
  /** How far accounts get, from signing up to applying one of Bao's plans. */
  funnel?: { label: string; count: number }[];
  assistant?: {
    questions: { day: string; value: number }[];
    plans_applied: { day: string; value: number }[];
    plans_by_status: { label: string; count: number }[];
    changes: { ok: number; failed: number; undone: number };
    change_kinds: { label: string; count: number }[];
    providers: { label: string; count: number }[];
    /** Models set on keys, each with its provider (from the key's API address). */
    models: { label: string; count: number; provider: string }[];
  };
  /** Storage connections by state ("connected", "expired", …). */
  storage_status?: { label: string; count: number }[];
}

/** One row of the managed admin list. */
export interface AdminRow {
  id: string;
  username: string | null;
  phone: string | null;
  /** Has the database flag. */
  granted: boolean;
  /** Named by ADMIN_IDS — cannot be revoked in-app. */
  bootstrap: boolean;
}

export interface AnalyticsOverview {
  storage_bytes: number;
  file_count: number;
  alias_count: number;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[] | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated {
  key: string; // plaintext — shown only once
  api_key: ApiKeyItem;
}

export interface WebhookItem {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  created_at: string;
}

export interface AuditItem {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
}

export interface DuplicateGroup {
  hash: string;
  files: FileItem[];
}

export interface AiKey {
  id: string;
  name: string;
  base_url: string;
  model: string;
  embedding_model: string | null;
  temperature: number;
  max_tokens: number;
  top_p: number | null;
  /** How hard a reasoning model thinks; null is automatic (its lowest). */
  reasoning_effort: ReasoningEffort | null;
  /** What the model takes, when saving just tested it (a new key or model). */
  check?: ModelCheck | null;
}

export interface AiKeyInput {
  name: string;
  base_url: string;
  model: string;
  api_key?: string; // required on create; omit on update to keep the stored key
  embedding_model?: string | null;
  temperature: number;
  max_tokens: number;
  top_p?: number | null;
  reasoning_effort?: ReasoningEffort | null;
}

/** The models a key can use. */
export interface ProviderModels {
  models: string[];
}

/** What one test request found out about a model. `unsupported` lists the
 *  sampling settings it refuses ("temperature", "top_p"). */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelCheck {
  unsupported: string[];
  /** Reasoning effort levels the model takes, lowest first; empty if none. */
  efforts: ReasoningEffort[];
}

export interface AiPrompt {
  id: string;
  name: string;
  content: string;
}

/** Settings for /organize. Defaults: no renaming, existing folders kept, no tags. */
export interface OrganizeOptions {
  rename: boolean;
  group_by: "auto" | "topic" | "type" | "year";
  /** The most levels of folders; null leaves it to the agent (up to 3). */
  depth: 1 | 2 | 3 | null;
  keep_existing: boolean;
  read_contents: boolean;
  tags: boolean;
}

/** Chat add-ons: retrieval strategies, plus showing the answer's working. */
export interface RagStrategies {
  rewrite: boolean;
  hyde: boolean;
  rerank: boolean;
  crag: boolean;
  /** The answer comes with its steps and calculations. Optional for older callers. */
  reasoning?: boolean;
}

export interface IndexStatus {
  indexed_file_ids: string[];
  total: number;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/** How much the agent may do unattended in one turn. Mirrors the API's Mode. */
export type AgentMode = "read_only" | "ask" | "auto" | "full";

export interface AgentAction {
  op: string;
  label: string;
  danger: boolean;
  /** True when this change ran during the turn instead of waiting for a click. */
  auto: boolean;
  /** null while the action is still awaiting confirmation. */
  result: { ok: boolean; detail: string } | null;
}

/** A file in a plan preview: its name once the plan runs, its old name if it
 *  is renamed, the folder it comes from if it moves, and tag and star changes. */
export interface PreviewFile {
  name: string;
  was: string | null;
  from: string | null;
  tags_added: string[];
  tags_removed: string[];
  /** true starred, false unstarred, null untouched. */
  star: boolean | null;
}

/** A folder in a plan preview. `new` folders are created by the plan; `was` is
 *  a folder's old name; `more` counts files beyond those listed. */
export interface PreviewFolder {
  name: string;
  new: boolean;
  was: string | null;
  moved: boolean;
  files: PreviewFile[];
  more: number;
  children: PreviewFolder[];
}

/** The drive's shape once a plan is applied, for plans that create or move. */
export interface PlanPreview {
  /** Loose files at the top of the drive the plan leaves there (often missed). */
  untouched: string[];
  untouched_more: number;
  new_folders: number;
  moved: number;
  renamed: number;
  tagged: number;
  starred: number;
  root: PreviewFolder;
}

export interface AgentPlan {
  id: string;
  status: "pending" | "applied" | "discarded" | "undone";
  actions: AgentAction[];
  created_at: string;
}

export interface AgentApplyResult {
  plan_id: string;
  status: string;
  applied: number;
  failed: number;
  actions: AgentAction[];
}

export interface AiConversation {
  id: string;
  title: string;
  updated_at: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    /** Machine-readable error code from the API body, when present
     *  (e.g. "telegram_session_expired"). */
    public code?: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

interface RequestInitWithToken extends RequestInit {
  token?: string;
}

export class ByosClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init: RequestInitWithToken = {}): Promise<T> {
    const { token, headers, ...rest } = init;
    const isForm = rest.body instanceof FormData;
    const res = await fetch(`${this.baseUrl}${path}`, {
      credentials: "include", // send/receive the httpOnly refresh cookie
      headers: {
        // Let the browser set the multipart boundary for FormData.
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...rest,
    });

    if (!res.ok) {
      let detail = res.statusText;
      let code: string | undefined;
      try {
        const body = (await res.json()) as { detail?: string; code?: string };
        if (body?.detail) detail = body.detail;
        if (body?.code) code = body.code;
      } catch {
        // non-JSON error body; keep statusText
      }
      throw new ApiError(res.status, detail, code);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  telegramStart(phone: string): Promise<TelegramLoginResult> {
    return this.request<TelegramLoginResult>("/auth/telegram/start", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  }

  /** Begin sign-up: reserves the username + carries the password in the OTP
   *  ticket. The account is created only when the OTP verifies (telegramVerify
   *  / telegramPassword), so nothing is stored until then. */
  telegramSignup(phone: string, username: string, password: string): Promise<TelegramLoginResult> {
    return this.request<TelegramLoginResult>("/auth/telegram/signup", {
      method: "POST",
      body: JSON.stringify({ phone, username, password }),
    });
  }

  /** Forgot password: sends a Telegram code and carries the new password in the
   *  OTP ticket. It is applied only when the code verifies (telegramVerify /
   *  telegramPassword), so nothing changes until Telegram confirms the phone. */
  resetPassword(phone: string, password: string): Promise<TelegramLoginResult> {
    return this.request<TelegramLoginResult>("/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    });
  }

  telegramVerify(ticket: string, code: string): Promise<TelegramLoginResult> {
    return this.request<TelegramLoginResult>("/auth/telegram/verify", {
      method: "POST",
      body: JSON.stringify({ ticket, code }),
    });
  }

  telegramPassword(ticket: string, password: string): Promise<TelegramLoginResult> {
    return this.request<TelegramLoginResult>("/auth/telegram/password", {
      method: "POST",
      body: JSON.stringify({ ticket, password }),
    });
  }

  refresh(): Promise<TokenResponse> {
    return this.request<TokenResponse>("/auth/refresh", { method: "POST" });
  }

  logout(): Promise<void> {
    return this.request<void>("/auth/logout", { method: "POST" });
  }

  me(token: string): Promise<User> {
    return this.request<User>("/auth/me", { token });
  }

  setUsername(token: string, username: string): Promise<User> {
    return this.request<User>("/auth/username", {
      method: "POST",
      token,
      body: JSON.stringify({ username }),
    });
  }

  /** Update the account's display name (shown across the app). */
  setDisplayName(token: string, displayName: string): Promise<User> {
    return this.request<User>("/auth/display-name", {
      method: "POST",
      token,
      body: JSON.stringify({ display_name: displayName }),
    });
  }

  /** Set or change the account password (requires an interactive session).
   *  Pass currentPassword when changing an existing one. */
  setPassword(token: string, password: string, currentPassword?: string): Promise<User> {
    return this.request<User>("/auth/password", {
      method: "POST",
      token,
      body: JSON.stringify({ password, current_password: currentPassword ?? null }),
    });
  }

  /** Log in with username-or-phone + password, skipping the Telegram OTP flow. */
  passwordLogin(identifier: string, password: string): Promise<TelegramLoginResult> {
    return this.request<TelegramLoginResult>("/auth/login/password", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });
  }

  /** Platform analytics. 404s unless the caller is an admin. */
  adminOverview(token: string): Promise<PlatformStats> {
    return this.request<PlatformStats>("/admin/overview", { token });
  }

  /** The managed admin list. */
  listAdmins(token: string): Promise<AdminRow[]> {
    return this.request<AdminRow[]>("/admin/admins", { token });
  }

  /** Promote by username or phone (phones match digits-only by suffix). */
  grantAdmin(token: string, identifier: string): Promise<AdminRow> {
    return this.request<AdminRow>("/admin/admins", {
      method: "POST",
      token,
      body: JSON.stringify({ identifier }),
    });
  }

  revokeAdmin(token: string, userId: string): Promise<void> {
    return this.request<void>(`/admin/admins/${userId}`, { method: "DELETE", token });
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  /** Public base URL of the API (e.g. for docs/examples). */
  get apiBase(): string {
    return this.baseUrl;
  }

  /** Interactive API docs (OpenAPI/Swagger UI) served by the API. */
  docsUrl(): string {
    return `${this.baseUrl}/docs`;
  }

  // ── Storage providers (Telegram) ─────────────────────────────────────────
  listProviders(token: string): Promise<ProviderStatus[]> {
    return this.request<ProviderStatus[]>("/providers", { token });
  }

  // ── Storage accounts ──────────────────────────────────────────────────────
  listStorage(token: string): Promise<StorageAccount[]> {
    return this.request<StorageAccount[]>("/providers/accounts", { token });
  }

  /** Connect a GitHub repo as storage. The repo is created if it doesn't exist
   *  (private unless `isPrivate` is false). Returns every storage. */
  connectGitHub(
    token: string,
    githubToken: string,
    repo: string,
    isPrivate: boolean,
  ): Promise<StorageAccount[]> {
    return this.request<StorageAccount[]>("/providers/github", {
      method: "POST",
      token,
      body: JSON.stringify({ token: githubToken, repo, private: isPrivate }),
    });
  }

  connectS3(token: string, input: S3ConnectInput): Promise<StorageAccount[]> {
    return this.request<StorageAccount[]>("/providers/s3", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
  }

  /** Make a storage the default for uploads, or change a GitHub repo's visibility. */
  updateStorage(
    token: string,
    id: string,
    input: { is_default?: boolean; private?: boolean },
  ): Promise<StorageAccount[]> {
    return this.request<StorageAccount[]>(`/providers/accounts/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(input),
    });
  }

  disconnectStorage(token: string, id: string): Promise<StorageAccount[]> {
    return this.request<StorageAccount[]>(`/providers/accounts/${id}`, { method: "DELETE", token });
  }

  disconnectTelegram(token: string): Promise<void> {
    return this.request<void>("/providers/telegram", { method: "DELETE", token });
  }

  /** Liveness probe for the Telegram storage session. `needs_reauth` is true
   *  when a previously-connected session was revoked (user terminated it). */
  telegramSessionStatus(token: string): Promise<{ connected: boolean; needs_reauth: boolean }> {
    return this.request<{ connected: boolean; needs_reauth: boolean }>("/providers/telegram/session", {
      token,
    });
  }

  // ── Folders ───────────────────────────────────────────────────────────────
  listFolders(token: string, parentId?: string): Promise<FolderItem[]> {
    const qs = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : "";
    return this.request<FolderItem[]>(`/folders${qs}`, { token });
  }

  createFolder(token: string, name: string, parentId?: string, color?: string | null): Promise<FolderItem> {
    return this.request<FolderItem>("/folders", {
      method: "POST",
      token,
      body: JSON.stringify({ name, parent_id: parentId ?? null, color: color ?? null }),
    });
  }

  folderBreadcrumb(token: string, folderId: string): Promise<Breadcrumb[]> {
    return this.request<Breadcrumb[]>(`/folders/${folderId}/breadcrumb`, { token });
  }

  searchFolders(token: string, query: string, limit = 20): Promise<FolderItem[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.request<FolderItem[]>(`/folders/search?${params.toString()}`, { token });
  }

  renameFolder(token: string, id: string, name: string): Promise<FolderItem> {
    return this.request<FolderItem>(`/folders/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ name }),
    });
  }

  moveFolder(token: string, id: string, parentId: string | null): Promise<FolderItem> {
    return this.request<FolderItem>(`/folders/${id}/move`, {
      method: "POST",
      token,
      body: JSON.stringify({ parent_id: parentId }),
    });
  }

  /** Update a folder's name and/or color (color null clears it). */
  updateFolder(
    token: string,
    id: string,
    patch: { name?: string; color?: string | null },
  ): Promise<FolderItem> {
    return this.request<FolderItem>(`/folders/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(patch),
    });
  }

  deleteFolder(token: string, id: string): Promise<void> {
    return this.request<void>(`/folders/${id}`, { method: "DELETE", token });
  }

  // ── Files ─────────────────────────────────────────────────────────────────
  /** A single file's metadata — used to open a chat source in a preview. */
  getFile(token: string, id: string): Promise<FileItem> {
    return this.request<FileItem>(`/files/${id}`, { token });
  }

  listFiles(
    token: string,
    folderId?: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<FileItem[]> {
    const params = new URLSearchParams();
    if (folderId) params.set("folder_id", folderId);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request<FileItem[]>(`/files${qs ? `?${qs}` : ""}`, { token });
  }

  searchFiles(
    token: string,
    query: string,
    opts?: { ext?: string; mime?: string; folderId?: string },
  ): Promise<FileItem[]> {
    const params = new URLSearchParams({ q: query });
    if (opts?.ext) params.set("ext", opts.ext);
    if (opts?.mime) params.set("mime", opts.mime);
    if (opts?.folderId) params.set("folder_id", opts.folderId);
    return this.request<FileItem[]>(`/files/search?${params.toString()}`, { token });
  }

  /** Natural-language search: "pdfs from last week larger than 2mb invoice". */
  nlSearch(token: string, query: string, limit = 50): Promise<FileItem[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.request<FileItem[]>(`/files/nl-search?${params.toString()}`, { token });
  }

  listDuplicates(token: string): Promise<DuplicateGroup[]> {
    return this.request<DuplicateGroup[]>("/files/duplicates", { token });
  }

  /** Files whose bytes are gone from the provider (deleted directly in Telegram). */
  listMissing(token: string): Promise<FileItem[]> {
    return this.request<FileItem[]>("/files/missing", { token });
  }

  /** Scan every file against the provider and flag/unflag missing ones. */
  verifyFiles(token: string): Promise<{ checked: number; missing: number }> {
    return this.request<{ checked: number; missing: number }>("/files/verify", {
      method: "POST",
      token,
    });
  }

  /** Remove all flagged-missing file records at once (records-only). */
  clearMissing(token: string): Promise<{ removed: number }> {
    return this.request<{ removed: number }>("/files/missing", { method: "DELETE", token });
  }

  /** Upload a file. Uses XHR so real byte-progress (0–100) is reported via
   *  onProgress; falls back gracefully if the size isn't known. */
  uploadFile(
    token: string,
    file: File,
    folderId?: string,
    onProgress?: (pct: number) => void,
    /** Which storage to upload to; the user's default when omitted. */
    storageAccountId?: string,
  ): Promise<FileItem> {
    return new Promise<FileItem>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      if (folderId) form.append("folder_id", folderId);
      if (storageAccountId) form.append("storage_account_id", storageAccountId);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.baseUrl}/files`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as FileItem);
        } else {
          let detail = xhr.statusText;
          let code: string | undefined;
          try {
            const body = JSON.parse(xhr.responseText) as { detail?: string; code?: string };
            detail = body.detail ?? detail;
            code = body.code;
          } catch {
            // non-JSON error body
          }
          reject(new ApiError(xhr.status, detail, code));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
      xhr.send(form);
    });
  }

  deleteFile(token: string, id: string): Promise<void> {
    return this.request<void>(`/files/${id}`, { method: "DELETE", token });
  }

  /** Move a file to a folder (folderId null = root). */
  moveFile(token: string, id: string, folderId: string | null): Promise<FileItem> {
    return this.request<FileItem>(`/files/${id}/move`, {
      method: "POST",
      token,
      body: JSON.stringify({ folder_id: folderId }),
    });
  }

  renameFile(token: string, id: string, name: string): Promise<FileItem> {
    return this.request<FileItem>(`/files/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ name }),
    });
  }

  listFavorites(token: string, opts?: { limit?: number; offset?: number }): Promise<FileItem[]> {
    const params = new URLSearchParams({ favorite: "true" });
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    return this.request<FileItem[]>(`/files?${params.toString()}`, { token });
  }

  listByTag(token: string, tag: string, opts?: { limit?: number; offset?: number }): Promise<FileItem[]> {
    const params = new URLSearchParams({ tag });
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    return this.request<FileItem[]>(`/files?${params.toString()}`, { token });
  }

  listTags(token: string): Promise<string[]> {
    return this.request<string[]>("/files/tags", { token });
  }

  setFavorite(token: string, id: string, favorite: boolean): Promise<FileItem> {
    return this.request<FileItem>(`/files/${id}/favorite`, {
      method: "PUT",
      token,
      body: JSON.stringify({ favorite }),
    });
  }

  addTag(token: string, id: string, name: string): Promise<FileItem> {
    return this.request<FileItem>(`/files/${id}/tags`, {
      method: "POST",
      token,
      body: JSON.stringify({ name }),
    });
  }

  removeTag(token: string, id: string, name: string): Promise<FileItem> {
    return this.request<FileItem>(`/files/${id}/tags/${encodeURIComponent(name)}`, {
      method: "DELETE",
      token,
    });
  }

  private async errorFrom(res: Response): Promise<ApiError> {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { detail?: string; code?: string };
      if (body?.detail) detail = body.detail;
      if (body?.code) code = body.code;
    } catch {
      // non-JSON error body; keep statusText
    }
    return new ApiError(res.status, detail, code);
  }

  async downloadBlob(token: string, id: string): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/files/${id}/content`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.errorFrom(res);
    return res.blob();
  }

  // ── Versions ────────────────────────────────────────────────────────────
  replaceFile(token: string, fileId: string, file: File): Promise<FileItem> {
    const form = new FormData();
    form.append("file", file);
    return this.request<FileItem>(`/files/${fileId}/replace`, {
      method: "POST",
      token,
      body: form,
    });
  }

  listVersions(token: string, fileId: string): Promise<VersionItem[]> {
    return this.request<VersionItem[]>(`/files/${fileId}/versions`, { token });
  }

  restoreVersion(token: string, fileId: string, versionId: string): Promise<FileItem> {
    return this.request<FileItem>(`/files/${fileId}/versions/${versionId}/restore`, {
      method: "POST",
      token,
    });
  }

  deleteVersion(token: string, fileId: string, versionId: string): Promise<void> {
    return this.request<void>(`/files/${fileId}/versions/${versionId}`, {
      method: "DELETE",
      token,
    });
  }

  async downloadVersionBlob(token: string, fileId: string, versionId: string): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/files/${fileId}/versions/${versionId}/content`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw await this.errorFrom(res);
    return res.blob();
  }

  // ── Aliases (permanent links) ─────────────────────────────────────────────
  listAliases(token: string): Promise<AliasItem[]> {
    return this.request<AliasItem[]>("/aliases", { token });
  }

  createAlias(token: string, slug: string, fileId: string, description?: string): Promise<AliasItem> {
    return this.request<AliasItem>("/aliases", {
      method: "POST",
      token,
      body: JSON.stringify({ slug, file_id: fileId, description: description ?? null }),
    });
  }

  /** Create a permanent link that points at a folder (a browsable public page). */
  createFolderAlias(token: string, slug: string, folderId: string): Promise<AliasItem> {
    return this.request<AliasItem>("/aliases", {
      method: "POST",
      token,
      body: JSON.stringify({ slug, folder_id: folderId }),
    });
  }

  updateAlias(
    token: string,
    id: string,
    patch: { slug?: string; description?: string; file_id?: string },
  ): Promise<AliasItem> {
    return this.request<AliasItem>(`/aliases/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(patch),
    });
  }

  deleteAlias(token: string, id: string): Promise<void> {
    return this.request<void>(`/aliases/${id}`, { method: "DELETE", token });
  }

  /** Public, permanent URL for a FILE alias: /{username}/{slug} (streams the file). */
  aliasUrl(username: string, slug: string): string {
    return `${this.baseUrl}/${username}/${slug}`;
  }

  // ── Public folder browsing (unauthenticated) ──────────────────────────────
  publicMeta(username: string, slug: string): Promise<PublicMeta> {
    return this.request<PublicMeta>(`/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
  }

  publicFolderList(username: string, slug: string, folderId?: string): Promise<PublicFolderView> {
    const q = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : "";
    return this.request<PublicFolderView>(
      `/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/list${q}`,
    );
  }

  /** Direct URL to stream/download a file inside a shared folder. */
  publicFolderFileUrl(username: string, slug: string, fileId: string, download = false): string {
    const dl = download ? "?dl=1" : "";
    return `${this.baseUrl}/public/${encodeURIComponent(username)}/${encodeURIComponent(
      slug,
    )}/file/${fileId}${dl}`;
  }

  // ── Shares (links that expire after some days) ───────────────────────────
  createShare(token: string, input: ShareInput): Promise<ShareItem> {
    return this.request<ShareItem>("/shares", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
  }

  listShares(token: string): Promise<ShareItem[]> {
    return this.request<ShareItem[]>("/shares", { token });
  }

  deleteShare(token: string, id: string): Promise<void> {
    return this.request<void>(`/shares/${id}`, { method: "DELETE", token });
  }

  shareUrl(shareToken: string): string {
    return `${this.baseUrl}/s/${shareToken}`;
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  getAnalyticsOverview(token: string): Promise<AnalyticsOverview> {
    return this.request<AnalyticsOverview>("/analytics/overview", { token });
  }

  // ── Developer platform (API keys + webhooks) ──────────────────────────────
  listApiKeys(token: string): Promise<ApiKeyItem[]> {
    return this.request<ApiKeyItem[]>("/api-keys", { token });
  }

  createApiKey(
    token: string,
    name: string,
    scopes: string[],
    expiresInDays?: number | null,
  ): Promise<ApiKeyCreated> {
    return this.request<ApiKeyCreated>("/api-keys", {
      method: "POST",
      token,
      body: JSON.stringify({ name, scopes, expires_in_days: expiresInDays ?? null }),
    });
  }

  revokeApiKey(token: string, id: string): Promise<void> {
    return this.request<void>(`/api-keys/${id}`, { method: "DELETE", token });
  }

  listWebhooks(token: string): Promise<WebhookItem[]> {
    return this.request<WebhookItem[]>("/webhooks", { token });
  }

  createWebhook(token: string, url: string, events?: string[]): Promise<WebhookItem> {
    return this.request<WebhookItem>("/webhooks", {
      method: "POST",
      token,
      body: JSON.stringify(events && events.length ? { url, events } : { url }),
    });
  }

  deleteWebhook(token: string, id: string): Promise<void> {
    return this.request<void>(`/webhooks/${id}`, { method: "DELETE", token });
  }

  // ── Activity (audit log) ──────────────────────────────────────────────────
  getAuditLog(token: string, opts?: { limit?: number; offset?: number }): Promise<AuditItem[]> {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request<AuditItem[]>(`/audit${qs ? `?${qs}` : ""}`, { token });
  }

  // ── BYOK vault: keys ──────────────────────────────────────────────────────
  listAiKeys(token: string): Promise<AiKey[]> {
    return this.request<AiKey[]>("/ai/keys", { token });
  }

  /** The decrypted value of one saved key, so the owner can check or copy it.
   *  Separate from listAiKeys on purpose — keys aren't carried by routine
   *  responses, and each reveal is recorded in the audit log. */
  revealAiKey(token: string, id: string): Promise<{ api_key: string }> {
    return this.request<{ api_key: string }>(`/ai/keys/${id}/reveal`, { token });
  }

  createAiKey(token: string, input: AiKeyInput): Promise<AiKey> {
    return this.request<AiKey>("/ai/keys", { method: "POST", token, body: JSON.stringify(input) });
  }

  updateAiKey(token: string, id: string, input: AiKeyInput): Promise<AiKey> {
    return this.request<AiKey>(`/ai/keys/${id}`, {
      method: "PUT",
      token,
      body: JSON.stringify(input),
    });
  }

  /** Ask a provider which models a key can use. Pass the key typed in the form,
   *  or `keyId` to use a saved one. */
  listProviderModels(
    token: string,
    input: { base_url: string; api_key?: string; key_id?: string },
  ): Promise<ProviderModels> {
    return this.request<ProviderModels>("/ai/models", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
  }

  /** Send one tiny test request to a model, to learn which settings it
   *  refuses. Fails with the provider's reason if the model doesn't work. */
  checkModel(
    token: string,
    input: { base_url: string; model: string; api_key?: string; key_id?: string },
  ): Promise<ModelCheck> {
    return this.request<ModelCheck>("/ai/models/check", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
  }

  deleteAiKey(token: string, id: string): Promise<void> {
    return this.request<void>(`/ai/keys/${id}`, { method: "DELETE", token });
  }

  // ── BYOK vault: prompts ─────────────────────────────────────────────────────
  listAiPrompts(token: string): Promise<AiPrompt[]> {
    return this.request<AiPrompt[]>("/ai/prompts", { token });
  }

  createAiPrompt(token: string, name: string, content: string): Promise<AiPrompt> {
    return this.request<AiPrompt>("/ai/prompts", {
      method: "POST",
      token,
      body: JSON.stringify({ name, content }),
    });
  }

  updateAiPrompt(token: string, id: string, name: string, content: string): Promise<AiPrompt> {
    return this.request<AiPrompt>(`/ai/prompts/${id}`, {
      method: "PUT",
      token,
      body: JSON.stringify({ name, content }),
    });
  }

  deleteAiPrompt(token: string, id: string): Promise<void> {
    return this.request<void>(`/ai/prompts/${id}`, { method: "DELETE", token });
  }

  // ── Drive-wide conversations (ChatGPT-style threads) ──────────────────────
  listConversations(token: string): Promise<AiConversation[]> {
    return this.request<AiConversation[]>("/ai/conversations", { token });
  }

  createConversation(token: string, title = "New chat"): Promise<AiConversation> {
    return this.request<AiConversation>("/ai/conversations", {
      method: "POST",
      token,
      body: JSON.stringify({ title }),
    });
  }

  renameConversation(token: string, id: string, title: string): Promise<AiConversation> {
    return this.request<AiConversation>(`/ai/conversations/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ title }),
    });
  }

  deleteConversation(token: string, id: string): Promise<void> {
    return this.request<void>(`/ai/conversations/${id}`, { method: "DELETE", token });
  }

  getConversationMessages(token: string, id: string): Promise<AiChatMessage[]> {
    return this.request<AiChatMessage[]>(`/ai/conversations/${id}/messages`, { token });
  }

  /** POST a JSON body and stream the plain-text response, invoking onToken for
   *  each chunk (typing effect). Resolves with the full accumulated text. */
  private async streamText(
    path: string,
    token: string,
    body: unknown,
    onToken: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await this.errorFrom(res);
    if (!res.body) throw new ApiError(0, "No response stream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        full += chunk;
        onToken(chunk);
      }
    }
    return full;
  }

  /** Stream a summary of a document using a saved key (+ optional prompt). */
  summarizeStream(
    token: string,
    args: { fileId: string; keyId: string; promptId?: string | null },
    onToken: (chunk: string) => void,
  ): Promise<string> {
    return this.streamText(
      "/ai/summarize",
      token,
      { file_id: args.fileId, key_id: args.keyId, prompt_id: args.promptId ?? null },
      onToken,
    );
  }

  /** Stream a single-document chat reply. Stateless server-side — pass prior
   *  turns via `history` for context (the thread is kept in the client's
   *  localStorage). `retrieval` = long-document mode. */
  chatStream(
    token: string,
    args: {
      fileId: string;
      keyId: string;
      promptId?: string | null;
      message: string;
      retrieval?: boolean;
      history?: { role: "user" | "assistant"; content: string }[];
    },
    onToken: (chunk: string) => void,
  ): Promise<string> {
    return this.streamText(
      "/ai/chat",
      token,
      {
        file_id: args.fileId,
        key_id: args.keyId,
        prompt_id: args.promptId ?? null,
        message: args.message,
        retrieval: args.retrieval ?? false,
        history: args.history ?? [],
      },
      onToken,
    );
  }

  /** Index files for drive-wide RAG; streams "done/total name" progress lines.
   *  Pass `signal` to cancel — the server stops embedding once the client
   *  disconnects, so aborting really does end the run. */
  indexDrive(
    token: string,
    args: {
      keyId: string;
      all?: boolean;
      fileIds?: string[];
      folderIds?: string[];
      /** Skip files already embedded for this key's model (drive-wide). */
      remaining?: boolean;
      /** Re-embed even files already current — otherwise those are no-ops. */
      force?: boolean;
    },
    onProgress: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.streamText(
      "/ai/index",
      token,
      {
        key_id: args.keyId,
        all: args.all ?? false,
        file_ids: args.fileIds ?? [],
        folder_ids: args.folderIds ?? [],
        remaining: args.remaining ?? false,
        force: args.force ?? false,
      },
      onProgress,
      signal,
    );
  }

  /** Which extractable files are already embedded for a key's embedding model. */
  indexStatus(token: string, keyId: string): Promise<IndexStatus> {
    return this.request<IndexStatus>(`/ai/index/status?key_id=${encodeURIComponent(keyId)}`, { token });
  }

  /** Delete embedded chunks to free space — all files, or specific ones. */
  unindex(token: string, args: { all?: boolean; fileIds?: string[] }): Promise<{ removed: number }> {
    return this.request<{ removed: number }>("/ai/unindex", {
      method: "POST",
      token,
      body: JSON.stringify({ all: args.all ?? false, file_ids: args.fileIds ?? [] }),
    });
  }

  /** Run one agent turn. Streams the reply plus control events; any change the
   *  model wants is returned as a plan to confirm (except in auto/full mode,
   *  where the reversible ones have already been applied). */
  agentChatStream(
    token: string,
    args: {
      conversationId: string;
      keyId: string;
      promptId?: string | null;
      message: string;
      mode: AgentMode;
      strategies?: RagStrategies;
      /** Set by /organize: tidy the whole drive with these settings. */
      organize?: OrganizeOptions | null;
      /** A pending plan this turn replaces: `message` is the user's note, and the
       *  reply rewrites that plan's message instead of adding a new one. */
      revises?: string | null;
      /** An applied plan whose failed changes this turn redoes ("Fix with Bao"). */
      fixes?: string | null;
    },
    onToken: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.streamText(
      "/ai/agent/chat",
      token,
      {
        conversation_id: args.conversationId,
        key_id: args.keyId,
        prompt_id: args.promptId ?? null,
        message: args.message,
        mode: args.mode,
        strategies: args.strategies ?? {
          rewrite: false,
          hyde: false,
          rerank: false,
          crag: false,
        },
        organize: args.organize ?? null,
        revises: args.revises ?? null,
        fixes: args.fixes ?? null,
      },
      onToken,
      signal,
    );
  }

  /** TEMPORARY (/undo): reverse an applied plan's changes. Removed once used. */
  undoAgentPlan(
    token: string,
    planId: string,
  ): Promise<{ undone: number; not_undone: { label: string; detail: string }[] }> {
    return this.request(`/ai/agent/plans/${planId}/undo`, { method: "POST", token });
  }

  /** Every plan in a conversation, with its current status. */
  agentPlans(token: string, conversationId: string): Promise<AgentPlan[]> {
    return this.request<AgentPlan[]>(
      `/ai/agent/plans?conversation_id=${encodeURIComponent(conversationId)}`,
      { token },
    );
  }

  /** Execute a confirmed plan. Actions that already ran are not repeated. */
  applyAgentPlan(token: string, planId: string): Promise<AgentApplyResult> {
    return this.request<AgentApplyResult>(`/ai/agent/plans/${planId}/apply`, {
      method: "POST",
      token,
    });
  }

  /** Abandon a pending plan so it can never be applied. */
  discardAgentPlan(token: string, planId: string): Promise<AgentPlan> {
    return this.request<AgentPlan>(`/ai/agent/plans/${planId}/discard`, {
      method: "POST",
      token,
    });
  }

  /** Stream a drive-wide RAG chat reply into a conversation. */
  driveChatStream(
    token: string,
    args: {
      conversationId: string;
      keyId: string;
      promptId?: string | null;
      message: string;
      strategies: RagStrategies;
    },
    onToken: (chunk: string) => void,
  ): Promise<string> {
    return this.streamText(
      "/ai/drive/chat",
      token,
      {
        conversation_id: args.conversationId,
        key_id: args.keyId,
        prompt_id: args.promptId ?? null,
        message: args.message,
        strategies: args.strategies,
      },
      onToken,
    );
  }
}
