"use client";

import { type AiKey, ApiError } from "@byos/api-client";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

const PRESETS: { label: string; url: string }[] = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "Groq", url: "https://api.groq.com/openai/v1" },
  { label: "Together", url: "https://api.together.xyz/v1" },
];
const CUSTOM = "Custom";

function providerFor(url: string | null | undefined): string {
  if (!url) return "OpenAI";
  const norm = url.trim().replace(/\/+$/, "");
  return PRESETS.find((p) => p.url === norm)?.label ?? CUSTOM;
}

function modelHint(baseUrl: string): string {
  const u = baseUrl.toLowerCase();
  if (u.includes("openrouter")) return "e.g. openai/gpt-4o-mini";
  if (u.includes("generativelanguage")) return "e.g. gemini-2.0-flash";
  if (u.includes("groq")) return "e.g. llama-3.3-70b-versatile";
  if (u.includes("together")) return "e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo";
  return "e.g. gpt-4o-mini";
}

const field =
  "w-full rounded-md border border-zinc-200 bg-black/[0.03] px-3 py-2 text-sm text-zinc-900 " +
  "outline-none placeholder:text-zinc-500 focus:border-indigo-500 " +
  "dark:border-white/10 dark:bg-white/5 dark:text-zinc-100";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

export function KeyEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: AiKey | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const authed = useAuthed();
  const [name, setName] = useState(existing?.name ?? "");
  const [provider, setProvider] = useState(() => providerFor(existing?.base_url));
  const [baseUrl, setBaseUrl] = useState(existing?.base_url ?? "https://api.openai.com/v1");
  const [model, setModel] = useState(existing?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState(existing?.embedding_model ?? "");
  const [temperature, setTemperature] = useState(String(existing?.temperature ?? 0.2));
  const [maxTokens, setMaxTokens] = useState(String(existing?.max_tokens ?? 1024));
  const [topP, setTopP] = useState(existing?.top_p != null ? String(existing.top_p) : "");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectProvider = (labelValue: string) => {
    setProvider(labelValue);
    const preset = PRESETS.find((p) => p.label === labelValue);
    if (preset) setBaseUrl(preset.url);
  };

  const save = async () => {
    setError(null);
    if (!name.trim() || !baseUrl.trim() || !model.trim())
      return setError("Name, base URL and model are required.");
    if (!existing && !apiKey.trim()) return setError("An API key is required.");
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        base_url: baseUrl.trim(),
        model: model.trim(),
        api_key: apiKey.trim() || undefined,
        embedding_model: embeddingModel.trim() || null,
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
        top_p: topP.trim() ? Number(topP) : null,
      };
      await authed((t) =>
        existing ? api.updateAiKey(t, existing.id, input) : api.createAiKey(t, input),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't save. Check the URL, key, model.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="thin-scroll max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {existing ? "Edit key" : "Add a key"}
        </h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Any OpenAI-compatible endpoint. Your key is encrypted and only used for your requests.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <span className={label}>Name</span>
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. OpenRouter · GPT-4o mini"
            />
          </div>
          <div>
            <span className={label}>Provider</span>
            <select
              value={provider}
              onChange={(e) => selectProvider(e.target.value)}
              className={field}
            >
              {PRESETS.map((p) => (
                <option key={p.label} value={p.label} className="bg-white dark:bg-zinc-900">
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM} className="bg-white dark:bg-zinc-900">
                Custom…
              </option>
            </select>
          </div>
          <div>
            <span className={label}>Base URL</span>
            <input
              className={`${field} ${provider !== CUSTOM ? "opacity-60" : ""}`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={provider !== CUSTOM}
              placeholder="https://your-endpoint/v1"
            />
          </div>
          <div>
            <span className={label}>Model</span>
            <input
              className={field}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={modelHint(baseUrl)}
            />
          </div>
          <div>
            <span className={label}>API key</span>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                className={`${field} pr-10`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={existing ? "•••••••• (leave blank to keep)" : "sk-…"}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide key" : "Show key"}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <span className={label}>Embedding model (optional)</span>
            <input
              className={field}
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              placeholder="e.g. text-embedding-3-small — enables semantic retrieval"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className={label}>Temperature</span>
              <input
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
              <input
                className={field}
                type="number"
                min="1"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
            <div>
              <span className={label}>Top-p</span>
              <input
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
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-black/5 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
