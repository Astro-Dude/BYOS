"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RenameModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void> | void;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        <Input
          className="mt-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={onClose}
            className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Rename"}
          </Button>
        </div>
      </div>
    </div>
  );
}
