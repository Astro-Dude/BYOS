"use client";

import { type AiKey } from "@byos/api-client";

import { KeyForm } from "@/components/byok/key-form";

/** Modal wrapper around KeyForm — the BYOK vault's add/edit dialog. The fields
 *  themselves live in KeyForm, which the preview panel also renders inline. */
export function KeyEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: AiKey | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
        <div className="mt-4">
          <KeyForm
            existing={existing}
            onCancel={onClose}
            onSaved={() => {
              onSaved();
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
