"use client";

import { type AiPrompt, ApiError } from "@byos/api-client";
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  FileDown,
  FileText,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Settings2,
  SquareCode,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { MD_PLUGINS } from "@/components/dashboard/chat-format";
import { Segmented, Toggle } from "@/components/settings/controls";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";
import { highlight } from "@/lib/markdown-highlight";
import {
  type EditorFont,
  type EditorFontSize,
  type EditorTheme,
  type EditorView,
  usePreferences,
} from "@/lib/preferences";

/** The API's limit on a prompt's text (ai/schemas.py). */
const MAX_CHARS = 8000;

/** Ready-made sections a system prompt usually has. */
const SNIPPETS: { label: string; text: string }[] = [
  { label: "Role", text: "## Role\n\nYou are a {{role}} who helps with {{task}}.\n" },
  {
    label: "Rules",
    text: "## Rules\n\n- Be concise.\n- If you're not sure, say so.\n- Never make up facts.\n",
  },
  { label: "Tone", text: "## Tone\n\nFriendly and plain. Short sentences. No jargon.\n" },
  {
    label: "Output format",
    text: "## Output format\n\n1. A one-line answer.\n2. The details, as a short list.\n3. Sources, if any.\n",
  },
  { label: "Example", text: "## Example\n\n**User:** ...\n\n**You:** ...\n" },
  { label: "Context", text: "## Context\n\n- The user is {{who}}.\n- They care about {{what}}.\n" },
];

const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

/** "untitled", or "untitled-2", "untitled-3"... whichever isn't taken yet. */
function untitledName(taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has("untitled")) return "untitled";
  let i = 2;
  while (used.has(`untitled-${i}`)) i += 1;
  return `untitled-${i}`;
}

/** A filename-safe version of the prompt's name, for the tab and downloads. */
function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Keep the textarea's selection: a click here shouldn't steal focus first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="md-tool flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
    >
      {children}
    </button>
  );
}

const THEMES: { value: EditorTheme; label: string }[] = [
  { value: "graphite", label: "Graphite" },
  { value: "plum", label: "Plum" },
  { value: "fjord", label: "Fjord" },
  { value: "linen", label: "Linen" },
];

/** Each theme drawn as a few lines of markdown in its own colours. */
function ThemePicker({ value, onChange }: { value: EditorTheme; onChange: (next: EditorTheme) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
      {THEMES.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(t.value)}
            data-ed-theme={t.value}
            className="relative overflow-hidden rounded-lg text-left transition-shadow"
            style={{
              background: "var(--ed-bg)",
              boxShadow: on
                ? "0 0 0 2px var(--ed-accent), 0 0 0 4px var(--ed-bg)"
                : "inset 0 0 0 1px var(--ed-hairline)",
            }}
          >
            <span className="block space-y-1 px-2.5 pb-1.5 pt-2.5 font-mono text-[0.6875rem] leading-tight">
              <span className="block">
                <span style={{ color: "var(--ed-mark)" }}># </span>
                <span style={{ color: "var(--ed-heading)" }}>Role</span>
              </span>
              <span className="block truncate" style={{ color: "var(--ed-text)" }}>
                Be <span style={{ color: "var(--ed-strong)" }}>clear</span>,{" "}
                <span style={{ color: "var(--ed-em)" }}>kind</span>
              </span>
              <span className="block truncate">
                <span style={{ color: "var(--ed-mark)" }}>- </span>
                <span style={{ color: "var(--ed-code)" }}>`json`</span>
              </span>
            </span>
            <span
              className="flex items-center justify-between px-2.5 py-1.5 text-[0.75rem]"
              style={{ background: "var(--ed-panel)", color: on ? "var(--ed-text)" : "var(--ed-muted)" }}
            >
              {t.label}
              {on ? (
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ background: "var(--ed-accent)", color: "var(--ed-on-accent)" }}
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A full Markdown editor for system prompts: coloured source with line
 * numbers, a live preview, a formatting toolbar, prompt section inserts, the
 * usual shortcuts, and .md import and export. Dark by default; theme, font,
 * size, wrapping, line numbers and layout are preferences.
 */
export function PromptEditor({
  existing,
  takenNames = [],
  onClose,
  onSaved,
}: {
  existing: AiPrompt | null;
  /** The other prompts' names, so an unnamed one gets a free "untitled-N". */
  takenNames?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const authed = useAuthed();
  const { prefs, setPrefs } = usePreferences();
  const [name, setName] = useState(existing?.name ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [menu, setMenu] = useState<"settings" | "snippets" | null>(null);
  // The toolbar scrolls sideways, which would clip a menu inside it, so menus
  // open in a layer below it, lined up with their button.
  const [snippetLeft, setSnippetLeft] = useState(12);
  const rootRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState({ line: 1, col: 1 });

  const taRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = name !== (existing?.name ?? "") || content !== (existing?.content ?? "");
  const lines = useMemo(() => highlight(content), [content]);
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const over = content.length > MAX_CHARS;
  const view: EditorView = prefs.editorView;
  // Phones have room for one pane at a time, so they get their own Write /
  // Preview switch; the saved view (with Split) applies from tablet width up.
  const [phoneTab, setPhoneTab] = useState<"write" | "preview">("write");

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  // ── Editing helpers. They go through execCommand("insertText") so the
  // browser's own undo and redo keep working; setRangeText is the fallback. ──
  const replace = (start: number, end: number, text: string, selStart?: number, selEnd?: number) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, text)) {
      ta.setRangeText(text, start, end, "end");
      setContent(ta.value);
    }
    if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd ?? selStart);
  };

  const selection = () => {
    const ta = taRef.current!;
    return { start: ta.selectionStart, end: ta.selectionEnd, value: ta.value };
  };

  /** Wrap the selection in markers. Nothing selected: the caret lands between
   *  the markers, ready to type. Text selected: the caret lands after it, still
   *  inside the markers. Nothing is left selected, so typing never erases. */
  const wrap = (before: string, after: string) => {
    const { start, end, value } = selection();
    const inner = value.slice(start, end);
    replace(start, end, before + inner + after, start + before.length + inner.length);
  };

  /** A link: type the text first if none is selected, else go straight to the
   *  address after "https://". */
  const link = () => {
    const { start, end, value } = selection();
    const inner = value.slice(start, end);
    const text = `[${inner}](https://)`;
    replace(start, end, text, inner ? start + text.length - 1 : start + 1);
  };

  /** Apply `fn` to every line the selection touches, then put the caret at the
   *  end of them. `keepSelection` keeps the lines selected instead (indenting,
   *  so Tab can be pressed again). */
  const eachLine = (fn: (line: string, index: number) => string, keepSelection = false) => {
    const { start, end, value } = selection();
    const from = value.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = value.indexOf("\n", end);
    const to = nextBreak === -1 ? value.length : nextBreak;
    const next = value.slice(from, to).split("\n").map(fn).join("\n");
    if (keepSelection) replace(from, to, next, from, from + next.length);
    else replace(from, to, next, from + next.length);
  };

  const heading = (level: number) =>
    eachLine((line) => {
      const bare = line.replace(/^#{1,6}\s*/, "");
      const already = line.startsWith(`${"#".repeat(level)} `);
      return already ? bare : `${"#".repeat(level)} ${bare}`;
    });

  const prefixLines = (make: (i: number) => string, test: RegExp) =>
    eachLine((line, i) => (test.test(line) ? line.replace(test, "") : make(i) + line));

  /** Put a block on its own lines at the caret. `caretAt` is where in `text`
   *  the caret should land (inside a code block, say); default is the end. */
  const insertBlock = (text: string, caretAt = text.length) => {
    const { start, end, value } = selection();
    const lead = start > 0 && value[start - 1] !== "\n" ? "\n\n" : "";
    replace(start, end, lead + text, start + lead.length + caretAt);
  };

  const indent = (outdent: boolean) =>
    eachLine((line) => (outdent ? line.replace(/^( {1,2}|\t)/, "") : `  ${line}`), true);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      void save();
    } else if (mod && key === "b") {
      e.preventDefault();
      wrap("**", "**");
    } else if (mod && key === "i") {
      e.preventDefault();
      wrap("_", "_");
    } else if (mod && key === "e") {
      e.preventDefault();
      wrap("`", "`");
    } else if (mod && key === "k") {
      e.preventDefault();
      link();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const { start, end } = selection();
      if (e.shiftKey || start !== end) indent(e.shiftKey);
      else replace(start, end, "  ", start + 2);
    } else if (e.key === "Enter" && !e.shiftKey && !mod) {
      // Carry a list on: the next item gets the same marker (numbers count up,
      // tasks start unticked). Enter on an empty item ends the list.
      const { start, end, value } = selection();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const m = LIST_RE.exec(value.slice(lineStart, start));
      if (!m) return;
      e.preventDefault();
      const [, lead, marker, gap, box, rest] = m;
      if (!rest!.trim()) {
        replace(lineStart, end, lead!, lineStart + lead!.length);
        return;
      }
      const num = /^(\d+)([.)])$/.exec(marker!);
      const nextMarker = num ? `${Number(num[1]) + 1}${num[2]}` : marker!;
      const text = `\n${lead}${nextMarker}${gap}${box ? "[ ] " : ""}`;
      replace(start, end, text, start + text.length);
    } else if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
    }
  };

  const trackCaret = () => {
    const { start, value } = selection();
    const before = value.slice(0, start);
    const line = before.split("\n").length;
    setCaret({ line, col: start - before.lastIndexOf("\n") });
  };

  // The coloured layer follows the textarea; the preview follows by proportion.
  const onScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (layerRef.current) {
      layerRef.current.scrollTop = ta.scrollTop;
      layerRef.current.scrollLeft = ta.scrollLeft;
    }
    const pv = previewRef.current;
    if (pv && view === "split") {
      const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
      pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
    }
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  const save = async () => {
    setError(null);
    if (!content.trim()) return setError("The prompt is empty.");
    // No name yet: save it as the next free "untitled", like a new file.
    const finalName = name.trim() || untitledName(takenNames);
    if (over) return setError(`Too long. The limit is ${MAX_CHARS.toLocaleString()} characters.`);
    setBusy(true);
    try {
      await authed((t) =>
        existing
          ? api.updateAiPrompt(t, existing.id, finalName, content.trim())
          : api.createAiPrompt(t, finalName, content.trim()),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't save the prompt.");
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    const text = (await file.text()).replace(/\r\n?/g, "\n");
    setContent(text);
    if (!name.trim()) setName(file.name.replace(/\.(md|markdown|txt)$/i, ""));
    if (text.length > MAX_CHARS) {
      setError(
        `That file is ${text.length.toLocaleString()} characters. Trim it to ${MAX_CHARS.toLocaleString()} to save.`,
      );
    }
  };

  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(name || untitledName(takenNames))}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showWrite = view !== "preview";
  const showPreview = view !== "write";
  const icon = "h-4 w-4";

  return (
    <div className="modal-scrim z-[120] p-0 sm:p-4" onClick={requestClose}>
      <div
        ref={rootRef}
        className="md-editor relative flex h-[100dvh] w-full flex-col overflow-hidden sm:h-[calc(100dvh-2rem)] sm:rounded-2xl"
        data-ed-theme={prefs.editorTheme}
        data-font={prefs.editorFont}
        data-wrap={prefs.editorWrap ? "on" : "off"}
        data-numbers={prefs.editorLineNumbers ? "on" : "off"}
        style={{ "--ed-size": `${prefs.editorFontSize}px` } as React.CSSProperties}
        onClick={(e) => {
          e.stopPropagation();
          setMenu(null);
        }}
      >
        {/* Top bar: the file, its name, the view, and save. */}
        <div className="md-bar flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
          <label
            className="md-tab flex min-w-0 max-w-full cursor-text items-center gap-2 rounded-lg px-3 py-1.5 text-[0.8125rem]"
            title="Rename"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            {/* The input sizes to its text: an invisible copy sets the width. */}
            <span className="inline-grid min-w-0 font-mono">
              <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 max-w-[16rem] overflow-hidden whitespace-pre sm:max-w-[24rem]"
              >
                {name || untitledName(takenNames)}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={untitledName(takenNames)}
                aria-label="Prompt name"
                spellCheck={false}
                size={1}
                className="md-tab-input col-start-1 row-start-1 w-full min-w-0 bg-transparent p-0 font-mono outline-none"
              />
            </span>
            <span className="md-muted -ml-2 shrink-0 font-mono">.md</span>
            {dirty ? (
              <span className="md-dot h-1.5 w-1.5 shrink-0 rounded-full" title="Unsaved changes" />
            ) : null}
          </label>
          <div className="ml-auto flex items-center gap-2">
            <div className="md-seg sm:hidden">
              <Segmented<"write" | "preview">
                label="View"
                value={phoneTab}
                onChange={setPhoneTab}
                options={[
                  { value: "write", label: "Write" },
                  { value: "preview", label: "Preview" },
                ]}
              />
            </div>
            <div className="md-seg hidden sm:block">
              <Segmented<EditorView>
                label="View"
                value={view}
                onChange={(editorView) => setPrefs({ editorView })}
                options={[
                  { value: "write", label: "Write" },
                  { value: "split", label: "Split" },
                  { value: "preview", label: "Preview" },
                ]}
              />
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="md-ghost rounded-full px-3 py-1.5 text-[0.8125rem]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || over}
              className="md-primary rounded-full px-4 py-1.5 text-[0.8125rem] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="md-ghost hidden h-8 w-8 items-center justify-center rounded-full sm:flex"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div
          className={`md-bar md-toolbar thin-scroll flex items-center gap-0.5 overflow-x-auto px-2 py-1 sm:px-3 ${
            phoneTab === "preview" ? "max-sm:hidden" : ""
          } ${showWrite ? "" : "sm:hidden"}`}
        >
          <ToolButton label="Heading 1" onClick={() => heading(1)}>
            <Heading1 className={icon} />
          </ToolButton>
          <ToolButton label="Heading 2" onClick={() => heading(2)}>
            <Heading2 className={icon} />
          </ToolButton>
          <ToolButton label="Heading 3" onClick={() => heading(3)}>
            <Heading3 className={icon} />
          </ToolButton>
          <span className="md-sep mx-1 h-5 w-px shrink-0" />
          <ToolButton label="Bold (⌘B)" onClick={() => wrap("**", "**")}>
            <Bold className={icon} />
          </ToolButton>
          <ToolButton label="Italic (⌘I)" onClick={() => wrap("_", "_")}>
            <Italic className={icon} />
          </ToolButton>
          <ToolButton label="Inline code (⌘E)" onClick={() => wrap("`", "`")}>
            <Code className={icon} />
          </ToolButton>
          <ToolButton label="Link (⌘K)" onClick={link}>
            <LinkIcon className={icon} />
          </ToolButton>
          <span className="md-sep mx-1 h-5 w-px shrink-0" />
          <ToolButton label="Quote" onClick={() => prefixLines(() => "> ", /^>\s?/)}>
            <Quote className={icon} />
          </ToolButton>
          <ToolButton label="Bullet list" onClick={() => prefixLines(() => "- ", /^[-*+]\s/)}>
            <List className={icon} />
          </ToolButton>
          <ToolButton label="Numbered list" onClick={() => prefixLines((i) => `${i + 1}. `, /^\d+[.)]\s/)}>
            <ListOrdered className={icon} />
          </ToolButton>
          <ToolButton label="Checklist" onClick={() => prefixLines(() => "- [ ] ", /^[-*+]\s\[[ xX]\]\s/)}>
            <ListChecks className={icon} />
          </ToolButton>
          <span className="md-sep mx-1 h-5 w-px shrink-0" />
          <ToolButton label="Code block" onClick={() => insertBlock("```\n\n```\n", 4)}>
            <SquareCode className={icon} />
          </ToolButton>
          <ToolButton label="Divider" onClick={() => insertBlock("---\n")}>
            <Minus className={icon} />
          </ToolButton>
          <span className="md-sep mx-1 h-5 w-px shrink-0" />
          <div className="relative shrink-0">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                const root = rootRef.current?.getBoundingClientRect();
                const btn = e.currentTarget.getBoundingClientRect();
                if (root) setSnippetLeft(Math.max(8, btn.left - root.left));
                setMenu(menu === "snippets" ? null : "snippets");
              }}
              aria-expanded={menu === "snippets"}
              className="md-tool flex h-8 items-center gap-1 rounded-md px-2 text-[0.8125rem]"
            >
              Insert section <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <ToolButton label="Import .md file" onClick={() => fileRef.current?.click()}>
              <FileUp className={icon} />
            </ToolButton>
            <ToolButton label="Download as .md" onClick={exportFile}>
              <FileDown className={icon} />
            </ToolButton>
            <button
              type="button"
              title="Editor settings"
              aria-label="Editor settings"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(menu === "settings" ? null : "settings");
              }}
              className="md-tool flex h-8 w-8 items-center justify-center rounded-md"
            >
              <Settings2 className={icon} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Menus, positioned under the toolbar. */}
        <div className="relative">
          {menu === "snippets" ? (
            <div
              className="md-menu absolute top-1 z-20 w-56 rounded-xl p-1"
              style={{ left: snippetLeft }}
              onClick={(e) => e.stopPropagation()}
            >
              {SNIPPETS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    insertBlock(s.text);
                    setMenu(null);
                  }}
                  className="md-menu-item block w-full rounded-lg px-3 py-1.5 text-left text-[0.8125rem]"
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          {menu === "settings" ? (
            <div
              className="md-menu absolute right-3 top-1 z-20 w-[min(22rem,calc(100vw-1.5rem))] space-y-4 rounded-xl p-4 text-[0.8125rem]"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <p className="md-muted mb-1.5">Theme</p>
                <ThemePicker
                  value={prefs.editorTheme}
                  onChange={(editorTheme) => setPrefs({ editorTheme })}
                />
              </div>
              <div>
                <p className="md-muted mb-1.5">Font</p>
                <div className="md-seg">
                  <Segmented<EditorFont>
                    label="Font"
                    value={prefs.editorFont}
                    onChange={(editorFont) => setPrefs({ editorFont })}
                    options={[
                      { value: "mono", label: "Monospace" },
                      { value: "sans", label: "Sans" },
                    ]}
                  />
                </div>
              </div>
              <div>
                <p className="md-muted mb-1.5">Size</p>
                <div className="md-seg">
                  <Segmented<EditorFontSize>
                    label="Font size"
                    value={prefs.editorFontSize}
                    onChange={(editorFontSize) => setPrefs({ editorFontSize })}
                    options={(["13", "14", "15", "16", "18"] as const).map((v) => ({ value: v, label: v }))}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span>Wrap long lines</span>
                <Toggle
                  label="Wrap long lines"
                  checked={prefs.editorWrap}
                  onChange={(editorWrap) => setPrefs({ editorWrap })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span>Line numbers</span>
                <Toggle
                  label="Line numbers"
                  checked={prefs.editorLineNumbers}
                  onChange={(editorLineNumbers) => setPrefs({ editorLineNumbers })}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Write and preview panes */}
        <div className="flex min-h-0 flex-1">
          {/* Both panes are always there; which show depends on the phone tab
              below `sm` and on the saved view above it. */}
          <div
            className={`md-pane relative min-w-0 flex-1 ${showWrite && showPreview ? "sm:border-r md-divider" : ""} ${
              phoneTab === "write" ? "" : "max-sm:hidden"
            } ${showWrite ? "" : "sm:hidden"}`}
          >
            <div ref={layerRef} className="md-layer md-highlight" aria-hidden="true">
              {lines.map((line, i) => (
                <div key={i} className={`md-line ${line.cls ?? ""}`}>
                  {line.segments.length && line.segments.some((s) => s.text)
                    ? line.segments.map((s, j) =>
                        s.cls ? (
                          <span key={j} className={s.cls}>
                            {s.text}
                          </span>
                        ) : (
                          s.text
                        ),
                      )
                    : "​"}
                </div>
              ))}
            </div>
            <textarea
              ref={taRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                trackCaret();
              }}
              onKeyDown={onKeyDown}
              onKeyUp={trackCaret}
              onClick={trackCaret}
              onSelect={trackCaret}
              onScroll={onScroll}
              spellCheck={false}
              aria-label="Prompt text, in Markdown"
              placeholder={"# Role\n\nYou are a helpful assistant who…"}
              className="md-layer md-input-layer"
            />
          </div>
          <div
            ref={previewRef}
            className={`md-pane md-preview thin-scroll min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 ${
              phoneTab === "preview" ? "" : "max-sm:hidden"
            } ${showPreview ? "" : "sm:hidden"}`}
          >
            {content.trim() ? (
              <ReactMarkdown remarkPlugins={MD_PLUGINS}>{content}</ReactMarkdown>
            ) : (
              <p className="md-muted">Nothing to preview yet.</p>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="md-bar md-status flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[0.75rem]">
          <span>
            Ln {caret.line}, Col {caret.col}
          </span>
          <span>{words.toLocaleString()} words</span>
          <span className={over ? "md-over" : undefined}>
            {content.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
          </span>
          <span className="hidden sm:inline">Markdown</span>
          {error ? <span className="md-over ml-auto">{error}</span> : null}
        </div>

        {confirmClose ? (
          <div
            className="md-scrim absolute inset-0 z-30 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="md-menu w-full max-w-sm rounded-2xl p-5">
              <p className="text-[0.9375rem]">Discard your changes?</p>
              <p className="md-muted mt-1 text-[0.8125rem]">
                What you&apos;ve written here hasn&apos;t been saved.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClose(false)}
                  className="md-ghost rounded-full px-3 py-1.5 text-[0.8125rem]"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="md-primary rounded-full px-4 py-1.5 text-[0.8125rem]"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
