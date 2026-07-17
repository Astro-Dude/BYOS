"use client";

import { type FileItem } from "@byos/api-client";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { type Source } from "@/components/byok/drive-message";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

type Kind = "image" | "pdf" | "audio" | "video" | "text" | "unsupported";

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "go", "rs",
  "java", "kt", "c", "cpp", "cc", "h", "hpp", "cs", "rb", "php", "swift", "css", "scss", "sass",
  "html", "htm", "xml", "svg", "yaml", "yml", "toml", "ini", "cfg", "sh", "bash", "zsh", "sql",
  "log", "csv", "tsv", "env",
]);

function kindOf(file: FileItem): Kind {
  const mime = (file.mime ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime === "application/json" || mime.includes("xml")) {
    return "text";
  }
  return TEXT_EXT.has((file.ext ?? "").toLowerCase()) ? "text" : "unsupported";
}

/** Right-side "canvas" preview of a chat source — the chat shifts left and the
 *  file opens here (image / pdf / text / media). */
export function FileCanvas({ source, onClose }: { source: Source; onClose: () => void }) {
  const authed = useAuthed();
  const [file, setFile] = useState<FileItem | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    setText(null);
    (async () => {
      try {
        const meta = await authed((t) => api.getFile(t, source.id));
        if (cancelled) return;
        setFile(meta);
        const kind = kindOf(meta);
        if (kind === "unsupported") return;
        const blob = await authed((t) => api.downloadBlob(t, meta.id));
        if (cancelled) return;
        if (kind === "text") {
          setText(await blob.text());
        } else {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch {
        if (!cancelled) setError("Couldn't load this file.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authed, source.id]);

  const kind = file ? kindOf(file) : "unsupported";

  return (
    <aside className="flex min-h-0 w-1/2 max-w-2xl shrink-0 flex-col border-l border-zinc-200 bg-white/60 dark:border-white/10 dark:bg-zinc-950/60">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
        <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{source.name}</span>
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-black/10 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200"
          aria-label="Close preview"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : kind === "image" && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={source.name} className="mx-auto max-w-full rounded-lg" />
        ) : kind === "pdf" && url ? (
          <iframe src={url} title={source.name} className="h-full w-full rounded-lg bg-white" />
        ) : kind === "audio" && url ? (
          <audio src={url} controls className="w-full" />
        ) : kind === "video" && url ? (
          <video src={url} controls className="max-h-full w-full rounded-lg" />
        ) : kind === "text" && text != null ? (
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            {text}
          </pre>
        ) : (
          <p className="text-sm text-zinc-500">
            No inline preview for this file type.
            {url ? (
              <>
                {" "}
                <a href={url} download={source.name} className="text-indigo-400 underline">
                  Download
                </a>
              </>
            ) : null}
          </p>
        )}
      </div>
    </aside>
  );
}
