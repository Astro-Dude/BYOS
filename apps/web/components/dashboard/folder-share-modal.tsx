"use client";

import { ShareModal } from "@/components/dashboard/share-modal";

/** Share a folder: a permanent link to a page anyone can browse. */
export function FolderShareModal({
  folder,
  onClose,
  onCreated,
}: {
  folder: { id: string; name: string };
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <ShareModal target={{ kind: "folder", id: folder.id, name: folder.name }} onClose={onClose} onCreated={onCreated} />
  );
}
