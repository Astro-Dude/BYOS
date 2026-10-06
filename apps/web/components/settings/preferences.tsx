"use client";

import type { AiPrompt } from "@byos/api-client";
import { Check, MousePointer2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Dropdown } from "@/components/byok/dropdown";
import { MODES } from "@/components/byok/mode-menu";
import {
  Segmented,
  SettingRow,
  SettingsGroup,
  SettingsHeader,
  Toggle,
} from "@/components/settings/controls";
import {
  COLOR_LABELS,
  type CursorColor,
  type CursorDesign,
  cursorSvg,
  DESIGNS,
  outlineCss,
  svgDataUrl,
  swatchCss,
} from "@/lib/cursor-design";
import {
  type ChatStartMode,
  type ChatStrategies,
  type CursorChoice,
  type CursorSize,
  type DriveSort,
  type TextSize,
  type UploadConflict,
  usePreferences,
} from "@/lib/preferences";
import { ANSWER_ADDONS, SEARCH_ADDONS } from "@/lib/chat-addons";
import { useToast } from "@/lib/toast";

const dropdownField =
  "min-w-[12rem] rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[0.8125rem] text-zinc-900 hover:border-zinc-900";

const DESIGN_ORDER: CursorDesign[] = ["arrow", "classic", "plane", "pebble"];
const COLOR_ORDER: CursorColor[] = ["ink", "graphite", "sienna", "ember", "blush", "paper"];

/** A selectable card: a preview on a soft surface, its name, a short line. */
function ChoiceTile({
  selected,
  onSelect,
  label,
  blurb,
  disabled = false,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  blurb?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-zinc-900 ring-1 ring-zinc-900"
          : "border-zinc-200 hover:border-zinc-400"
      }`}
    >
      <div className="flex h-24 items-center justify-center bg-zinc-50">{children}</div>
      <div className="px-3.5 py-2.5">
        <p className="text-[0.875rem] text-zinc-900">{label}</p>
        {blurb ? <p className="text-[0.75rem] text-zinc-500">{blurb}</p> : null}
      </div>
      {selected ? (
        <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white">
          <Check className="h-3 w-3" />
        </span>
      ) : null}
    </button>
  );
}

/** A row of choice tiles, inside a group. */
function TileRow({ label, cols, children }: { label: string; cols: string; children: React.ReactNode }) {
  return (
    <div className="py-5">
      <div role="radiogroup" aria-label={label} className={`grid grid-cols-2 gap-3 ${cols}`}>
        {children}
      </div>
    </div>
  );
}

/** A design drawn the way it will look, at rest and over something clickable. */
function CursorPreview({ design, color }: { design: CursorDesign; color: CursorColor }) {
  // Drawn after mount: the colours come from the page's CSS variables.
  const [urls, setUrls] = useState<{ rest: string; hover: string } | null>(null);
  useEffect(() => {
    setUrls({
      rest: svgDataUrl(cursorSvg("default", design, color, 30).svg),
      hover: svgDataUrl(cursorSvg("pointer", design, color, 30).svg),
    });
  }, [design, color]);
  if (!urls) return null;
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls.rest} alt="" className="h-14 w-14" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls.hover} alt="" className="h-14 w-14 opacity-60" />
    </div>
  );
}

const TEXT_SIZES: { value: TextSize; label: string; px: number }[] = [
  { value: "small", label: "Small", px: 15 },
  { value: "default", label: "Default", px: 18 },
  { value: "large", label: "Large", px: 22 },
  { value: "xlarge", label: "Extra large", px: 26 },
];

export function AppearanceSettings() {
  const { prefs, setPrefs, resetPrefs } = usePreferences();
  const toast = useToast();
  const system = prefs.cursorDesign === "system";
  const designColor = prefs.cursorColor;

  return (
    <>
      <SettingsHeader title="Appearance" description="How BYOS looks and moves on this device." />

      <SettingsGroup title="Cursor">
        <div className="py-5">
          <div role="radiogroup" aria-label="Cursor" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {DESIGN_ORDER.map((d) => (
              <ChoiceTile
                key={d}
                selected={prefs.cursorDesign === d}
                onSelect={() => setPrefs({ cursorDesign: d })}
                label={DESIGNS[d].label}
                blurb={DESIGNS[d].blurb}
              >
                <CursorPreview design={d} color={designColor} />
              </ChoiceTile>
            ))}
            <ChoiceTile
              selected={system}
              onSelect={() => setPrefs({ cursorDesign: "system" as CursorChoice })}
              label="System"
              blurb="Your computer's own"
            >
              <MousePointer2 className="h-8 w-8 text-zinc-400" />
            </ChoiceTile>
          </div>
        </div>

        <SettingRow label="Colour" disabled={system}>
          <div role="radiogroup" aria-label="Cursor colour" className="flex flex-wrap items-center gap-2.5">
            {COLOR_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={prefs.cursorColor === c}
                aria-label={COLOR_LABELS[c]}
                title={COLOR_LABELS[c]}
                onClick={() => setPrefs({ cursorColor: c })}
                className={`h-8 w-8 rounded-full ring-offset-2 transition-transform hover:scale-110 ${
                  prefs.cursorColor === c ? "ring-2 ring-zinc-900" : ""
                }`}
                style={{ background: swatchCss(c), boxShadow: `inset 0 0 0 1.5px ${outlineCss(c)}, 0 1px 3px rgb(0 0 0 / 0.15)` }}
              />
            ))}
            <span className="ml-1 text-[0.8125rem] text-zinc-500">{COLOR_LABELS[prefs.cursorColor]}</span>
          </div>
        </SettingRow>
        <SettingRow label="Size" disabled={system}>
          <Segmented<CursorSize>
            label="Cursor size"
            value={prefs.cursorSize}
            onChange={(cursorSize) => setPrefs({ cursorSize })}
            options={[
              { value: "small", label: "Small" },
              { value: "default", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
          />
        </SettingRow>
        <SettingRow
          label="Live motion"
          description="Tilts in 3D as you move and reacts to clicks. It's drawn by the page, so it trails your mouse slightly. Off, it moves exactly with your mouse."
          disabled={system}
        >
          <Toggle label="Live motion" checked={prefs.cursorMotion} onChange={(cursorMotion) => setPrefs({ cursorMotion })} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Text size">
        <div className="py-5">
          <div role="radiogroup" aria-label="Text size" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEXT_SIZES.map((t) => (
              <ChoiceTile
                key={t.value}
                selected={prefs.textSize === t.value}
                onSelect={() => setPrefs({ textSize: t.value })}
                label={t.label}
              >
                <span className="font-display text-zinc-900" style={{ fontSize: t.px * 1.6 }}>
                  Aa
                </span>
              </ChoiceTile>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Headings">
        <TileRow label="Headings" cols="sm:grid-cols-2">
          {(
            [
              { value: "serif", label: "Serif", blurb: "Editorial, the BYOS look", font: "var(--font-serif-original)" },
              { value: "sans", label: "Sans", blurb: "Clean and modern", font: "var(--font-ui)" },
            ] as const
          ).map((o) => (
            <ChoiceTile
              key={o.value}
              selected={prefs.headingFont === o.value}
              onSelect={() => setPrefs({ headingFont: o.value })}
              label={o.label}
              blurb={o.blurb}
            >
              <span className="text-[1.75rem] tracking-tight text-zinc-900" style={{ fontFamily: o.font }}>
                Your drive
              </span>
            </ChoiceTile>
          ))}
        </TileRow>
      </SettingsGroup>

      <SettingsGroup title="Interface font">
        <TileRow label="Interface font" cols="sm:grid-cols-2">
          {(
            [
              { value: "inter", label: "Inter", blurb: "Crisp at every size", font: "var(--font-inter-original)" },
              { value: "system", label: "System", blurb: "Your computer's own font", font: "var(--font-system)" },
            ] as const
          ).map((o) => (
            <ChoiceTile
              key={o.value}
              selected={prefs.uiFont === o.value}
              onSelect={() => setPrefs({ uiFont: o.value })}
              label={o.label}
              blurb={o.blurb}
            >
              <span className="text-[1.0625rem] text-zinc-700" style={{ fontFamily: o.font }}>
                Files, folders and links
              </span>
            </ChoiceTile>
          ))}
        </TileRow>
      </SettingsGroup>

      <SettingsGroup title="Highlight">
        <TileRow label="Highlight" cols="sm:grid-cols-2">
          {(
            [
              { value: "blush", label: "Blush", blurb: "Warm, on brand", bg: "rgb(var(--c-blush))", fg: "var(--ink-on-blush)" },
              { value: "ink", label: "Ink", blurb: "High contrast", bg: "rgb(var(--c-900))", fg: "rgb(var(--c-paper))" },
            ] as const
          ).map((o) => (
            <ChoiceTile
              key={o.value}
              selected={prefs.highlight === o.value}
              onSelect={() => setPrefs({ highlight: o.value })}
              label={o.label}
              blurb={o.blurb}
            >
              <span className="text-[0.9375rem] text-zinc-600">
                Your June salary was{" "}
                <span className="rounded px-1 font-medium" style={{ background: o.bg, color: o.fg }}>
                  ₹84,000
                </span>
              </span>
            </ChoiceTile>
          ))}
        </TileRow>
        <p className="pb-4 text-[0.8125rem] text-zinc-500">Used for selected text and the key figure in chat answers.</p>
      </SettingsGroup>

      <SettingsGroup title="Density">
        <TileRow label="Density" cols="sm:grid-cols-2">
          {(
            [
              { value: "comfortable", label: "Comfortable", blurb: "Room to breathe", gap: "gap-3" },
              { value: "compact", label: "Compact", blurb: "More files on screen", gap: "gap-1.5" },
            ] as const
          ).map((o) => (
            <ChoiceTile
              key={o.value}
              selected={prefs.density === o.value}
              onSelect={() => setPrefs({ density: o.value })}
              label={o.label}
              blurb={o.blurb}
            >
              <span className={`flex w-32 flex-col ${o.gap}`}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-sm bg-zinc-300" />
                    <span className="h-1.5 flex-1 rounded-full bg-zinc-200" />
                  </span>
                ))}
              </span>
            </ChoiceTile>
          ))}
        </TileRow>
      </SettingsGroup>

      <button
        className="pill-sm-ghost flex items-center gap-1.5"
        onClick={() => {
          resetPrefs();
          toast("Preferences reset");
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" /> Reset all preferences
      </button>
      <p className="mt-2 text-[0.8125rem] text-zinc-500">
        Resets appearance, Drive and Chat settings on this device.
      </p>
    </>
  );
}

const SORTS: { value: DriveSort; label: string }[] = [
  { value: "none", label: "Folder order" },
  { value: "name:asc", label: "Name (A–Z)" },
  { value: "name:desc", label: "Name (Z–A)" },
  { value: "modified:desc", label: "Newest first" },
  { value: "modified:asc", label: "Oldest first" },
  { value: "size:desc", label: "Largest first" },
  { value: "size:asc", label: "Smallest first" },
];

const CONFLICTS: { value: UploadConflict; label: string }[] = [
  { value: "ask", label: "Ask me each time" },
  { value: "keep", label: "Keep both" },
  { value: "replace", label: "Replace the old file" },
  { value: "skip", label: "Skip the upload" },
];

export function DriveSettings() {
  const { prefs, setPrefs } = usePreferences();
  return (
    <>
      <SettingsHeader title="Drive" description="How your files are shown and handled." />
      <SettingsGroup title="Browsing" description="Changing these in the Drive also updates them here.">
        <SettingRow label="Layout">
          <Segmented
            label="Layout"
            value={prefs.driveLayout}
            onChange={(driveLayout) => setPrefs({ driveLayout })}
            options={[
              { value: "list", label: "List" },
              { value: "grid", label: "Grid" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Sort by">
          <Dropdown
            align="right"
            ariaLabel="Sort by"
            value={prefs.driveSort}
            onChange={(v) => setPrefs({ driveSort: v as DriveSort })}
            options={SORTS}
            className={dropdownField}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Uploads and deleting">
        <SettingRow
          label="When a file already exists"
          description="What to do when you upload a file with the same name into the same folder."
        >
          <Dropdown
            align="right"
            ariaLabel="When a file already exists"
            value={prefs.uploadConflict}
            onChange={(v) => setPrefs({ uploadConflict: v as UploadConflict })}
            options={CONFLICTS}
            className={dropdownField}
          />
        </SettingRow>
        <SettingRow
          label="Ask before deleting"
          description="Deleting can't be undone. Deleting several items at once always asks."
        >
          <Toggle label="Ask before deleting" checked={prefs.confirmDelete} onChange={(confirmDelete) => setPrefs({ confirmDelete })} />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

export function ChatSettings({ prompts }: { prompts: AiPrompt[] }) {
  const { prefs, setPrefs } = usePreferences();
  // A default that was deleted reads as none.
  const defaultPrompt = prompts.some((p) => p.id === prefs.chatDefaultPrompt) ? prefs.chatDefaultPrompt : "none";
  const startModes: { value: ChatStartMode; label: string; title?: string }[] = [
    { value: "last", label: "Last used" },
    ...MODES.map((m) => ({ value: m.value as ChatStartMode, label: m.label, title: m.hint })),
  ];

  return (
    <>
      <SettingsHeader title="Chat" description="What a new BYOK chat starts with. You can still change them in the chat." />
      <SettingsGroup title="Defaults">
        <SettingRow
          label="System prompt"
          description="What a new chat starts with. Pick another one in any chat from the + menu."
        >
          <Dropdown
            align="right"
            ariaLabel="Default system prompt"
            value={defaultPrompt}
            onChange={(chatDefaultPrompt) => setPrefs({ chatDefaultPrompt })}
            options={[
              { value: "none", label: "None", hint: "No system prompt" },
              ...prompts.map((p) => ({ value: p.id, label: p.name })),
            ]}
            className={dropdownField}
          />
        </SettingRow>
        <SettingRow
          stack
          label="Permission mode"
          description={
            startModes.find((m) => m.value === prefs.chatStartMode)?.title ??
            "Starts in whichever mode you used last."
          }
        >
          <Segmented<ChatStartMode>
            label="Permission mode"
            value={prefs.chatStartMode}
            onChange={(chatStartMode) => setPrefs({ chatStartMode })}
            options={startModes}
          />
        </SettingRow>
      </SettingsGroup>

      {[
        {
          title: "Search strategies",
          description: "Extra steps when answering from your files. Each one adds a model call, so they're off by default.",
          addons: SEARCH_ADDONS,
        },
        {
          title: "Answers",
          description: "How a new chat's answers are written.",
          addons: ANSWER_ADDONS,
        },
      ].map((group) => (
        <SettingsGroup key={group.title} title={group.title} description={group.description}>
          {group.addons.map((a) => (
            <SettingRow key={a.key} label={a.label} description={`${a.hint}. Known as ${a.tech}.`}>
              <Toggle
                label={a.label}
                checked={!!prefs.chatStrategies[a.key]}
                onChange={(on) => setPrefs({ chatStrategies: { ...prefs.chatStrategies, [a.key]: on } })}
              />
            </SettingRow>
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}
