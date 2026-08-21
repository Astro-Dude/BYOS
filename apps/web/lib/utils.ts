import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shorten a long name with a middle ellipsis, preserving the start and the
 *  file extension (e.g. "EAadhaar_0815…3115.pdf"). Used in confirm dialogs so
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
