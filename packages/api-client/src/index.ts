// BYOS API client.
//
// Phase 0–2: a small, dependency-free typed wrapper around fetch covering auth,
// storage providers (Telegram connect flow), and the file pipeline. `pnpm
// codegen` generates a full typed client from the live OpenAPI schema into
// ./generated/ (git-ignored). App code imports only from "@byos/api-client".

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  is_verified: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface RegisterInput {
  email: string;
  password: string;
  display_name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
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
  created_at: string;
  modified_at: string;
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
  register(input: RegisterInput): Promise<User> {
    return this.request<User>("/auth/register", { method: "POST", body: JSON.stringify(input) });
  }

  login(input: LoginInput): Promise<TokenResponse> {
    return this.request<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
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

  connectTelegram(token: string, phone: string): Promise<ConnectResult> {
    return this.request<ConnectResult>("/providers/telegram/connect", {
      method: "POST",
      token,
      body: JSON.stringify({ phone }),
    });
  }

  verifyTelegramCode(token: string, code: string): Promise<ConnectResult> {
    return this.request<ConnectResult>("/providers/telegram/verify", {
      method: "POST",
      token,
      body: JSON.stringify({ code }),
    });
  }

  verifyTelegramPassword(token: string, password: string): Promise<ConnectResult> {
    return this.request<ConnectResult>("/providers/telegram/password", {
      method: "POST",
      token,
      body: JSON.stringify({ password }),
    });
  }

  disconnectTelegram(token: string): Promise<void> {
    return this.request<void>("/providers/telegram", { method: "DELETE", token });
  }

  // ── Files ─────────────────────────────────────────────────────────────────
  listFiles(token: string): Promise<FileItem[]> {
    return this.request<FileItem[]>("/files", { token });
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

  async downloadBlob(token: string, id: string): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/files/${id}/content`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  }
}
