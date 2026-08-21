"use client";

import { Button } from "@/components/ui/button";

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-scrim z-50"
      onClick={onCancel}
    >
      <div
        className="modal-surface max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="type-heading-sm">{title}</h3>
        <p className="mt-2 break-words text-[0.9375rem] text-zinc-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            onClick={onCancel}
            className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-500 focus-visible:outline-red-600"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
