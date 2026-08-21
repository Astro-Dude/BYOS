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
      className="modal-scrim z-[120]"
      onClick={onClose}
    >
      <div
        className="modal-surface max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="type-heading-sm">
          {existing ? "Edit key" : "Add a key"}
        </h3>
        <p className="mt-1 text-[0.9375rem] text-zinc-500">
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
