"use client";

import { ApiError, type User } from "@byos/api-client";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api } from "@/lib/api";

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
  establishSession: (accessToken: string) => Promise<void>;
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

  const establishSession = useCallback(async (accessToken: string) => {
    setToken(accessToken);
    setUser(await api.me(accessToken));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await refresh();
      if (!cancelled) setLoading(false);
      // Proactively catch a terminated Telegram session on app load, so the
      // user is bounced to login immediately instead of only when they first
      // touch a file (browsing reads the DB and never hits Telegram).
      if (t && !cancelled) {
        try {
          const { needs_reauth } = await api.telegramSessionStatus(t);
          if (needs_reauth && !cancelled) {
            try {
              sessionStorage.setItem(
                RECONNECT_NOTICE_KEY,
                "Your Telegram access was logged out. Please sign in again to reconnect your storage.",
              );
            } catch {
              // sessionStorage unavailable — the login page just won't show a reason
            }
            await logout();
          }
        } catch {
          // Probe failure shouldn't block the app; runtime detection still applies.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, logout]);

  return (
    <AuthContext.Provider value={{ user, token, loading, logout, refresh, establishSession }}>
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

/** Runs an API call with the current access token; on a 401, refreshes once and retries. */
/** sessionStorage key the login page reads to show why the user was bounced. */
export const RECONNECT_NOTICE_KEY = "byos:reconnect_notice";

export function useAuthed(): Authed {
  const { token, refresh, logout } = useAuth();
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
        // Storage credentials revoked (e.g. Telegram sessions terminated) — the
        // app session is fine but nothing works until they reconnect. Bounce to
        // login with a reason; password login there re-sends an OTP to repair.
        if (err instanceof ApiError && err.code === "telegram_session_expired") {
          try {
            sessionStorage.setItem(RECONNECT_NOTICE_KEY, err.detail);
          } catch {
            // sessionStorage unavailable — the thrown error still surfaces a toast
          }
          void logout(); // clears user → the app's guards redirect to /login
        }
        throw err;
      }
    },
    [token, refresh, logout],
  ) as Authed;
}
