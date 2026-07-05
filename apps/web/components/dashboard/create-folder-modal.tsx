"use client";

import { Folder } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FOLDER_COLORS } from "@/lib/folder-colors";

export function CreateFolderModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, color: string | null) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await onCreate(clean, color);
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
        <div className="flex items-center gap-2">
          <Folder
            className="h-5 w-5 text-indigo-500"
            fill={color ?? "none"}
            style={color ? { color } : undefined}
          />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">New folder</h3>
        </div>

        <Input
          className="mt-4"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Folder name"
          autoFocus
        />

        <div className="mt-4">
          <p className="text-xs font-medium text-zinc-500">Color</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setColor(null)}
              aria-label="No color"
              className={`h-6 w-6 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 ${
                color === null ? "ring-2 ring-zinc-400 ring-offset-1" : ""
              }`}
            />
            {FOLDER_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                style={{ backgroundColor: c }}
                className={`h-6 w-6 rounded-full transition ${
                  color === c ? "ring-2 ring-zinc-400 ring-offset-1" : "hover:scale-110"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={onClose}
            className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
