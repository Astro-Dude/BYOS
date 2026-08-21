"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RenameModal({
  title,
  initial,
  onClose,
  onSubmit,
  confirmLabel = "Rename",
  placeholder,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void> | void;
  confirmLabel?: string;
  placeholder?: string;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const clean = name.trim();
    if (!clean || clean === initial) return onClose();
    setBusy(true);
    try {
      await onSubmit(clean);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-scrim z-50"
      onClick={onClose}
    >
      <div
        className="modal-surface max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="type-heading-sm">{title}</h3>
        <Input
          className="mt-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={onClose}
            className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
