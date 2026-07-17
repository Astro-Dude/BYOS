"use client";

import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ConflictResolution = "replace" | "keep" | "skip";

/** Shown when uploads collide with existing file names in the target folder.
 *  One choice applies to the whole batch (handles many collisions at once). */
export function UploadConflictModal({
  names,
  folderLabel,
  onResolve,
  onCancel,
}: {
  names: string[];
  folderLabel: string;
  onResolve: (mode: ConflictResolution) => void;
  onCancel: () => void;
}) {
  const many = names.length > 1;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {many ? `${names.length} files already exist` : "File already exists"}
        </h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {many ? "These names" : "This name"} already {many ? "exist" : "exists"} in {folderLabel}.
          Choose what to do{many ? " with all of them" : ""}.
        </p>

        <div className="my-3 max-h-40 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          {names.map((n, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="truncate">{n}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => onResolve("keep")}
            className="w-full bg-indigo-600 hover:bg-indigo-500"
          >
            Keep both {many ? "(rename new)" : "(rename new copy)"}
          </Button>
          <Button
            onClick={() => onResolve("replace")}
            className="w-full border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Replace existing
          </Button>
          <Button
            onClick={() => onResolve("skip")}
            className="w-full border border-transparent bg-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Skip {many ? "these" : "this"}
          </Button>
        </div>
      </div>
    </div>
  );
}
