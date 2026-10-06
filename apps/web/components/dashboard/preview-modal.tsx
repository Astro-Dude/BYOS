"use client";

import { ApiError, type FileItem } from "@byos/api-client";
import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AiPanel } from "@/components/dashboard/ai-panel";
import { StorageIcon, providerName } from "@/components/storage-icon";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { docPreviewUrl } from "@/lib/utils";

type Kind = "image" | "pdf" | "audio" | "video" | "text" | "unsupported";

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "go", "rs",
  "java", "kt", "c", "cpp", "cc", "h", "hpp", "cs", "rb", "php", "swift", "css", "scss", "sass",
  "html", "htm", "xml", "svg", "yaml", "yml", "toml", "ini", "cfg", "sh", "bash", "zsh", "sql",
  "log", "csv", "tsv", "env", "gitignore", "dockerfile", "makefile",
]);

function kindOf(file: FileItem): Kind {
  const mime = (file.mime ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime.includes("javascript")
  ) {
    return "text";
  }
  if (TEXT_EXT.has((file.ext ?? "").toLowerCase())) return "text";
  return "unsupported";
}

export function PreviewModal({
  file,
  storedOn,
  onClose,
}: {
  file: FileItem;
  /** Where the file lives, e.g. "GitHub · ada/byos-storage". */
  storedOn?: string;
  onClose: () => void;
}) {
  const authed = useAuthed();
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const kind = kindOf(file);
  // AI works on text-readable docs (PDF + text formats) and on images, which the
  // API transcribes with the user's own vision model.
  const aiEligible = kind === "pdf" || kind === "text" || kind === "image";

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = await authed((t) => api.downloadBlob(t, file.id));
        if (cancelled) return;
        if (kind === "text") {
          setText(await blob.text());
        } else if (kind !== "unsupported") {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : "Failed to load preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authed, file.id, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-scrim z-50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl glass-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-medium text-zinc-900">{file.name}</p>
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-zinc-500">
              <StorageIcon provider={file.provider} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Stored on {storedOn ?? providerName(file.provider)}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {aiEligible ? (
              <button
                onClick={() => setAiOpen((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.9375rem] font-medium transition ${
 aiOpen
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                <Sparkles className="h-4 w-4" /> Ask AI
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-700"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          {loading ? (
            <p className="text-[0.9375rem] text-zinc-500">Loading preview…</p>
          ) : error ? (
            <p className="text-[0.9375rem] text-red-600">{error}</p>
          ) : kind === "image" && url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
          ) : kind === "pdf" && url ? (
            <iframe
              src={docPreviewUrl(url, true)}
              title={file.name}
              className="h-[60vh] w-full sm:h-[82vh]"
            />
          ) : kind === "video" && url ? (
            <video src={url} controls className="max-h-full max-w-full" />
          ) : kind === "audio" && url ? (
            <audio src={url} controls className="w-full" />
          ) : kind === "text" && text !== null ? (
            <pre className="w-full whitespace-pre-wrap break-words text-left text-[0.8125rem] text-zinc-800">
              {text}
            </pre>
          ) : (
            <p className="text-[0.9375rem] text-zinc-500">Can&apos;t preview this file type. Download it to open.</p>
          )}
          </div>
          {aiOpen && aiEligible ? <AiPanel file={file} /> : null}
        </div>
      </div>
    </div>
  );
}
