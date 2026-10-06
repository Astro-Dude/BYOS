"use client";

import { type AiKey, ApiError, type ReasoningEffort } from "@byos/api-client";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Dropdown } from "@/components/byok/dropdown";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { isChatModel } from "@/lib/key-models";
import { cachedModelCheck, rememberModelCheck } from "@/lib/model-check-cache";
import { EFFORT_HINTS, EFFORT_LABELS, EFFORT_ORDER } from "@/lib/model-params";

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
  const [effort, setEffort] = useState<ReasoningEffort | "">(existing?.reasoning_effort ?? "");
  const [showKey, setShowKey] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Ask the provider what this key can use, once the URL and key settle. An
  // existing key can list without retyping it: the API uses the saved one.
  const authedRef = useRef(authed);
  authedRef.current = authed;
  const existingId = existing?.id;
  useEffect(() => {
    const url = baseUrl.trim();
    const key = apiKey.trim();
    if (!url || (!key && !existingId)) {
      setModels([]);
      setModelsError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setModelsLoading(true);
      setModelsError(null);
      try {
        const res = await authedRef.current((t) =>
          api.listProviderModels(t, key ? { base_url: url, api_key: key } : { base_url: url, key_id: existingId }),
        );
        if (cancelled) return;
        setModels(res.models);
      } catch (err) {
        if (cancelled) return;
        setModels([]);
        setModelsError(err instanceof ApiError ? err.detail : "Couldn't load models.");
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [baseUrl, apiKey, existingId]);

  // Test the chosen model with one tiny request. That tells us whether it works
  // at all, and which settings it refuses, which no list of model names can
  // keep up with.
  const [unsupported, setUnsupported] = useState<string[]>([]);
  // null until a check has answered: unknown isn't the same as "not supported".
  const [efforts, setEfforts] = useState<ReasoningEffort[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [modelProblem, setModelProblem] = useState<string | null>(null);
  useEffect(() => {
    const url = baseUrl.trim();
    const key = apiKey.trim();
    const name = model.trim();
    setModelProblem(null);
    if (!url || !name || (!key && !existingId)) {
      setUnsupported([]);
      setEfforts(null);
      return;
    }
    // Checked before in this browser: use that, no request. A new API key is
    // still verified when the key is saved.
    const known = cachedModelCheck(url, name);
    if (known) {
      setUnsupported(known.unsupported);
      setEfforts(known.efforts);
      setChecking(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await authedRef.current((t) =>
          api.checkModel(
            t,
            key
              ? { base_url: url, model: name, api_key: key }
              : { base_url: url, model: name, key_id: existingId },
          ),
        );
        rememberModelCheck(url, name, { unsupported: res.unsupported, efforts: res.efforts ?? [] });
        if (!cancelled) {
          setUnsupported(res.unsupported);
          setEfforts(res.efforts ?? []);
        }
      } catch (err) {
        if (cancelled) return;
        setUnsupported([]);
        setEfforts(null);
        setModelProblem(err instanceof ApiError ? err.detail : "Couldn't check this model.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [baseUrl, apiKey, model, existingId]);

  const chatModels = models.filter(isChatModel);
  const embeddingModels = models.filter((m) => /embed/i.test(m));
  const temperatureOff = unsupported.includes("temperature");
  const topPOff = unsupported.includes("top_p");
  const effortOff = efforts !== null && efforts.length === 0;
  const offNote = [temperatureOff && "temperature", topPOff && "top-p", effortOff && "reasoning effort"]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]*)$/, " or $1");
  const modelsEmptyText = modelsError
    ? `${modelsError} You can still type a name.`
    : !apiKey.trim() && !existing
      ? "Enter your API key to see models."
      : "No models found. Type a name.";

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
        top_p: topP.trim() && !topPOff ? Number(topP) : null,
        reasoning_effort: effort && !effortOff ? effort : null,
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-2">
          <div>
            <span className={label}>Provider</span>
            <Dropdown
              block
              value={provider}
              onChange={selectProvider}
              ariaLabel="Provider"
              options={[
                ...PRESETS.map((p) => ({ value: p.label, label: p.label })),
                { value: CUSTOM, label: "Custom" },
              ]}
              className={field}
            />
          </div>
          <div>
            <span className={label}>Base URL</span>
            <input
              className={`${field} disabled:cursor-not-allowed ${provider !== CUSTOM ? "opacity-60" : ""}`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={provider !== CUSTOM}
              placeholder="https://your-endpoint/v1"
            />
          </div>
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
          <span className={label}>Model</span>
          <Dropdown
            block
            creatable
            value={model}
            onChange={setModel}
            ariaLabel="Model"
            options={chatModels.map((m) => ({ value: m, label: m }))}
            loading={modelsLoading}
            emptyText={modelsEmptyText}
            placeholder={modelHint(baseUrl)}
            className={field}
          />
          {checking ? (
            <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking this model
            </p>
          ) : modelProblem ? (
            <p className="mt-1 text-[0.8125rem] text-red-500">{modelProblem}</p>
          ) : null}
        </div>
        <div>
          <span className={label}>Embedding model (optional)</span>
          <Dropdown
            block
            creatable
            value={embeddingModel}
            onChange={setEmbeddingModel}
            ariaLabel="Embedding model"
            options={[
              ...(embeddingModel ? [{ value: "", label: "None" }] : []),
              ...embeddingModels.map((m) => ({ value: m, label: m })),
            ]}
            loading={modelsLoading}
            emptyText={modelsEmptyText}
            placeholder="None (needed to search your files)"
            className={field}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2">
          <div>
            <span className={label}>Temperature</span>
            <input
              className={`${field} disabled:cursor-not-allowed disabled:opacity-50`}
              disabled={temperatureOff}
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperatureOff ? "" : temperature}
              placeholder={temperatureOff ? "Not supported" : undefined}
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
              className={`${field} disabled:cursor-not-allowed disabled:opacity-50`}
              disabled={topPOff}
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={topPOff ? "" : topP}
              onChange={(e) => setTopP(e.target.value)}
              placeholder={topPOff ? "Not supported" : "Optional"}
            />
          </div>
        </div>
        <div>
          <span className={label}>Reasoning effort</span>
          <Dropdown
            block
            disabled={effortOff}
            ariaLabel="Reasoning effort"
            value={effortOff ? "" : effort}
            onChange={(v) => setEffort(v as ReasoningEffort | "")}
            // No options when unsupported, so the field reads "Not supported"
            // rather than a greyed-out "Automatic".
            options={
              effortOff
                ? []
                : [
                    { value: "", label: "Automatic", hint: "The lowest it takes. Quickest and cheapest" },
                    ...(efforts ?? EFFORT_ORDER).map((level) => ({
                      value: level,
                      label: EFFORT_LABELS[level],
                      hint: EFFORT_HINTS[level],
                    })),
                  ]
            }
            placeholder={effortOff ? "Not supported by this model" : "Automatic"}
            className={field}
          />
          {!effortOff && effort && efforts && !efforts.includes(effort) ? (
            <p className="mt-1.5 text-[0.8125rem] text-amber-700">
              This model doesn&apos;t offer {EFFORT_LABELS[effort].toLowerCase()}; the nearest level it has is used.
            </p>
          ) : null}
        </div>
        {offNote ? (
          <p className="text-[0.8125rem] text-zinc-500">
            This model doesn&apos;t support {offNote}, so {offNote.includes(" or ") ? "they're" : "it's"} off.
          </p>
        ) : null}
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
