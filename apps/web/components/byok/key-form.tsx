"use client";

import { type AiKey, ApiError } from "@byos/api-client";
import { Eye, EyeOff, Loader2 } from "lucide-react";
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
  "w-full rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-[0.9375rem] text-zinc-900 " +
  "outline-none placeholder:text-zinc-500 focus:border-zinc-900 " +
  "";
const label = "mb-1 block text-[0.8125rem] font-medium text-zinc-500";

/** Every field of a BYOK connection, with its own validation and save.
 *
 *  Presentation-free on purpose: the BYOK page wraps it in a modal, and the
 *  preview panel drops it inline where there's no key yet. Keeping one copy of
 *  the fields means the two can't drift — a new setting shows up in both.
 */
export function KeyForm({
  existing,
  onSaved,
  onCancel,
  submitLabel,
}: {
  existing: AiKey | null;
  /** Receives the saved key, so a caller can select it immediately. */
  onSaved: (key: AiKey) => void;
  /** Omit to hide the Cancel button (inline use has nothing to cancel to). */
  onCancel?: () => void;
  submitLabel?: string;
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
  const [revealing, setRevealing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Show the saved key. It isn't in the list response, so the first reveal
   *  fetches it; afterwards it's just a visibility toggle. Once loaded it sits in
   *  the field, so saving keeps it rather than blanking it. */
  const toggleKey = async () => {
    if (showKey) return setShowKey(false);
    if (apiKey || !existing) return setShowKey(true);
    setRevealing(true);
    setError(null);
    try {
      const { api_key } = await authed((t) => api.revealAiKey(t, existing.id));
      setApiKey(api_key);
      setShowKey(true);
    } catch {
      setError("Couldn't load the saved key.");
    } finally {
      setRevealing(false);
    }
  };

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
      const saved = await authed((t) =>
        existing ? api.updateAiKey(t, existing.id, input) : api.createAiKey(t, input),
      );
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't save. Check the URL, key, model.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="space-y-3">
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
              <option key={p.label} value={p.label} className="bg-white">
                {p.label}
              </option>
            ))}
            <option value={CUSTOM} className="bg-white">
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
              autoComplete="off"
            />
            <button
              type="button"
              tabIndex={-1}
              disabled={revealing}
              onClick={() => void toggleKey()}
              aria-label={showKey ? "Hide key" : "Show key"}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
            >
              {revealing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : showKey ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2">
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
        {error ? <p className="text-[0.9375rem] text-red-500">{error}</p> : null}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="pill-sm-ghost"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="pill-sm-filled disabled:bg-transparent disabled:text-zinc-400 disabled:ring-1 disabled:ring-inset disabled:ring-zinc-200"
        >
          {busy ? "Saving…" : (submitLabel ?? "Save")}
        </button>
      </div>
    </form>
  );
}
