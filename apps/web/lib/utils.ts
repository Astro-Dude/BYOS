import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shorten a long name with a middle ellipsis, preserving the start and the
 *  file extension (e.g. "Statement_2026…0331.pdf"). Used in confirm dialogs so
 *  huge filenames can't overflow the layout. */
export function truncateMiddle(name: string, max = 42): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, -ext.length) : name;
  const keep = max - ext.length - 1; // room for the ellipsis
  const head = Math.ceil(keep * 0.6);
  const tail = Math.max(0, keep - head);
  return `${stem.slice(0, head)}…${tail ? stem.slice(-tail) : ""}${ext}`;
}

/** Source URL for an embedded document preview.
 *
 *  Chrome and Edge wrap a PDF in their own grey toolbar (page controls, zoom,
 *  download, print), which reads as browser chrome sitting inside our own modal.
 *  These PDF Open Parameters hide it; `FitH` then fits the page to the container,
 *  since without the toolbar there's no zoom control left. Viewers that don't
 *  understand the fragment ignore it, and non-PDFs are returned untouched.
 */
export function docPreviewUrl(url: string, isPdf: boolean): string {
  return isPdf ? `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH` : url;
}

/** Human-readable byte count. Binary units (1024), one decimal above bytes.
 *
 *  Was duplicated privately in the sidebar and the duplicates panel — identical
 *  apart from a variable name — and the admin dashboard would have made three.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}
