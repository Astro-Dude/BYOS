import type { OrganizeOptions } from "@byos/api-client";

/** The cautious defaults: names stay as they are, existing folders are kept,
 *  nothing is tagged. Not remembered between runs, so renaming is only ever on
 *  when it was asked for this time. */
export const DEFAULT_ORGANIZE: OrganizeOptions = {
  rename: false,
  group_by: "topic",
  depth: null,
  keep_existing: true,
  read_contents: true,
  tags: false,
};

export const GROUP_LABELS: Record<OrganizeOptions["group_by"], string> = {
  auto: "Auto",
  topic: "Topic",
  type: "Type",
  year: "Year",
};

/** What `/organize …` accepts after the command, for /help and errors. */
export const ORGANIZE_ARGS = "[rename] [tags] [by:topic|type|year] [depth:1-3|auto] [restructure] [names-only]";

/** `/organize rename by:year depth:1` → settings. Anything not understood is
 *  returned so the command can say what it didn't recognise. */
export function parseOrganizeArgs(text: string): { opts: OrganizeOptions; unknown: string[] } {
  const opts = { ...DEFAULT_ORGANIZE };
  const unknown: string[] = [];
  const words = text.toLowerCase().replace(/\bby\s+/g, "by:").split(/\s+/).filter(Boolean);
  for (const w of words) {
    const [k, v] = w.split(/[:=]/);
    if (w === "rename" || w === "renaming") opts.rename = true;
    else if (w === "no-rename" || w === "norename") opts.rename = false;
    else if (w === "tags" || w === "tag") opts.tags = true;
    else if (w === "no-tags") opts.tags = false;
    else if (w === "restructure" || w === "reshape") opts.keep_existing = false;
    else if (w === "keep") opts.keep_existing = true;
    else if (w === "names-only" || w === "no-read") opts.read_contents = false;
    else if (w === "read") opts.read_contents = true;
    else if (w === "flat") opts.depth = 1;
    else if ((k === "by" || k === "group") && v && v in GROUP_LABELS) opts.group_by = v as OrganizeOptions["group_by"];
    else if (k === "depth" && v && ["1", "2", "3"].includes(v)) opts.depth = Number(v) as 1 | 2 | 3;
    else if (k === "depth" && (v === "auto" || v === "any")) opts.depth = null;
    else unknown.push(w);
  }
  return { opts, unknown };
}

/** The run's settings in a few words, for the message shown in the chat. */
export function organizeSummary(o: OrganizeOptions): string {
  const parts = [
    o.group_by === "auto" ? "auto grouping" : `grouped by ${o.group_by}`,
    o.depth === null ? "auto depth" : `at most ${o.depth} level${o.depth > 1 ? "s" : ""} deep`,
    o.rename ? "renaming unclear names" : "no renaming",
  ];
  if (!o.keep_existing) parts.push("existing folders may change");
  if (o.tags) parts.push("with tags");
  if (!o.read_contents) parts.push("names only");
  return parts.join(", ");
}
