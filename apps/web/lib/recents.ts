// Tracks the files and folders you've recently opened, on this device, so the
// search palette can surface them before you type. Stored in localStorage.
import type { FileItem, FolderItem } from "@byos/api-client";

const KEY = "byos:recents";
const CAP = 8; // keep a few more than we show, for churn

type Recents = { files: FileItem[]; folders: FolderItem[] };

function read(): Recents {
  if (typeof window === "undefined") return { files: [], folders: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "") as Recents;
    return { files: parsed.files ?? [], folders: parsed.folders ?? [] };
  } catch {
    return { files: [], folders: [] };
  }
}

function write(r: Recents): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // storage full / disabled — recents are best-effort
  }
}

export function getRecents(): Recents {
  return read();
}

export function addRecentFile(file: FileItem): void {
  const r = read();
  r.files = [file, ...r.files.filter((f) => f.id !== file.id)].slice(0, CAP);
  write(r);
}

export function addRecentFolder(folder: FolderItem): void {
  const r = read();
  r.folders = [folder, ...r.folders.filter((f) => f.id !== folder.id)].slice(0, CAP);
  write(r);
}

export function removeRecentFile(id: string): void {
  const r = read();
  r.files = r.files.filter((f) => f.id !== id);
  write(r);
}

export function removeRecentFolder(id: string): void {
  const r = read();
  r.folders = r.folders.filter((f) => f.id !== id);
  write(r);
}
