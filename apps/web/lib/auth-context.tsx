"use client";

import type { User } from "@byos/api-client";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api } from "@/lib/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (accessToken: string) => {
    setUser(await api.me(accessToken));
  }, []);

  useEffect(() => {
    // Attempt a silent refresh on mount using the httpOnly refresh cookie.
    let cancelled = false;
    (async () => {
      try {
        const token = await api.refresh();
        if (!cancelled) await loadMe(token.access_token);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const token = await api.login({ email, password });
      await loadMe(token.access_token);
    },
    [loadMe],
  );

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
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
