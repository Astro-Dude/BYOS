"use client";

import type { AiKey } from "@byos/api-client";
import { Check, ChevronDown, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ModelSettings } from "@/components/byok/model-settings";
import { EFFORT_LABELS, type KeyParams, useModelCapabilities } from "@/lib/model-params";

/** One key's settings, inside the picker. Its own component so the model
 *  check runs only for the key being edited. */
function KeyEdit({
  apiKey,
  saving,
  onSave,
  onBack,
  onAllSettings,
  onModel,
  switching,
}: {
  apiKey: AiKey;
  saving: boolean;
  onSave: (patch: KeyParams) => void;
  onBack: () => void;
  onAllSettings?: () => void;
  onModel: (model: string) => void;
  switching: string | null;
}) {
  const { caps, loading } = useModelCapabilities(apiKey);
  return (
    <ModelSettings
      activeKey={apiKey}
      caps={caps}
      loading={loading}
      saving={saving}
      onSave={onSave}
      onBack={onBack}
      onAllSettings={onAllSettings}
      onModel={onModel}
      switching={switching}
    />
  );
}

/** The key picker at the top of the chat: which saved key (provider and
 *  account) the chat uses, and Edit on each for its model settings (effort,
 *  temperature, length). The model on a key is changed with /model, from the
 *  composer. Searchable once there are more than a handful of keys. */
export function KeyPicker({
  keys,
  activeKey,
  onPick,
  onAddKey,
  onSave,
  savingKeyId,
  onAllSettings,
  onModel,
  switching,
}: {
  keys: AiKey[];
  activeKey: AiKey | undefined;
  onPick: (id: string) => void;
  onAddKey?: () => void;
  onSave: (key: AiKey, patch: KeyParams) => void;
  savingKeyId: string | null;
  onAllSettings?: () => void;
  onModel: (key: AiKey, model: string) => void;
  /** A key's model switch in progress. */
  switching: { keyId: string; model: string } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The key whose settings are open, in place of the list.
  const [editing, setEditing] = useState<string | null>(null);
  const editKey = keys.find((k) => k.id === editing);
  const searchable = keys.length > 5;
  const q = query.trim().toLowerCase();
  const rows = q ? keys.filter((k) => `${k.name} ${k.model}`.toLowerCase().includes(q)) : keys;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setEditing(null);
    setActive(Math.max(0, keys.findIndex((k) => k.id === activeKey?.id)));
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // Only on opening: the highlight shouldn't jump while the list is used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== activeKey?.id) onPick(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (editing) {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(null);
      }
      return; // the settings' own inputs take the keys
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = rows.length;
      if (n) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      const row = rows[active];
      if (row) {
        e.preventDefault();
        pick(row.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  if (!activeKey) {
    return (
      <button
        type="button"
        onClick={onAddKey}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.9375rem] font-medium text-zinc-900 hover:bg-zinc-100"
      >
        <Plus className="h-4 w-4" /> Add a key
      </button>
    );
  }

  return (
    <div ref={ref} className="relative min-w-0" onKeyDown={onKeyDown}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${activeKey.name} · ${activeKey.model}`}
        className="flex min-w-0 max-w-[52vw] items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-zinc-100 aria-expanded:bg-zinc-100 sm:max-w-[26rem]"
      >
        <span className="min-w-0 truncate text-[0.9375rem] font-medium text-zinc-900">{activeKey.name}</span>
        <span className="hidden min-w-0 truncate font-mono text-[0.75rem] text-zinc-500 sm:inline">{activeKey.model}</span>
        {activeKey.reasoning_effort ? (
          <span className="hidden shrink-0 text-[0.75rem] text-zinc-500 md:inline">
            · {EFFORT_LABELS[activeKey.reasoning_effort]}
          </span>
        ) : null}
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          className={`dropdown-menu absolute left-0 top-full z-30 mt-2 flex max-h-[min(34rem,80vh)] flex-col rounded-2xl ${
            editKey ? "w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto p-1.5" : "w-[min(21rem,calc(100vw-1.5rem))] p-1.5"
          }`}
          style={{ boxShadow: "var(--shadow-popover)" }}
        >
          {editKey ? (
            <KeyEdit
              apiKey={editKey}
              saving={savingKeyId === editKey.id}
              onSave={(patch) => onSave(editKey, patch)}
              onModel={(model) => onModel(editKey, model)}
              switching={switching?.keyId === editKey.id ? switching.model : null}
              onBack={() => setEditing(null)}
              onAllSettings={
                onAllSettings
                  ? () => {
                      setOpen(false);
                      onAllSettings();
                    }
                  : undefined
              }
            />
          ) : (
            <>
              <p className="px-2.5 pb-1.5 pt-1 text-[0.8125rem] font-medium text-zinc-700">Keys</p>
              {searchable ? (
                <div className="mb-1.5 flex shrink-0 items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    placeholder="Search keys"
                    aria-label="Search keys"
                    className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-zinc-900 outline-none placeholder:text-zinc-500"
                  />
                </div>
              ) : null}
              <div role="listbox" aria-label="Keys" className="thin-scroll min-h-0 flex-1 overflow-y-auto">
                {rows.length === 0 ? <p className="px-3 py-2 text-[0.875rem] text-zinc-500">No keys match.</p> : null}
                {rows.map((k, i) => {
                  const current = k.id === activeKey.id;
                  return (
                    <div
                      key={k.id}
                      onMouseEnter={() => setActive(i)}
                      className={`flex items-center gap-1 rounded-xl pr-1.5 transition-colors ${
                        current ? "sel-fill" : i === active ? "bg-zinc-100 text-zinc-900" : "text-zinc-900"
                      }`}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={current}
                        onClick={() => pick(k.id)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.875rem]">{k.name}</span>
                          <span className={`block truncate text-[0.75rem] ${current ? "opacity-70" : "text-zinc-500"}`}>
                            <span className="font-mono">{k.model}</span>
                            {k.reasoning_effort ? ` · ${EFFORT_LABELS[k.reasoning_effort]} effort` : ""}
                          </span>
                        </span>
                        {current ? <Check className="h-4 w-4 shrink-0" /> : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(k.id)}
                        aria-label={`Edit ${k.name}`}
                        title="Edit settings"
                        className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[0.75rem] transition-colors ${
                          current
                            ? "opacity-80 hover:bg-[rgb(var(--c-paper)/0.15)] hover:opacity-100"
                            : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
                        }`}
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" /> Edit
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 shrink-0 border-t border-zinc-200 pt-1.5">
                {onAddKey ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onAddKey();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-[0.875rem] text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" /> Add a key
                  </button>
                ) : null}
                <p className="px-3 pb-1 pt-1 text-[0.75rem] text-zinc-400">
                  Edit a key to change its model, or type <span className="font-mono text-zinc-600">/model</span>.
                </p>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
