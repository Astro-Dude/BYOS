"use client";

import type { StorageAccount } from "@byos/api-client";
import { Check } from "lucide-react";
import { useState } from "react";

import { StorageIcon, providerName } from "@/components/storage-icon";
import { formatBytes } from "@/lib/utils";

/** "Where should these go?" Shown before an upload when the user asks to pick
 *  a storage each time and has more than one connected. */
export function StoragePicker({
  storages,
  count,
  onPick,
  onCancel,
}: {
  storages: StorageAccount[];
  count: number;
  onPick: (storageId: string) => void;
  onCancel: () => void;
}) {
  const usable = storages.filter((s) => s.status === "connected");
  const [choice, setChoice] = useState(() => usable.find((s) => s.is_default)?.id ?? usable[0]?.id ?? "");

  return (
    <div className="modal-scrim z-50" onClick={onCancel}>
      <div className="modal-surface max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="type-heading-sm">Where should {count === 1 ? "it" : "they"} go?</h3>
        <p className="mt-1 text-[0.9375rem] text-zinc-500">
          {count === 1 ? "1 file" : `${count} files`}. You can change the default in Settings.
        </p>
        <div role="radiogroup" aria-label="Storage" className="mt-5 space-y-2">
          {usable.map((s) => {
            const on = choice === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChoice(s.id)}
                onDoubleClick={() => onPick(s.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  on ? "sel-fill" : "border-zinc-200 hover:border-zinc-400"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    on ? "bg-[color-mix(in_srgb,currentColor_15%,transparent)]" : "bg-zinc-100 text-zinc-700"
                  }`}
                >
                  <StorageIcon provider={s.provider} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[0.9375rem] ${on ? "text-white" : "text-zinc-900"}`}>
                    {s.label || providerName(s.provider)}
                  </span>
                  <span className={`block text-[0.8125rem] ${on ? "opacity-70" : "text-zinc-500"}`}>
                    {providerName(s.provider)} · {formatBytes(s.bytes)} used
                    {s.is_default ? " · Default" : ""}
                  </span>
                </span>
                {on ? <Check className="h-4 w-4 shrink-0 text-white" /> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="pill-sm-ghost">
            Cancel
          </button>
          <button type="button" disabled={!choice} onClick={() => onPick(choice)} className="pill-sm-filled">
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
