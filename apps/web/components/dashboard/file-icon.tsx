import {
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
} from "lucide-react";

/** Icon for a file based on its MIME type / extension. */
export function fileIcon(
  mime: string | null,
  ext: string | null,
  className = "h-5 w-5 text-zinc-500",
) {
  const m = mime ?? "";
  if (m.startsWith("image/")) return <ImageIcon className={className} />;
  if (m.startsWith("video/")) return <Video className={className} />;
  if (m.startsWith("audio/")) return <Music className={className} />;
  if (m === "application/pdf" || ext === "pdf") return <FileText className={className} />;
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext ?? ""))
    return <FileArchive className={className} />;
  return <FileIcon className={className} />;
}
