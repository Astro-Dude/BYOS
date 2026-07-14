"use client";

import { type AiConfig, ApiError } from "@byos/api-client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

// Quick-fill presets for common OpenAI-compatible endpoints. Any provider works
// — this is just to save typing the base URL.
// Model-name format depends on the provider (OpenAI: `gpt-4o-mini`; OpenRouter:
// `openai/gpt-4o-mini`), so the hint follows the chosen base URL.
function modelHint(baseUrl: string): string {
  const u = baseUrl.toLowerCase();
  if (u.includes("openrouter")) return "e.g. openai/gpt-4o-mini, google/gemini-2.5-flash";
  if (u.includes("generativelanguage")) return "e.g. gemini-2.5-flash";
  if (u.includes("groq")) return "e.g. llama-3.3-70b-versatile";
  if (u.includes("together")) return "e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo";
  return "e.g. gpt-4o-mini";
}

const PRESETS: { label: string; url: string }[] = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "Groq", url: "https://api.groq.com/openai/v1" },
  { label: "Together", url: "https://api.together.xyz/v1" },
];

const CUSTOM = "Custom";

// Map a stored base URL back to its provider (or "Custom" for anything else).
function providerFor(url: string | null | undefined): string {
  if (!url) return "OpenAI";
  const norm = url.trim().replace(/\/+$/, "");
  return PRESETS.find((p) => p.url === norm)?.label ?? CUSTOM;
}

export function ByomModal({
  config,
  onClose,
  onSaved,
}: {
  config: AiConfig | null;
  onClose: () => void;
  onSaved: (cfg: AiConfig) => void;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const configured = config?.configured ?? false;

  const [provider, setProvider] = useState(() => providerFor(config?.base_url));
  const [baseUrl, setBaseUrl] = useState(config?.base_url ?? "https://api.openai.com/v1");

  const selectProvider = (label: string) => {
    setProvider(label);
    const preset = PRESETS.find((p) => p.label === label);
    if (preset) setBaseUrl(preset.url); // Custom keeps whatever's typed
  };
  const [model, setModel] = useState(config?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(config?.system_prompt ?? "");
  const [temperature, setTemperature] = useState(String(config?.temperature ?? 0.2));
  const [maxTokens, setMaxTokens] = useState(String(config?.max_tokens ?? 1024));
  const [topP, setTopP] = useState(config?.top_p != null ? String(config.top_p) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!baseUrl.trim() || !model.trim()) return setError("Base URL and model are required.");
    if (!configured && !apiKey.trim()) return setError("An API key is required.");
    setBusy(true);
    try {
      const cfg = await authed((t) =>
        api.setAiConfig(t, {
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_key: apiKey.trim() || undefined,
          system_prompt: systemPrompt.trim() || null,
          temperature: Number(temperature),
          max_tokens: Number(maxTokens),
          top_p: topP.trim() ? Number(topP) : null,
        }),
      );
      toast("Model connected");
      onSaved(cfg);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't save. Check the URL, key, model.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await authed((t) => api.deleteAiConfig(t));
      toast("Model disconnected");
      onSaved({
        configured: false,
        base_url: null,
        model: null,
        system_prompt: null,
        temperature: null,
        max_tokens: null,
        top_p: null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't disconnect");
      setBusy(false);
    }
  };

  const field = "text-sm";
  const label = "mb-1 block text-xs font-medium text-zinc-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Bring your own model
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          Any OpenAI-compatible endpoint. Your key is encrypted and only used for your requests.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <span className={label}>Provider</span>
            <select
              value={provider}
              onChange={(e) => selectProvider(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {PRESETS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </select>
          </div>
          <div>
            <span className={label}>Base URL</span>
            <Input
              className={`${field} ${provider !== CUSTOM ? "opacity-60" : ""}`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={provider !== CUSTOM}
              placeholder="https://your-endpoint/v1"
            />
            {provider === CUSTOM ? (
              <p className="mt-1 text-xs text-zinc-400">
                Any OpenAI-compatible endpoint (including a local one).
              </p>
            ) : null}
          </div>
          <div>
            <span className={label}>Model</span>
            <Input
              className={field}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={modelHint(baseUrl)}
            />
          </div>
          <div>
            <span className={label}>API key</span>
            <Input
              type="password"
              className={field}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={configured ? "•••••••• (leave blank to keep)" : "sk-…"}
            />
          </div>
          <div>
            <span className={label}>System prompt (optional)</span>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder="Set the assistant's behavior…"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className={label}>Temperature</span>
              <Input
                className={field}
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </div>
            <div>
              <span className={label}>Max tokens</span>
              <Input
                className={field}
                type="number"
                min="1"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
            <div>
              <span className={label}>Top-p</span>
              <Input
                className={field}
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={topP}
                onChange={(e) => setTopP(e.target.value)}
                placeholder="—"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {configured ? (
            <button
              onClick={remove}
              disabled={busy}
              className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-60"
            >
              Disconnect
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              onClick={onClose}
              className="border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
