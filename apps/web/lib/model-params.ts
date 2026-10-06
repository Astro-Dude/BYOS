"use client";

import type { AiKey, AiKeyInput, ModelCheck, ReasoningEffort } from "@byos/api-client";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { cachedModelCheck, rememberModelCheck } from "@/lib/model-check-cache";

/** Reasoning effort, lowest first. Most of what BYOS asks a model is simple,
 *  so "Automatic" (the lowest a model takes) is the default. */
export const EFFORT_ORDER: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};
export const EFFORT_HINTS: Record<ReasoningEffort, string> = {
  none: "Answers straight away",
  minimal: "A quick look first",
  low: "Light thinking",
  medium: "Balanced",
  high: "Thinks it through. Slower",
  xhigh: "Deepest. Slowest and costliest",
};

/** Quick picks for /temperature and /tokens. */
export const TEMPERATURE_PRESETS: { value: number; label: string; hint: string }[] = [
  { value: 0, label: "0", hint: "Precise. Same answer every time" },
  { value: 0.2, label: "0.2", hint: "Focused" },
  { value: 0.5, label: "0.5", hint: "Balanced" },
  { value: 0.8, label: "0.8", hint: "Varied" },
  { value: 1.2, label: "1.2", hint: "Creative" },
];
export const TOKEN_PRESETS = [512, 1024, 2048, 4096, 8192, 16384];

/** 1024 → "1k", 4096 → "4k", 1500 → "1.5k". */
export function tokensLabel(n: number): string {
  if (n % 1024 === 0) return `${n / 1024}k`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export function isEffort(value: string): value is ReasoningEffort {
  return (EFFORT_ORDER as string[]).includes(value);
}

/** What the key's model takes. Asked once (one tiny request) and remembered
 *  in this browser, so opening the chat costs nothing after that. */
export function useModelCapabilities(key: AiKey | undefined): { caps: ModelCheck | null; loading: boolean } {
  const authed = useAuthed();
  const [caps, setCaps] = useState<ModelCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const baseUrl = key?.base_url;
  const model = key?.model;
  const id = key?.id;
  useEffect(() => {
    if (!baseUrl || !model || !id) {
      setCaps(null);
      return;
    }
    const known = cachedModelCheck(baseUrl, model);
    if (known) {
      setCaps(known);
      return;
    }
    let cancelled = false;
    setCaps(null);
    setLoading(true);
    authed((t) => api.checkModel(t, { base_url: baseUrl, model, key_id: id }))
      .then((res) => {
        const check = { unsupported: res.unsupported, efforts: res.efforts ?? [] };
        rememberModelCheck(baseUrl, model, check);
        if (!cancelled) setCaps(check);
      })
      .catch(() => undefined) // the controls stay usable; the provider has the final say
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, baseUrl, model, id]);
  return { caps, loading };
}

/** The settings that can be changed from the chat. */
export type KeyParams = Partial<Pick<AiKeyInput, "model" | "temperature" | "max_tokens" | "top_p" | "reasoning_effort">>;

/** The full update for a key with some settings changed. No API key is sent,
 *  so the server keeps the stored one and doesn't re-test the connection. */
export function keyUpdate(key: AiKey, patch: KeyParams): AiKeyInput {
  return {
    name: key.name,
    base_url: key.base_url,
    model: key.model,
    embedding_model: key.embedding_model,
    temperature: key.temperature,
    max_tokens: key.max_tokens,
    top_p: key.top_p,
    reasoning_effort: key.reasoning_effort,
    ...patch,
  };
}
