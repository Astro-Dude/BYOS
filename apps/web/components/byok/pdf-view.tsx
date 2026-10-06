"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** A PDF drawn page by page with pdf.js, with the quoted passages marked.
 *
 *  The browser's own viewer can't be told to highlight anything, so pages are
 *  rendered here and each quote is found in the page's text layer: its words'
 *  positions come back from pdf.js, and a tinted box is laid over them. Matching
 *  ignores case and spacing, since a PDF's text often breaks words oddly. The
 *  first match is scrolled into view. */

type Mark = { left: number; top: number; width: number; height: number };
type Page = { src: string; width: number; height: number; marks: Mark[] };

const MAX_PAGES = 40;

/** What to look for: each quote, and failing that its figures on their own. */
function needles(quotes: string[]): string[][] {
  return quotes.map((q) => {
    const figures = q.match(/\d[\d,./-]*\d/g) ?? [];
    return [q, ...figures.filter((f) => f.replace(/\D/g, "").length >= 3 && f !== q)];
  });
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

export function PdfView({ blob, quotes }: { blob: Blob; quotes: string[] }) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const firstMark = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setError(false);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        const width = Math.max(320, (wrapRef.current?.clientWidth ?? 640) - 2);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const wanted = needles(quotes);
        const out: Page[] = [];
        for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n += 1) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: width / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.scale(ratio, ratio);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;

          // The page's text, flattened, with each character traced back to its
          // text item so a match can be turned into boxes on the page.
          const content = await page.getTextContent();
          const items = content.items.filter((it): it is (typeof it & { str: string; transform: number[]; width: number; height: number }) => "str" in it);
          let flat = "";
          const owner: { item: number; offset: number }[] = [];
          items.forEach((it, i) => {
            for (let c = 0; c < it.str.length; c += 1) {
              const ch = /\s/.test(it.str[c]!) ? " " : it.str[c]!.toLowerCase();
              if (ch === " " && flat.endsWith(" ")) continue;
              flat += ch;
              owner.push({ item: i, offset: c });
            }
            if (!flat.endsWith(" ")) {
              flat += " ";
              owner.push({ item: -1, offset: 0 });
            }
          });

          const marks: Mark[] = [];
          wanted.forEach((options) => {
            for (const needle of options) {
              const target = norm(needle).trim();
              if (!target) continue;
              let at = flat.indexOf(target);
              let hit = false;
              while (at !== -1) {
                hit = true;
                // Characters covered, per item: [first, last] offsets.
                const span = new Map<number, [number, number]>();
                for (let k = at; k < at + target.length; k += 1) {
                  const o = owner[k];
                  if (!o || o.item < 0) continue;
                  const prev = span.get(o.item);
                  span.set(o.item, prev ? [prev[0], o.offset] : [o.offset, o.offset]);
                }
                span.forEach(([from, to], i) => {
                  const it = items[i]!;
                  const tx = pdfjs.Util.transform(viewport.transform, it.transform);
                  const fontHeight = Math.hypot(tx[2]!, tx[3]!);
                  const full = it.width * viewport.scale;
                  const per = it.str.length ? full / it.str.length : full;
                  marks.push({
                    left: tx[4]! + per * from - 2,
                    top: tx[5]! - fontHeight - 2,
                    width: per * (to - from + 1) + 4,
                    height: fontHeight + 4,
                  });
                });
                at = flat.indexOf(target, at + target.length);
              }
              if (hit) break; // the whole quote matched; no need for its figures
            }
          });

          out.push({ src: canvas.toDataURL("image/png"), width: viewport.width, height: viewport.height, marks });
          if (cancelled) return;
          setPages([...out]); // show pages as they're ready
        }
        if (!cancelled && out.length === 0) setError(true);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, quotes]);

  // Bring the first highlight into view once it exists.
  useEffect(() => {
    firstMark.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pages]);

  if (error) return <p className="text-[0.9375rem] text-zinc-500">Couldn&apos;t show this PDF.</p>;

  let first = true;
  return (
    <div ref={wrapRef} className="space-y-3">
      {pages === null ? (
        <div className="flex h-40 items-center justify-center text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        pages.map((p, i) => (
          <div
            key={i}
            className="relative mx-auto overflow-hidden rounded-lg border border-zinc-200 bg-white"
            style={{ width: p.width, maxWidth: "100%", aspectRatio: `${p.width} / ${p.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={`Page ${i + 1}`} className="block h-full w-full" />
            {p.marks.map((m, j) => {
              const isFirst = first;
              first = false;
              return (
                <div
                  key={j}
                  ref={isFirst ? firstMark : undefined}
                  aria-hidden
                  className="source-mark pointer-events-none absolute rounded-[3px]"
                  style={{
                    left: `${(m.left / p.width) * 100}%`,
                    top: `${(m.top / p.height) * 100}%`,
                    width: `${(m.width / p.width) * 100}%`,
                    height: `${(m.height / p.height) * 100}%`,
                  }}
                />
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
