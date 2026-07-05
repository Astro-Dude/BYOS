"use client";

import { ApiError, type FileItem, type FolderItem } from "@byos/api-client";
import { ChevronRight, Folder } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

/** Navigate the folder tree and move `file` into the chosen folder (or root). */
export function MoveModal({
  file,
  onClose,
  onMoved,
}: {
  file: FileItem;
  onClose: () => void;
  onMoved: () => void;
}) {
  const authed = useAuthed();
  const toast = useToast();
  const [parent, setParent] = useState<string | null>(null); // folder being browsed (null = root)
  const [crumbs, setCrumbs] = useState<{ id: string; name: string }[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFolders(await authed((t) => api.listFolders(t, parent ?? undefined)));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load folders");
    }
  }, [authed, parent]);

  useEffect(() => {
    void load();
  }, [load]);

  const enter = (f: FolderItem) => {
    setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
    setParent(f.id);
  };

  const jumpTo = (index: number) => {
    // index -1 = root
    if (index < 0) {
      setCrumbs([]);
      setParent(null);
    } else {
      setCrumbs((c) => c.slice(0, index + 1));
      setParent(crumbs[index]?.id ?? null);
    }
  };

  const move = async () => {
    setBusy(true);
    try {
      await authed((t) => api.moveFile(t, file.id, parent));
      toast(`Moved to ${destName}`);
      onMoved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Move failed");
      setBusy(false);
    }
  };

  const destName = crumbs.length ? crumbs[crumbs.length - 1]?.name : "My Drive";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-zinc-900">Move file</h3>
        <p className="mt-1 truncate text-sm text-zinc-500">{file.name}</p>

        {/* breadcrumb */}
        <div className="mt-4 flex flex-wrap items-center gap-1 text-sm">
          <button onClick={() => jumpTo(-1)} className="text-indigo-600 hover:underline">
            My Drive
          </button>
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              <button
                onClick={() => jumpTo(i)}
                className={i === crumbs.length - 1 ? "text-zinc-700" : "text-indigo-600 hover:underline"}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        <div className="mt-3 max-h-60 overflow-auto rounded-lg border border-zinc-200">
          {folders.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-400">No subfolders here.</p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={() => enter(f)}
                className="flex w-full items-center justify-between gap-2 border-b border-zinc-50 px-3 py-2 text-left text-sm hover:bg-zinc-50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Folder className="h-4 w-4 shrink-0" style={{ color: f.color ?? "#8FB6AD" }} />
                  <span className="truncate text-zinc-800">{f.name}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
              </button>
            ))
          )}
        </div>

        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="truncate text-xs text-zinc-500">
            Destination: <span className="font-medium text-zinc-700">{destName}</span>
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
              Cancel
            </Button>
            <Button onClick={move} disabled={busy || file.folder_id === parent}>
              Move here
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
