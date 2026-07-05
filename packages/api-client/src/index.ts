// BYOS API client.
//
// Phase 0–2: a small, dependency-free typed wrapper around fetch covering auth,
// storage providers (Telegram connect flow), and the file pipeline. `pnpm
// codegen` generates a full typed client from the live OpenAPI schema into
// ./generated/ (git-ignored). App code imports only from "@byos/api-client".

export interface User {
  id: string;
  email: string | null;
  display_name: string | null;
  is_verified: boolean;
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
  folder_id: string | null;
  is_favorite: boolean;
  tags: string[];
  created_at: string;
  modified_at: string;
}

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: string;
}

export interface ShareInfoItem {
  file_name: string;
  mime: string | null;
  size: number;
  view_only: boolean;
  has_password: boolean;
  expired: boolean;
  limit_reached: boolean;
}

export interface Breadcrumb {
  id: string;
  name: string;
}

export interface AliasItem {
  id: string;
  slug: string;
  file_id: string;
  description: string | null;
  created_at: string;
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
  visibility: string;
  has_password: boolean;
  expires_at: string | null;
  max_downloads: number | null;
  download_count: number;
  view_only: boolean;
  created_at: string;
}

export interface ShareInput {
  file_id: string;
  password?: string;
  expires_in_days?: number;
  max_downloads?: number;
  view_only?: boolean;
}

export interface AnalyticsOverview {
  storage_bytes: number;
  file_count: number;
  alias_count: number;
  share_count: number;
  views_total: number;
  views_30d: number;
  downloads_total: number;
  downloads_30d: number;
}

export interface AnalyticsDayPoint {
  day: string; // YYYY-MM-DD
  views: number;
  downloads: number;
}

export interface AnalyticsTopItem {
  target_type: string; // file | alias | share
  target_id: string;
  label: string;
  hits: number;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
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

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
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
      try {
        const body = (await res.json()) as { detail?: string };
        if (body?.detail) detail = body.detail;
      } catch {
        // non-JSON error body; keep statusText
      }
      throw new ApiError(res.status, detail);
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

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  // ── Storage providers (Telegram) ─────────────────────────────────────────
  listProviders(token: string): Promise<ProviderStatus[]> {
    return this.request<ProviderStatus[]>("/providers", { token });
  }

  disconnectTelegram(token: string): Promise<void> {
    return this.request<void>("/providers/telegram", { method: "DELETE", token });
  }

  // ── Folders ───────────────────────────────────────────────────────────────
  listFolders(token: string, parentId?: string): Promise<FolderItem[]> {
    const qs = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : "";
    return this.request<FolderItem[]>(`/folders${qs}`, { token });
  }

  createFolder(token: string, name: string, parentId?: string): Promise<FolderItem> {
    return this.request<FolderItem>("/folders", {
      method: "POST",
      token,
      body: JSON.stringify({ name, parent_id: parentId ?? null }),
    });
  }

  folderBreadcrumb(token: string, folderId: string): Promise<Breadcrumb[]> {
    return this.request<Breadcrumb[]>(`/folders/${folderId}/breadcrumb`, { token });
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

  uploadFile(token: string, file: File, folderId?: string): Promise<FileItem> {
    const form = new FormData();
    form.append("file", file);
    if (folderId) form.append("folder_id", folderId);
    return this.request<FileItem>("/files", { method: "POST", token, body: form });
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

  listFavorites(token: string, opts?: { limit?: number; offset?: number }): Promise<FileItem[]> {
    const params = new URLSearchParams({ favorite: "true" });
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    return this.request<FileItem[]>(`/files?${params.toString()}`, { token });
  }

  listByTag(
    token: string,
    tag: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<FileItem[]> {
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

  async downloadBlob(token: string, id: string): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/files/${id}/content`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
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
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  }

  // ── Aliases (permanent links) ─────────────────────────────────────────────
  listAliases(token: string): Promise<AliasItem[]> {
    return this.request<AliasItem[]>("/aliases", { token });
  }

  createAlias(
    token: string,
    slug: string,
    fileId: string,
    description?: string,
  ): Promise<AliasItem> {
    return this.request<AliasItem>("/aliases", {
      method: "POST",
      token,
      body: JSON.stringify({ slug, file_id: fileId, description: description ?? null }),
    });
  }

  deleteAlias(token: string, id: string): Promise<void> {
    return this.request<void>(`/aliases/${id}`, { method: "DELETE", token });
  }

  /** Public, permanent URL for an alias (never changes even when the file is replaced). */
  aliasUrl(slug: string): string {
    return `${this.baseUrl}/a/${slug}`;
  }

  // ── Shares (links with access controls) ───────────────────────────────────
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

  /** Direct API content URL for a share (used by the viewer to embed/download). */
  shareUrl(shareToken: string, pw?: string): string {
    const q = pw ? `?pw=${encodeURIComponent(pw)}` : "";
    return `${this.baseUrl}/s/${shareToken}${q}`;
  }

  /** Public share metadata for the viewer page (no auth). */
  shareInfo(token: string): Promise<ShareInfoItem> {
    return this.request<ShareInfoItem>(`/s/${token}/info`);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  getAnalyticsOverview(token: string): Promise<AnalyticsOverview> {
    return this.request<AnalyticsOverview>("/analytics/overview", { token });
  }

  getAnalyticsTimeseries(token: string, days = 30): Promise<AnalyticsDayPoint[]> {
    return this.request<AnalyticsDayPoint[]>(`/analytics/timeseries?days=${days}`, { token });
  }

  getAnalyticsTop(token: string, limit = 8): Promise<AnalyticsTopItem[]> {
    return this.request<AnalyticsTopItem[]>(`/analytics/top?limit=${limit}`, { token });
  }

  // ── Developer platform (API keys + webhooks) ──────────────────────────────
  listApiKeys(token: string): Promise<ApiKeyItem[]> {
    return this.request<ApiKeyItem[]>("/api-keys", { token });
  }

  createApiKey(token: string, name: string): Promise<ApiKeyCreated> {
    return this.request<ApiKeyCreated>("/api-keys", {
      method: "POST",
      token,
      body: JSON.stringify({ name }),
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
}
