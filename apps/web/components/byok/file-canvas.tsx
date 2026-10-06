"use client";

import { ApiError, type FileItem } from "@byos/api-client";
import { FileX, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { type Source } from "@/components/byok/drive-message";
import { PdfView } from "@/components/byok/pdf-view";
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

/** Plain text with the quoted passages marked, scrolled to the first one.
 *  Case and spacing are ignored when matching. */
function MarkedText({ text, quotes }: { text: string; quotes: string[] }) {
  const first = useRef<HTMLElement | null>(null);
  useEffect(() => {
    first.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [text, quotes]);
  const terms = quotes.map((q) => q.trim()).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  let seen = false;
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const isFirst = !seen;
        seen = true;
        return (
          <mark key={i} ref={isFirst ? first : undefined} className="source-mark-text rounded px-0.5">
            {part}
          </mark>
        );
      })}
    </>
  );
}

/** Right-side "canvas" preview of a chat source — the chat shifts left and the
 *  file opens here (image / pdf / text / media). */
export function FileCanvas({ source, onClose }: { source: Source; onClose: () => void }) {
  const authed = useAuthed();
  const [file, setFile] = useState<FileItem | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const quotes = source.quotes ?? [];

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDeleted(false);
    setUrl(null);
    setText(null);
    setPdf(null);
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
        } else if (kind === "pdf") {
          setPdf(blob); // drawn here, so the quoted passage can be marked
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        } else {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch (err) {
        if (cancelled) return;
        // The answer still refers to it; say plainly that the file is gone.
        if (err instanceof ApiError && err.status === 404) setDeleted(true);
        else setError("Couldn't load this file.");
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
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-l border-zinc-200 bg-white md:w-1/2 md:max-w-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
        <span className="truncate text-[0.9375rem] font-medium text-zinc-800">{source.name}</span>
        <button
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
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
        ) : deleted ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              <FileX className="h-5 w-5" />
            </span>
            <p className="text-[0.9375rem] text-zinc-900">This file was deleted</p>
            <p className="max-w-xs text-[0.8125rem] text-zinc-500">
              The answer was based on {source.name}, which isn&apos;t in your drive any more.
            </p>
            {quotes.length ? (
              <div className="mt-3 w-full max-w-sm rounded-xl bg-zinc-100 p-3 text-left">
                <p className="mb-1 text-[0.75rem] text-zinc-500">What it quoted</p>
                {quotes.map((q) => (
                  <p key={q} className="text-[0.8125rem] text-zinc-800">“{q}”</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : error ? (
          <p className="text-[0.9375rem] text-red-400">{error}</p>
        ) : kind === "image" && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={source.name} className="mx-auto max-w-full rounded-lg" />
        ) : kind === "pdf" && pdf ? (
          <PdfView blob={pdf} quotes={quotes} />
        ) : kind === "audio" && url ? (
          <audio src={url} controls className="w-full" />
        ) : kind === "video" && url ? (
          <video src={url} controls className="max-h-full w-full rounded-lg" />
        ) : kind === "text" && text != null ? (
          <pre className="whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-zinc-700">
            <MarkedText text={text} quotes={quotes} />
          </pre>
        ) : (
          <p className="text-[0.9375rem] text-zinc-500">
            No inline preview for this file type.
            {url ? (
              <>
                {" "}
                <a href={url} download={source.name} className="text-zinc-600 underline">
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
