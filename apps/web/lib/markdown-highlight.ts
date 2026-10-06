/**
 * Line-by-line Markdown colouring for the prompt editor.
 *
 * Returns plain text segments with a class each, never HTML, so a prompt can't
 * inject markup. Every character of the source comes back exactly once, in
 * order: the coloured layer sits under a transparent textarea and has to line
 * up with it glyph for glyph. So it only ever changes colour, never weight,
 * style or size, which would change widths.
 */

export type Segment = { text: string; cls?: string };
export type Line = { segments: Segment[]; cls?: string };

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})(\s.*)?$/;
const QUOTE = /^(\s*>+)(.*)$/;
const LIST = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;

// Inline: code spans first (nothing inside them is formatting), then links,
// {{variables}}, bold and italic.
const INLINE =
  /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]*\))|(\{\{[^}\n]+\}\})|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;

function inline(text: string, base?: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), cls: base });
    const cls = m[1] ? "md-code" : m[2] ? "md-link" : m[3] ? "md-var" : m[4] ? "md-bold" : "md-italic";
    out.push({ text: m[0], cls });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), cls: base });
  return out;
}

export function highlight(source: string): Line[] {
  const lines: Line[] = [];
  let inFence = false;
  for (const raw of source.split("\n")) {
    if (FENCE.test(raw)) {
      lines.push({ segments: [{ text: raw, cls: "md-fence" }] });
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push({ segments: [{ text: raw, cls: "md-codeblock" }] });
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading) {
      lines.push({
        cls: `md-h md-h${heading[1]!.length}`,
        segments: [{ text: heading[1]!, cls: "md-mark" }, ...inline(heading[2] ?? "", "md-heading")],
      });
      continue;
    }
    if (HR.test(raw)) {
      lines.push({ segments: [{ text: raw, cls: "md-hr" }] });
      continue;
    }
    const quote = QUOTE.exec(raw);
    if (quote) {
      lines.push({ segments: [{ text: quote[1]!, cls: "md-mark" }, ...inline(quote[2]!, "md-quote")] });
      continue;
    }
    const list = LIST.exec(raw);
    if (list) {
      const [, indent, marker, gap, box, rest] = list;
      lines.push({
        segments: [
          { text: indent! },
          { text: marker!, cls: "md-mark" },
          { text: gap! },
          ...(box ? [{ text: box, cls: "md-check" }] : []),
          ...inline(rest!),
        ],
      });
      continue;
    }
    lines.push({ segments: inline(raw) });
  }
  return lines;
}
