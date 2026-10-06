"use client";

import type { FileItem } from "@byos/api-client";

import { ShareModal } from "@/components/dashboard/share-modal";

/** Share a file: its permanent link, plus expiring links. */
export function AliasModal({
  file,
  onClose,
  onCreated,
}: {
  file: FileItem;
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <ShareModal
      target={{ kind: "file", id: file.id, name: file.name, mime: file.mime, ext: file.ext }}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
