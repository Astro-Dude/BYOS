"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { Cursor } from "@/components/cursor";
import { AuthProvider } from "@/lib/auth-context";
import { IndexingProvider } from "@/lib/indexing";
import { PreferencesProvider } from "@/lib/preferences";
import { ToastProvider } from "@/lib/toast";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <AuthProvider>
          <ToastProvider>
            {/* Above the router so an index run survives closing the settings
                modal, and any navigation between Drive and BYOK. */}
            <IndexingProvider>{children}</IndexingProvider>
            <Cursor />
          </ToastProvider>
        </AuthProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
