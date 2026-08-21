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
      className="modal-scrim z-[120]"
      onClick={onCancel}
    >
      <div
        className="modal-surface max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="type-heading-sm">
          {many ? `${names.length} files already exist` : "File already exists"}
        </h3>
        <p className="mt-1 text-[0.9375rem] text-zinc-600">
          {many ? "These names" : "This name"} already {many ? "exist" : "exists"} in {folderLabel}.
          Choose what to do{many ? " with all of them" : ""}.
        </p>

        <div className="my-3 max-h-40 overflow-y-auto rounded-md border border-zinc-200">
          {names.map((n, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 text-[0.9375rem] text-zinc-700"
            >
              <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="truncate">{n}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => onResolve("keep")}
            className="w-full bg-zinc-900 hover:bg-zinc-800"
          >
            Keep both {many ? "(rename new)" : "(rename new copy)"}
          </Button>
          <Button
            onClick={() => onResolve("replace")}
            className="w-full border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
          >
            Replace existing
          </Button>
          <Button
            onClick={() => onResolve("skip")}
            className="w-full border border-transparent bg-transparent text-zinc-500 hover:bg-zinc-100"
          >
            Skip {many ? "these" : "this"}
          </Button>
        </div>
      </div>
    </div>
  );
}
