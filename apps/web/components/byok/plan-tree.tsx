"use client";

import type { PlanPreview, PreviewFile, PreviewFolder } from "@byos/api-client";
import { ArrowRight, FileText, Folder, FolderPlus, HardDrive, Star, StarOff } from "lucide-react";
import { useState } from "react";

/** A plan drawn as the drive will look once it's applied: new folders, where
 *  each moved file lands and where it came from, renames (old → new), tags
 *  added or removed, stars. Only the part the plan touches is drawn, so a big
 *  drive still reads at a glance. */
export function PlanTree({ preview }: { preview: PlanPreview }) {
  return (
    <div className="plan-tree px-3 py-2.5">
      <Row depth={0} icon={<HardDrive className="h-3.5 w-3.5" />} name={preview.root.name} strong />
      <Branch folder={preview.root} depth={1} />
      <Untouched names={preview.untouched ?? []} more={preview.untouched_more ?? 0} />
    </div>
  );
}

/** One line per plan, for the card's header: "2 new folders · 14 files move". */
export function previewSummary(p: PlanPreview): string {
  const parts = [
    p.new_folders ? `${p.new_folders} new folder${p.new_folders === 1 ? "" : "s"}` : null,
    p.moved ? `${p.moved} file${p.moved === 1 ? "" : "s"} move` : null,
    p.renamed ? `${p.renamed} renamed` : null,
    p.tagged ? `${p.tagged} tagged` : null,
    p.starred ? `${p.starred} starred` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No folders change";
}

const FILES_FIRST = 4; // per folder before "show N more"

function Branch({ folder, depth }: { folder: PreviewFolder; depth: number }) {
  const [allFiles, setAllFiles] = useState(false);
  const files = allFiles ? folder.files : folder.files.slice(0, FILES_FIRST);
  const hidden = folder.files.length - files.length + folder.more;
  if (!folder.children.length && !folder.files.length) return null;
  return (
    <ul className="plan-branch">
      {folder.children.map((child, i) => (
        <li key={`${child.name}-${i}`}>
          <FolderRow folder={child} depth={depth} />
          <Branch folder={child} depth={depth + 1} />
        </li>
      ))}
      {files.map((file, i) => (
        <li key={`${file.name}-${i}`}>
          <FileRow file={file} depth={depth} />
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          {allFiles || folder.files.length <= FILES_FIRST ? (
            <span className="plan-row text-[0.75rem] text-zinc-500">
              +{hidden} more file{hidden === 1 ? "" : "s"}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setAllFiles(true)}
              className="plan-row text-[0.75rem] text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
            >
              +{hidden} more file{hidden === 1 ? "" : "s"}
            </button>
          )}
        </li>
      ) : null}
    </ul>
  );
}

function FolderRow({ folder, depth }: { folder: PreviewFolder; depth: number }) {
  const count = folder.files.length + folder.more;
  return (
    <Row
      depth={depth}
      icon={folder.new ? <FolderPlus className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
      name={folder.name}
      was={folder.was}
      strong
      tone={folder.new ? "new" : undefined}
    >
      {folder.new ? <span className="plan-badge plan-badge-new">New</span> : null}
      {folder.was ? <span className="plan-badge plan-badge-renamed">Renamed</span> : null}
      {folder.moved ? <span className="text-[0.75rem] text-zinc-500">moved here</span> : null}
      {count ? (
        <span className="text-[0.75rem] text-zinc-400">
          {count} file{count === 1 ? "" : "s"}
        </span>
      ) : null}
    </Row>
  );
}

function FileRow({ file, depth }: { file: PreviewFile; depth: number }) {
  return (
    <Row depth={depth} icon={<FileText className="h-3.5 w-3.5" />} name={file.name} was={file.was}>
      {file.star === true ? (
        <Star
          className="h-3.5 w-3.5 shrink-0 fill-[rgb(246_196_92)] text-[rgb(214_158_36)]"
          aria-label="Starred"
        />
      ) : file.star === false ? (
        <StarOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-label="Unstarred" />
      ) : null}
      {file.tags_added.map((t) => (
        <span key={`+${t}`} className="plan-tag">
          #{t}
        </span>
      ))}
      {file.tags_removed.map((t) => (
        <span key={`-${t}`} className="plan-tag plan-tag-removed" title={`Removes the tag ${t}`}>
          #{t}
        </span>
      ))}
      {file.from ? (
        <span className="truncate text-[0.75rem] text-zinc-400">
          from {file.from === "/" ? "My drive" : file.from}
        </span>
      ) : null}
    </Row>
  );
}

function Row({
  depth,
  icon,
  name,
  was,
  strong,
  tone,
  children,
}: {
  depth: number;
  icon: React.ReactNode;
  name: string;
  /** The old name, for a rename: drawn struck through, then → the new one. */
  was?: string | null;
  strong?: boolean;
  tone?: "new";
  children?: React.ReactNode;
}) {
  return (
    <span className="plan-row plan-node-in" style={{ animationDelay: `${Math.min(depth, 6) * 70}ms` }}>
      <span className={`shrink-0 ${tone === "new" ? "text-[rgb(var(--c-go-500))]" : "text-zinc-500"}`}>
        {icon}
      </span>
      {was ? (
        <>
          <s className="min-w-0 max-w-[40%] shrink truncate text-zinc-400" title={was}>
            {was}
          </s>
          <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400" aria-label="renamed to" />
        </>
      ) : null}
      <span
        className={`min-w-0 truncate ${strong ? "font-medium text-zinc-900" : "text-zinc-700"}`}
        title={name}
      >
        {name}
      </span>
      {children}
    </span>
  );
}

/** Loose files the plan leaves at the top of the drive: usually ones it
 *  missed, so they're spelled out where a revision can pick them up. */
function Untouched({ names, more }: { names: string[]; more: number }) {
  const [open, setOpen] = useState(false);
  const total = names.length + more;
  if (!total) return null;
  return (
    <div className="mt-2 rounded-lg border border-dashed border-zinc-300 px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[0.75rem] text-zinc-600"
        aria-expanded={open}
      >
        <span className="font-medium text-zinc-800">Left where they are</span>
        <span className="text-zinc-500">
          {total} loose file{total === 1 ? "" : "s"} at the top of your drive
        </span>
        <span className="ml-auto text-zinc-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5">
          {names.map((n) => (
            <li key={n} className="flex items-center gap-1.5 truncate text-[0.8125rem] text-zinc-600">
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="truncate">{n}</span>
            </li>
          ))}
          {more ? <li className="text-[0.75rem] text-zinc-500">+{more} more</li> : null}
          <li className="pt-1 text-[0.75rem] text-zinc-500">
            Missing something? Say where it goes in the box below.
          </li>
        </ul>
      ) : null}
    </div>
  );
}
