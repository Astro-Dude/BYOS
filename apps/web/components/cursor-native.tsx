"use client";

import { useEffect } from "react";

import {
  type CursorColor,
  type CursorDesign,
  type CursorState,
  cursorSvg,
  SIZE_PX,
  type CursorSizeName,
  svgDataUrl,
} from "@/lib/cursor-design";

/**
 * The cursor as images the operating system draws.
 *
 * A cursor drawn by the page always trails the mouse by a frame or two: the OS
 * moves its own cursor in hardware, the page only on its next paint. Handing the
 * OS a custom image (CSS `cursor: url(...)`) keeps the look and moves at system
 * speed. The states (clickable, text, disabled) are separate images.
 */

// What counts as clickable, typeable or disabled. Matches components/cursor.tsx.
export const POINTER =
  'a[href], button, summary, label, [role="button"], [role="link"], [role="option"], [role="menuitem"], ' +
  '[role="tab"], [role="checkbox"], [role="switch"], [role="radio"], .cursor-pointer, input[type="checkbox"], ' +
  'input[type="radio"], input[type="range"], input[type="file"], input[type="color"], ' +
  'input[type="submit"], input[type="button"]';
export const TEXT =
  'textarea, [contenteditable=""], [contenteditable="true"], input:not([type="button"]):not([type="submit"])' +
  ':not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"])' +
  ':not([type="color"]):not([type="image"])';
export const DISABLED = ':disabled, [aria-disabled="true"], .cursor-not-allowed';

const FALLBACK: Record<CursorState, string> = {
  default: "default",
  pointer: "pointer",
  text: "text",
  disabled: "not-allowed",
};

export function NativeCursor({
  design,
  color,
  size,
  theme,
}: {
  design: CursorDesign;
  color: CursorColor;
  size: CursorSizeName;
  /** Only a redraw trigger: the colours are read from the theme's tokens. */
  theme?: string;
}) {
  useEffect(() => {
    const v = (state: CursorState) => {
      const img = cursorSvg(state, design, color, SIZE_PX[size]);
      return `url("${svgDataUrl(img.svg)}") ${img.hotX} ${img.hotY}, ${FALLBACK[state]}`;
    };
    // Every rule has the same specificity (:where adds none), so the last that
    // matches wins: default, then clickable, then text, then disabled.
    const scope = "html.byos-native-cursor";
    const css = [
      `${scope}, ${scope} * { cursor: ${v("default")} !important; }`,
      `${scope} :where(${POINTER}), ${scope} :where(${POINTER}) * { cursor: ${v("pointer")} !important; }`,
      `${scope} :where(${TEXT}) { cursor: ${v("text")} !important; }`,
      `${scope} :where(${DISABLED}), ${scope} :where(${DISABLED}) * { cursor: ${v("disabled")} !important; }`,
    ].join("\n");

    const style = document.createElement("style");
    style.dataset.byosCursor = "";
    style.textContent = css;
    document.head.appendChild(style);
    document.documentElement.classList.add("byos-native-cursor");
    return () => {
      style.remove();
      document.documentElement.classList.remove("byos-native-cursor");
    };
  }, [design, color, size, theme]);

  return null;
}
