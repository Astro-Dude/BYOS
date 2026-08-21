"use client";

import { ApiError } from "@byos/api-client";
import { Database, Loader2, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

export type IndexArgs = {
  keyId: string;
  all: boolean;
  fileIds?: string[];
  folderIds?: string[];
  /** Only files not already embedded for this key's model. */
  remaining?: boolean;
  /** Re-embed even files already current (a rebuild, not a catch-up). */
  force?: boolean;
};

type State = {
  running: boolean;
  done: number;
  total: number;
  /** Name of the file the server most recently finished. */
  current: string;
  /** Files the server couldn't embed and skipped over, with the reason. */
  skipped: string[];
  error: string | null;
  /** Bumped when a run ends, so panels know to refetch index status. */
  finishedAt: number;
};

const IDLE: State = {
  running: false,
  done: 0,
  total: 0,
  current: "",
  skipped: [],
  error: null,
  finishedAt: 0,
};

type Api = State & {
  start: (args: IndexArgs) => void;
  cancel: () => void;
};

const IndexingContext = createContext<Api>({ ...IDLE, start: () => {}, cancel: () => {} });

/** Owns the drive-indexing run, deliberately above the UI that starts it.
 *
 *  Indexing is long (a request per file, plus vision transcription for scans),
 *  and it used to live inside the settings modal — so closing the modal tore the
 *  stream down mid-run. Holding it here means the run outlives the modal and any
 *  route change, and the floating card is the only progress UI that has to exist.
 *
 *  A hard reload or closing the tab still ends the run: the work happens inside
 *  the HTTP request, so there's nothing left to stream into. Surviving that needs
 *  the job queued server-side (arq), which is a separate change.
 */
export function IndexingProvider({ children }: { children: ReactNode }) {
  const authed = useAuthed();
  const [state, setState] = useState<State>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  // Guards against a second run being kicked off from another mounted panel.
  const runningRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    setState((s) => ({ ...s, running: false, finishedAt: Date.now() }));
  }, []);

  const start = useCallback(
    (args: IndexArgs) => {
      if (runningRef.current) return;
      runningRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...IDLE, running: true });

      void (async () => {
        try {
          await authed((t) =>
            api.indexDrive(
              t,
              {
                keyId: args.keyId,
                all: args.all,
                fileIds: args.all ? [] : (args.fileIds ?? []),
                folderIds: args.all ? [] : (args.folderIds ?? []),
                remaining: args.remaining ?? false,
                force: args.force ?? false,
              },
              (chunk) => {
                // Progress arrives as "done/total name" lines; a chunk may hold
                // several, or split one — only act on whole lines.
                for (const raw of chunk.split("\n")) {
                  const line = raw.trim();
                  if (!line) continue;
                  if (line.startsWith("error:")) {
                    // Fatal — the server has stopped the whole run.
                    setState((s) => ({ ...s, error: line.slice(6).trim() }));
                    continue;
                  }
                  if (line.startsWith("warn:")) {
                    // One file skipped; the run carries on.
                    const detail = line.slice(5).trim();
                    setState((s) => ({ ...s, skipped: [...s.skipped, detail] }));
                    continue;
                  }
                  if (line.startsWith("done:")) continue; // summary, we count ourselves
                  const m = /^(\d+)\/(\d+)(?:\s+(.*))?$/.exec(line);
                  if (m) {
                    setState((s) => ({
                      ...s,
                      done: Number(m[1]),
                      total: Number(m[2]),
                      current: m[3] ?? s.current,
                    }));
                  }
                }
              },
              controller.signal,
            ),
          );
          setState((s) => ({ ...s, running: false, finishedAt: Date.now() }));
        } catch (err) {
          if (controller.signal.aborted) return; // cancel() already settled state
          setState((s) => ({
            ...s,
            running: false,
            error: err instanceof ApiError ? err.detail : "Indexing failed",
            finishedAt: Date.now(),
          }));
        } finally {
          runningRef.current = false;
          if (abortRef.current === controller) abortRef.current = null;
        }
      })();
    },
    [authed],
  );

  return (
    <IndexingContext.Provider value={{ ...state, start, cancel }}>
      {children}
      <IndexingCard {...state} onCancel={cancel} />
    </IndexingContext.Provider>
  );
}

/** Floating progress card. Sits bottom-right so a run stays visible with the
 *  settings modal closed, stacked above the support button which owns the very
 *  corner; auto-dismisses a few seconds after finishing. */
function IndexingCard({
  running,
  done,
  total,
  current,
  skipped,
  error,
  finishedAt,
  onCancel,
}: State & { onCancel: () => void }) {
  const [showSkipped, setShowSkipped] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (running) {
      setDismissed(false);
      return;
    }
    if (!finishedAt) return;
    const timer = setTimeout(() => setDismissed(true), error ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [running, finishedAt, error]);

  if (dismissed || (!running && !finishedAt)) return null;

  const pct = total ? Math.round((done / total) * 100) : 0;
  const complete = !running && !error;

  return (
    <div className="surface-artifact fixed bottom-[4.75rem] right-5 z-[190] w-72 p-4">
      <div className="flex items-center gap-2">
        {running ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-900" />
        ) : (
          <Database className={`h-4 w-4 shrink-0 ${error ? "text-red-500" : "text-zinc-900"}`} />
        )}
        <span className="flex-1 truncate text-[0.9375rem] text-zinc-900">
          {error
            ? "Indexing stopped"
            : complete
              ? `Indexed ${done - skipped.length} of ${done} file${done === 1 ? "" : "s"}`
              : `Indexing ${done} of ${total}`}
        </span>
        {running ? (
          <button
            onClick={onCancel}
            aria-label="Stop indexing"
            className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-red-500"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {running || !error ? (
        <div
          className={`relative mt-3 h-px overflow-hidden bg-zinc-200 ${
 running && !total ? "steep-sweep" : ""
          }`}
        >
          <div
            className="h-full bg-zinc-900 transition-all duration-500"
            style={{ width: `${complete ? 100 : pct}%` }}
          />
        </div>
      ) : null}

      <p className="mt-2 truncate text-[0.8125rem] text-zinc-600">
        {error ?? (running ? current || "Starting…" : "Ready for drive-wide chat.")}
      </p>

      {/* Skips are the interesting failure: the run "succeeded" but some files
          aren't searchable, so say which and why rather than hiding it. */}
      {skipped.length ? (
        <div className="mt-1.5 border-t border-zinc-200 pt-1.5">
          <button
            onClick={() => setShowSkipped((v) => !v)}
            className="text-[0.7rem] text-amber-600 hover:underline"
          >
            {skipped.length} skipped {showSkipped ? "▾" : "▸"}
          </button>
          {showSkipped ? (
            <ul className="thin-scroll mt-1 max-h-24 space-y-0.5 overflow-y-auto">
              {skipped.map((sk, i) => (
                <li key={i} className="text-[0.65rem] leading-snug text-zinc-500">
                  {sk}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const useIndexing = () => useContext(IndexingContext);
