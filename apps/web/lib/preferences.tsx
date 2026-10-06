"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { CursorColor, CursorDesign, CursorSizeName } from "@/lib/cursor-design";

/**
 * User preferences for how the app looks and behaves.
 *
 * Stored per device in localStorage for now. Everything reads them through
 * `usePreferences`, so moving them to the server later (to sync across devices)
 * only changes this file.
 *
 * Values are loaded after mount, never during render, so server-rendered HTML
 * and the first client render agree. `ready` says when the saved values are in.
 */

export type TextSize = "small" | "default" | "large" | "xlarge";
/** Light, dark, or whatever the device is set to. */
export type ThemeChoice = "system" | "light" | "dark";
/** A cursor from lib/cursor-design.ts, or "system" for the computer's own. */
export type CursorChoice = CursorDesign | "system";
export type CursorSize = CursorSizeName;
export type { CursorColor };
export type HeadingFont = "serif" | "sans";
export type UiFont = "inter" | "system";
export type Highlight = "blush" | "ink";
export type Density = "comfortable" | "compact";
export type DriveLayout = "list" | "grid";
/** "none" keeps the folder's own order; otherwise `field:dir`. */
export type DriveSort =
  | "none"
  | "name:asc"
  | "name:desc"
  | "modified:desc"
  | "modified:asc"
  | "size:desc"
  | "size:asc";
export type UploadConflict = "ask" | "keep" | "replace" | "skip";
/** Where uploads go: always the default storage, or ask each time (only when
 *  more than one storage is connected). */
export type UploadTarget = "default" | "ask";
export type ChatStartMode = "last" | "read_only" | "ask" | "auto" | "full";
export type ChatStrategies = { rewrite: boolean; hyde: boolean; rerank: boolean; crag: boolean; reasoning: boolean };
export type EditorTheme = "graphite" | "plum" | "fjord" | "linen";
export type EditorFont = "mono" | "sans";
export type EditorView = "write" | "split" | "preview";
export type EditorFontSize = "13" | "14" | "15" | "16" | "18";

export interface Preferences {
  // Appearance
  theme: ThemeChoice;
  cursorDesign: CursorChoice;
  cursorColor: CursorColor;
  cursorSize: CursorSize;
  /** Drawn by the page so it can tilt and react; trails the mouse slightly.
   *  Off, the OS draws it and it moves at system speed. */
  cursorMotion: boolean;
  textSize: TextSize;
  headingFont: HeadingFont;
  uiFont: UiFont;
  highlight: Highlight;
  density: Density;
  // Drive
  driveLayout: DriveLayout;
  driveSort: DriveSort;
  uploadConflict: UploadConflict;
  uploadTarget: UploadTarget;
  confirmDelete: boolean;
  // Chat
  chatStartMode: ChatStartMode;
  chatStrategies: ChatStrategies;
  /** The system prompt a new chat starts with: a prompt id, or "none". */
  chatDefaultPrompt: string;
  // The Markdown editor for system prompts
  editorTheme: EditorTheme;
  editorFont: EditorFont;
  editorFontSize: EditorFontSize;
  editorWrap: boolean;
  editorLineNumbers: boolean;
  editorView: EditorView;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  cursorDesign: "arrow",
  cursorColor: "blush",
  cursorSize: "default",
  cursorMotion: true,
  textSize: "default",
  headingFont: "serif",
  uiFont: "inter",
  highlight: "blush",
  density: "comfortable",
  driveLayout: "list",
  driveSort: "none",
  uploadConflict: "ask",
  uploadTarget: "default",
  confirmDelete: true,
  chatStartMode: "last",
  chatStrategies: { rewrite: false, hyde: false, rerank: false, crag: false, reasoning: false },
  chatDefaultPrompt: "none",
  editorTheme: "graphite",
  editorFont: "mono",
  editorFontSize: "14",
  editorWrap: true,
  editorLineNumbers: true,
  editorView: "split",
};

const STORAGE_KEY = "byos:prefs";

// Every allowed value, so a stale or hand-edited entry can't put the app in a
// state it doesn't know (a permissive chat mode, say).
const ALLOWED: { [K in keyof Preferences]?: readonly Preferences[K][] } = {
  theme: ["system", "light", "dark"],
  cursorDesign: ["arrow", "classic", "plane", "pebble", "system"],
  cursorColor: ["ink", "graphite", "sienna", "ember", "blush", "paper"],
  cursorSize: ["small", "default", "large"],
  textSize: ["small", "default", "large", "xlarge"],
  headingFont: ["serif", "sans"],
  uiFont: ["inter", "system"],
  highlight: ["blush", "ink"],
  density: ["comfortable", "compact"],
  driveLayout: ["list", "grid"],
  driveSort: ["none", "name:asc", "name:desc", "modified:desc", "modified:asc", "size:desc", "size:asc"],
  uploadConflict: ["ask", "keep", "replace", "skip"],
  uploadTarget: ["default", "ask"],
  chatStartMode: ["last", "read_only", "ask", "auto", "full"],
  editorTheme: ["graphite", "plum", "fjord", "linen"],
  editorFont: ["mono", "sans"],
  editorFontSize: ["13", "14", "15", "16", "18"],
  editorView: ["write", "split", "preview"],
};

function sanitize(raw: unknown): Preferences {
  const out: Preferences = {
    ...DEFAULT_PREFERENCES,
    chatStrategies: { ...DEFAULT_PREFERENCES.chatStrategies },
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const key of [
    "cursorMotion",
    "confirmDelete",
    "editorWrap",
    "editorLineNumbers",
  ] as const) {
    if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
  }
  // An id can't be checked here (prompts live on the server); a deleted one
  // falls back to none where it's used.
  if (typeof r.chatDefaultPrompt === "string" && r.chatDefaultPrompt) {
    out.chatDefaultPrompt = r.chatDefaultPrompt.slice(0, 64);
  }
  for (const [key, allowed] of Object.entries(ALLOWED) as [keyof Preferences, readonly unknown[]][]) {
    if (allowed.includes(r[key])) (out as unknown as Record<string, unknown>)[key] = r[key];
  }
  // Themes renamed when they were redrawn; keep the old choice's spirit.
  const oldTheme = { ink: "graphite", sienna: "plum", paper: "linen" }[r.editorTheme as string];
  if (oldTheme) out.editorTheme = oldTheme as EditorTheme;
  if (r.chatStrategies && typeof r.chatStrategies === "object") {
    const s = r.chatStrategies as Record<string, unknown>;
    for (const key of Object.keys(out.chatStrategies) as (keyof ChatStrategies)[]) {
      if (typeof s[key] === "boolean") out.chatStrategies[key] = s[key] as boolean;
    }
  }
  return out;
}

function read(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitize(null);
  }
}

type PreferencesContext = {
  prefs: Preferences;
  ready: boolean;
  setPrefs: (patch: Partial<Preferences>) => void;
  resetPrefs: () => void;
};

const Ctx = createContext<PreferencesContext | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(read());
    setReady(true);
    // Another tab changed them.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setState(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Page-wide effects live on <html>, where CSS can see them.
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.textSize = prefs.textSize;
    html.dataset.headingFont = prefs.headingFont;
    html.dataset.uiFont = prefs.uiFont;
    html.dataset.highlight = prefs.highlight;
    html.dataset.density = prefs.density;
  }, [prefs.textSize, prefs.headingFont, prefs.uiFont, prefs.highlight, prefs.density]);

  // The theme: the choice, or the device's setting (followed live) for System.
  // The root layout's boot script sets the same attribute before first paint.
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = prefs.theme === "dark" || (prefs.theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    if (prefs.theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [prefs.theme, ready]);

  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    setState((prev) => {
      const next = sanitize({ ...prev, ...patch });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage full or blocked: keep the change for this session */
      }
      return next;
    });
  }, []);

  const resetPrefs = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
    setState(sanitize(null));
  }, []);

  const value = useMemo(
    () => ({ prefs, ready, setPrefs, resetPrefs }),
    [prefs, ready, setPrefs, resetPrefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}
