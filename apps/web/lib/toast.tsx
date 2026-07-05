"use client";

import { AlertCircle, Check } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error";
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, type: ToastType = "success") => {
    const id = (idRef.current += 1);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-xs flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            {t.type === "error" ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            ) : (
              <Check className="h-4 w-4 shrink-0 text-indigo-600" />
            )}
            <span className="text-zinc-800 dark:text-zinc-200">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
