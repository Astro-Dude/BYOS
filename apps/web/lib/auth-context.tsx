"use client";

import { ApiError, type User } from "@byos/api-client";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api } from "@/lib/api";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<string | null> => {
    try {
      const t = await api.refresh();
      setToken(t.access_token);
      setUser(await api.me(t.access_token));
      return t.access_token;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    // Attempt a silent refresh on mount using the httpOnly refresh cookie.
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const t = await api.login({ email, password });
    setToken(t.access_token);
    setUser(await api.me(t.access_token));
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      await api.register({ email, password, display_name: displayName });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export type Authed = <T>(fn: (token: string) => Promise<T>) => Promise<T>;

/** Returns a helper that runs an API call with the current access token and,
 * on a 401, refreshes once and retries. */
export function useAuthed(): Authed {
  const { token, refresh } = useAuth();
  // Memoized so its identity is stable across renders (only changes when the
  // token or refresh fn changes). Without this, callers that put `authed` in a
  // useEffect/useCallback dependency array re-run every render → fetch loop.
  return useCallback(
    async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
      const current = token ?? (await refresh());
      if (!current) throw new ApiError(401, "Not authenticated");
      try {
        return await fn(current);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const renewed = await refresh();
          if (renewed) return fn(renewed);
        }
        throw err;
      }
    },
    [token, refresh],
  ) as Authed;
}
