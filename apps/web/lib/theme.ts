"use client";

import { useEffect, useState } from "react";

// Theme is applied to <html> via the .dark class. The initial class is set by
// an inline script in the root layout (no flash); this hook keeps it in sync.
const KEY = "byos:theme";

export type Theme = "light" | "dark";

function current(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(current());
  }, []);

  const toggle = () => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignore storage errors
    }
    setTheme(next);
  };

  return { theme, toggle };
}
