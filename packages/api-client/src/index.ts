// BYOS API client.
//
// Phase 0: a small, dependency-free typed wrapper around fetch covering the
// auth surface. `pnpm codegen` generates a full typed client from the live
// OpenAPI schema into ./generated/ (git-ignored); later phases re-export from
// there. App code should import only from "@byos/api-client".

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
    const res = await fetch(`${this.baseUrl}${path}`, {
      credentials: "include", // send/receive the httpOnly refresh cookie
      headers: {
        "Content-Type": "application/json",
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
}
