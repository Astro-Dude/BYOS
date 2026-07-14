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
