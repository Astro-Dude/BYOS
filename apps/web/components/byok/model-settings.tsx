"use client";

import type { AiKey, ModelCheck, ReasoningEffort } from "@byos/api-client";
import { ApiError } from "@byos/api-client";
import { ArrowLeft, Check, ChevronDown, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAuthed } from "@/lib/auth-context";
import { loadKeyModels } from "@/lib/key-models";

import {
  EFFORT_HINTS,
  EFFORT_LABELS,
  EFFORT_ORDER,
  type KeyParams,
  TOKEN_PRESETS,
  tokensLabel,
} from "@/lib/model-params";

const pill = (on: boolean) =>
  `rounded-full px-3 py-1 text-[0.8125rem] transition-colors ${
    on ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
  }`;

/** The key's model: the current one, opening in place (not a floating menu,
 *  which the panel's scroll would clip) to a searchable list of the provider's
 *  models. A name the list lacks can be typed and used. */
function ModelField({
  apiKey,
  switching,
  onModel,
}: {
  apiKey: AiKey;
  switching: string | null;
  onModel: (model: string) => void;
}) {
  const authed = useAuthed();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    searchRef.current?.focus();
    if (models) return;
    let cancelled = false;
    loadKeyModels(authed, apiKey)
      .then((list) => !cancelled && setModels(list))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.detail : "Couldn't load the models."));
    return () => {
      cancelled = true;
    };
    // Loaded once per opening of this key's panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = query.trim().toLowerCase();
  const all = models ? (models.includes(apiKey.model) ? models : [apiKey.model, ...models]) : [];
  const hits = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  const custom = q && !all.some((m) => m.toLowerCase() === q) ? query.trim() : null;
  const rows = custom ? [...hits, custom] : hits;

  useEffect(() => {
    if (open) setActive(Math.max(0, rows.indexOf(apiKey.model)));
    // When the list arrives or the search changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, models, q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (model: string) => {
    setOpen(false);
    if (model !== apiKey.model) onModel(model);
  };

  return (
    <div className="mt-4">
      <p className="text-[0.8125rem] font-medium text-zinc-700">Model</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!!switching}
        className={`mt-2 flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-wait ${
          open ? "border-zinc-900" : "border-zinc-200 hover:border-zinc-400"
        }`}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-zinc-900">
          {switching ?? apiKey.model}
        </span>
        {switching ? (
          <span className="flex shrink-0 items-center gap-1 text-[0.75rem] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Trying
          </span>
        ) : (
          <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open ? (
        <div className="mt-1.5 rounded-xl border border-zinc-200 p-1">
          <div className="mb-1 flex items-center gap-2 rounded-lg bg-zinc-100 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const n = rows.length;
                  if (n) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const row = rows[active];
                  if (row) pick(row);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
              placeholder="Search, or type a name"
              aria-label="Search models"
              className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-zinc-900 outline-none placeholder:text-zinc-500"
            />
          </div>
          <div ref={listRef} role="listbox" aria-label="Models" className="thin-scroll max-h-52 overflow-y-auto">
            {!models && !error ? (
              <p className="flex items-center gap-2 px-2.5 py-1.5 text-[0.8125rem] text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models
              </p>
            ) : null}
            {error && !rows.length ? (
              <p className="px-2.5 py-1.5 text-[0.8125rem] text-zinc-500">{error} Type a name to use it.</p>
            ) : null}
            {models && !rows.length ? (
              <p className="px-2.5 py-1.5 text-[0.8125rem] text-zinc-500">No models match.</p>
            ) : null}
            {rows.map((m, i) => {
              const current = m === apiKey.model;
              return (
                <button
                  key={`${m}-${i}`}
                  data-index={i}
                  type="button"
                  role="option"
                  aria-selected={current}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                    current ? "bg-zinc-900 text-white" : i === active ? "bg-zinc-100 text-zinc-900" : "text-zinc-800"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">
                    {m === custom ? `Use “${m}”` : m}
                  </span>
                  {current ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A key's model settings: the model, reasoning effort, temperature, top-p and length.
 *  Shown in the chat's key picker (Edit on a key). Every change is saved to the
 *  key at once, so it holds for the next chat too. Settings the model doesn't
 *  take are shown, greyed, with the reason. */
export function ModelSettings({
  activeKey,
  caps,
  loading,
  saving,
  onSave,
  onBack,
  onAllSettings,
  onModel,
  switching = null,
}: {
  activeKey: AiKey;
  caps: ModelCheck | null;
  loading: boolean;
  saving: boolean;
  onSave: (patch: KeyParams) => void;
  onBack?: () => void;
  onAllSettings?: () => void;
  /** Move the key to another of its provider's models. */
  onModel?: (model: string) => void;
  /** The model being switched to, while it's tried. */
  switching?: string | null;
}) {
  // Sliders move freely and save when let go, not on every step.
  const [temperature, setTemperature] = useState(activeKey.temperature);
  const [topP, setTopP] = useState(activeKey.top_p ?? 1);
  const [tokens, setTokens] = useState(String(activeKey.max_tokens));
  useEffect(() => {
    setTemperature(activeKey.temperature);
    setTopP(activeKey.top_p ?? 1);
    setTokens(String(activeKey.max_tokens));
  }, [activeKey]);

  const efforts: ReasoningEffort[] | null = caps ? caps.efforts : null;
  const effortOff = efforts !== null && efforts.length === 0;
  const temperatureOff = !!caps?.unsupported.includes("temperature");
  const topPOff = !!caps?.unsupported.includes("top_p");
  const current = activeKey.reasoning_effort;
  const commitTokens = () => {
    const n = Math.round(Number(tokens));
    if (Number.isFinite(n) && n >= 1 && n <= 32000 && n !== activeKey.max_tokens) onSave({ max_tokens: n });
    else setTokens(String(activeKey.max_tokens));
  };

  return (
    <div className="p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to keys"
              className="-ml-1 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] text-zinc-900">{activeKey.name}</p>
            {onModel ? null : <p className="truncate font-mono text-[0.75rem] text-zinc-500">{activeKey.model}</p>}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[0.75rem] text-zinc-500">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving
            </>
          ) : (
            <>
              <Check className="h-3 w-3" /> Saved
            </>
          )}
        </span>
      </div>

      {onModel ? <ModelField apiKey={activeKey} switching={switching} onModel={onModel} /> : null}

      {/* Reasoning effort */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[0.8125rem] font-medium text-zinc-700">Reasoning effort</p>
          <p className="truncate text-[0.75rem] text-zinc-500">
            {effortOff
              ? "Not supported by this model"
              : current
                ? EFFORT_HINTS[current]
                : "The lowest it takes"}
          </p>
        </div>
        {effortOff ? (
          <p className="mt-2 rounded-xl bg-zinc-100 px-3 py-2 text-[0.8125rem] text-zinc-500">
            This model answers without a thinking step, so there&apos;s nothing to set.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Reasoning effort">
            <button
              type="button"
              role="radio"
              aria-checked={!current}
              onClick={() => onSave({ reasoning_effort: null })}
              className={pill(!current)}
            >
              Auto
            </button>
            {(efforts ?? EFFORT_ORDER.slice(2, 5)).map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={current === level}
                title={EFFORT_HINTS[level]}
                onClick={() => onSave({ reasoning_effort: level })}
                className={pill(current === level)}
              >
                {EFFORT_LABELS[level]}
              </button>
            ))}
            {loading ? <Loader2 className="ml-1 h-3.5 w-3.5 self-center animate-spin text-zinc-400" /> : null}
          </div>
        )}
      </div>

      {/* Temperature */}
      <div className={`mt-4 ${temperatureOff ? "opacity-50" : ""}`}>
        <div className="flex items-baseline justify-between">
          <p className="text-[0.8125rem] font-medium text-zinc-700">Temperature</p>
          <p className="font-mono text-[0.75rem] text-zinc-600">
            {temperatureOff ? "Not supported" : temperature.toFixed(1)}
          </p>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          disabled={temperatureOff}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          onPointerUp={() => temperature !== activeKey.temperature && onSave({ temperature })}
          onKeyUp={() => temperature !== activeKey.temperature && onSave({ temperature })}
          aria-label="Temperature"
          className="mt-2 w-full accent-zinc-900 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-[0.6875rem] text-zinc-400">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>

      {/* Top-p */}
      <div className={`mt-3 ${topPOff ? "opacity-50" : ""}`}>
        <div className="flex items-baseline justify-between">
          <p className="text-[0.8125rem] font-medium text-zinc-700">Top-p</p>
          <span className="flex items-center gap-2 font-mono text-[0.75rem] text-zinc-600">
            {topPOff ? "Not supported" : activeKey.top_p == null ? "Default" : topP.toFixed(2)}
            {!topPOff && activeKey.top_p != null ? (
              <button
                type="button"
                onClick={() => onSave({ top_p: null })}
                className="font-sans text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
              >
                Reset
              </button>
            ) : null}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          disabled={topPOff}
          value={topP}
          onChange={(e) => setTopP(Number(e.target.value))}
          onPointerUp={() => topP !== activeKey.top_p && onSave({ top_p: topP })}
          onKeyUp={() => topP !== activeKey.top_p && onSave({ top_p: topP })}
          aria-label="Top-p"
          className="mt-2 w-full accent-zinc-900 disabled:cursor-not-allowed"
        />
      </div>

      {/* Length */}
      <div className="mt-3">
        <p className="text-[0.8125rem] font-medium text-zinc-700">Max tokens</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {TOKEN_PRESETS.slice(1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onSave({ max_tokens: n })}
              className={pill(activeKey.max_tokens === n)}
            >
              {tokensLabel(n)}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={32000}
            value={tokens}
            onChange={(e) => setTokens(e.target.value)}
            onBlur={commitTokens}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTokens();
            }}
            aria-label="Max tokens"
            className="w-20 rounded-full border border-zinc-200 px-3 py-1 text-[0.8125rem] text-zinc-900 outline-none focus:border-zinc-900"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-200 pt-3 text-[0.75rem] text-zinc-500">
        <span>Saved to this key.</span>
        {onAllSettings ? (
          <button
            type="button"
            onClick={onAllSettings}
            className="shrink-0 text-zinc-700 underline-offset-2 hover:text-zinc-900 hover:underline"
          >
            All settings
          </button>
        ) : null}
      </div>
    </div>
  );
}
