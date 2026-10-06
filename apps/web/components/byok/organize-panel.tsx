"use client";

import type { OrganizeOptions } from "@byos/api-client";
import { FolderTree, X } from "lucide-react";

import { Segmented, Toggle } from "@/components/settings/controls";
import { GROUP_LABELS } from "@/lib/organize";

/** /organize's settings, above the composer like the other command pickers.
 *  Enter starts (the composer handles that), Esc closes. */
export function OrganizePanel({
  value,
  onChange,
  onStart,
  onClose,
  applies,
  maxHeight,
}: {
  value: OrganizeOptions;
  onChange: (next: OrganizeOptions) => void;
  onStart: () => void;
  onClose: () => void;
  /** Whether moves happen as it goes (auto / full access) or wait for approval. */
  applies: boolean;
  maxHeight?: number;
}) {
  const set = (patch: Partial<OrganizeOptions>) => onChange({ ...value, ...patch });
  const row = "flex items-center justify-between gap-4 py-2.5";
  const toggles: { key: "rename" | "keep_existing" | "read_contents" | "tags"; label: string; hint: string }[] = [
    {
      key: "rename",
      label: "Rename files",
      hint: value.rename ? "Only names that don't say what the file is" : "Every name stays exactly as it is",
    },
    {
      key: "keep_existing",
      label: "Keep my folders",
      hint: value.keep_existing ? "Builds on the folders you have" : "May move or rename folders. Never deletes",
    },
    {
      key: "read_contents",
      label: "Look inside files",
      hint: value.read_contents ? "Only when a name doesn't say" : "Decides from names, types and dates",
    },
    { key: "tags", label: "Add tags", hint: value.tags ? "A topic and a year on each file moved" : "Leaves tags as they are" },
  ];

  return (
    <div
      role="dialog"
      aria-label="Organize my drive"
      className="menu-surface absolute bottom-full left-0 right-0 z-20 mb-2 flex flex-col p-1.5"
      style={{ maxHeight }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-2.5 pb-1 pt-1.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.9375rem] font-medium text-zinc-900">
            <FolderTree className="h-4 w-4" /> Organize my drive
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
            Folders and moves for every file. Never deletes or shares anything.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="thin-scroll min-h-0 overflow-y-auto px-2.5">
        <div className="divide-y divide-zinc-200">
          <div className={`${row} flex-wrap`}>
            <span className="text-[0.875rem] text-zinc-900">Group by</span>
            <Segmented<OrganizeOptions["group_by"]>
              label="Group by"
              value={value.group_by}
              onChange={(group_by) => set({ group_by })}
              options={(Object.keys(GROUP_LABELS) as OrganizeOptions["group_by"][]).map((g) => ({
                value: g,
                label: GROUP_LABELS[g],
              }))}
            />
          </div>
          <div className={`${row} flex-wrap`}>
            <span className="text-[0.875rem] text-zinc-900">Max folder depth</span>
            <Segmented<"auto" | "1" | "2" | "3">
              label="Max folder depth"
              value={value.depth === null ? "auto" : (String(value.depth) as "1" | "2" | "3")}
              onChange={(d) => set({ depth: d === "auto" ? null : (Number(d) as 1 | 2 | 3) })}
              options={[
                { value: "auto", label: "Auto" },
                { value: "1", label: "1 level" },
                { value: "2", label: "2 levels" },
                { value: "3", label: "3 levels" },
              ]}
            />
          </div>
          {toggles.map((t) => (
            <div key={t.key} className={row}>
              <span className="min-w-0">
                <span className="block text-[0.875rem] text-zinc-900">{t.label}</span>
                <span className="block text-[0.75rem] text-zinc-500">{t.hint}</span>
              </span>
              <Toggle label={t.label} checked={value[t.key]} onChange={(on) => set({ [t.key]: on })} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-1 flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 px-2.5 pb-1 pt-2.5">
        <p className="min-w-0 text-[0.75rem] text-zinc-500">
          {applies
            ? "Your permission mode applies moves as it goes."
            : "You'll get a plan to review. Nothing moves until you apply it."}
        </p>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onStart}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-1.5 text-[0.8125rem] text-white transition-colors hover:bg-zinc-700"
        >
          {applies ? "Organize" : "Make a plan"} <span className="ml-1 text-white/50">↵</span>
        </button>
      </div>
    </div>
  );
}
