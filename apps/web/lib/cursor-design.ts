/**
 * Every cursor BYOS can draw, in one place.
 *
 * `cursorSvg` builds the image for a design, colour, size and state. The same
 * markup is handed to the operating system (moves at system speed), drawn by
 * the page for the animated cursor, and shown as previews in Settings, so all
 * three always match. Colours are read from the theme's CSS variables, so the
 * cursor follows the palette in globals.css.
 */

export type CursorDesign = "arrow" | "classic" | "plane" | "pebble";
export type CursorColor = "ink" | "graphite" | "sienna" | "ember" | "blush" | "paper";
export type CursorState = "default" | "pointer" | "text" | "disabled";

type Design = {
  label: string;
  blurb: string;
  /** Drawn in a 24-unit box. */
  d: string;
  evenodd?: boolean;
  /** The point that sits on the pointer. */
  hot: [number, number];
  /** How much it grows over something clickable. */
  hover: number;
  /** Where the disabled badge sits, from `hot`. */
  badge: [number, number];
  /** A part drawn darker on top, for a folded look. */
  fold?: string;
  /** Outline width (default 1.5). */
  outline?: number;
};

export const DESIGNS: Record<CursorDesign, Design> = {
  arrow: {
    label: "Arrow",
    blurb: "Sharp and precise",
    d: "M3.5 2.5L3.9 19.8L8.6 15.1L16.6 14.4Z",
    hot: [3.5, 2.5],
    hover: 1.08,
    badge: [11, 13.5],
  },
  classic: {
    label: "Classic",
    blurb: "The familiar one",
    d: "M3.5 2.5V19.6L7.9 15.6L10.7 21.9L13.5 20.7L10.8 14.5H16.9Z",
    hot: [3.5, 2.5],
    hover: 1.08,
    badge: [11, 14],
  },
  plane: {
    label: "Plane",
    blurb: "A folded paper plane",
    // Nose at the top left, wings swept back, a deep notch for the tail.
    d: "M3.5 2.5L21 9.6L11.6 10.9L10.4 20.4Z",
    // The lower wing, shaded, so it reads as folded paper.
    fold: "M3.5 2.5L11.6 10.9L10.4 20.4Z",
    hot: [3.5, 2.5],
    hover: 1.08,
    badge: [13, 14],
  },
  pebble: {
    label: "Pebble",
    blurb: "Soft and rounded",
    d:
      "M4.6 3.3C3.9 2.7 2.9 3.2 2.9 4.1L3.3 18.4C3.3 19.4 4.5 19.9 5.2 19.2L8.9 15.6" +
      "C9.1 15.4 9.4 15.3 9.7 15.3L14.9 15C15.9 14.9 16.3 13.7 15.6 13.1Z",
    hot: [3.2, 3.2],
    hover: 1.08,
    badge: [11, 13],
    outline: 2,
  },
};

/** Colours as theme tokens: a fill gradient (light to dark) and the outline. */
const COLORS: Record<CursorColor, { label: string; from: string; to: string; outline: string }> = {
  ink: { label: "Ink", from: "--c-800", to: "--c-950", outline: "--c-paper" },
  graphite: { label: "Graphite", from: "--c-600", to: "--c-800", outline: "--c-paper" },
  sienna: { label: "Sienna", from: "--c-blush-ink:0.82", to: "--c-blush-ink", outline: "--c-paper" },
  ember: { label: "Ember", from: "--c-blush-mid", to: "--c-blush-ink", outline: "--c-paper" },
  blush: { label: "Blush", from: "--c-blush", to: "--c-blush-mid", outline: "--c-blush-ink" },
  paper: { label: "Paper", from: "--c-paper", to: "--c-100", outline: "--c-900" },
};

export const COLOR_LABELS: Record<CursorColor, string> = Object.fromEntries(
  Object.entries(COLORS).map(([k, v]) => [k, v.label]),
) as Record<CursorColor, string>;

export const SIZE_PX = { small: 20, default: 24, large: 30 } as const;
export type CursorSizeName = keyof typeof SIZE_PX;

/** A theme token as a colour. "--name:0.8" mixes it toward black a little. */
function token(spec: string): string {
  const [name, mix] = spec.split(":");
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name!).trim();
  if (!mix) return `rgb(${raw})`;
  const k = Number(mix);
  const [r, g, b] = raw.split(/\s+/).map(Number);
  // Lighten toward paper: (1 - k) of the way to white.
  const lift = (v: number) => Math.round(v + (255 - v) * (1 - k));
  return `rgb(${lift(r!)} ${lift(g!)} ${lift(b!)})`;
}

// Room around the 24-unit drawing for the shadow, the badge and a swollen orb.
const PAD = 8;
const BOX = 24 + PAD * 2;

export type CursorImage = { svg: string; width: number; hotX: number; hotY: number };

export function cursorSvg(
  state: CursorState,
  design: CursorDesign,
  color: CursorColor,
  sizePx: number,
): CursorImage {
  const s = DESIGNS[design];
  const c = COLORS[color];
  const from = token(c.from);
  const to = token(c.to);
  const outline = token(c.outline);
  const shadow = token("--c-950");
  const badge = token("--c-blush");
  const badgeInk = token("--c-blush-ink");

  const lifted = state === "pointer";
  const defs =
    `<linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>` +
    `<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="${lifted ? 1.8 : 1}" stdDeviation="${lifted ? 1.5 : 0.9}" flood-color="${shadow}" flood-opacity="${lifted ? 0.4 : 0.32}"/></filter>`;

  let body: string;
  let hot: [number, number] = s.hot;
  if (state === "text") {
    hot = [12, 12];
    const beam = "M9 4.5H15M12 4.5V19.5M9 19.5H15";
    body =
      `<g filter="url(#s)"><path d="${beam}" fill="none" stroke="${outline}" stroke-width="4.2" stroke-linecap="round"/>` +
      `<path d="${beam}" fill="none" stroke="url(#f)" stroke-width="1.9" stroke-linecap="round"/></g>`;
  } else {
    const [hx, hy] = s.hot;
    const grow = lifted ? s.hover : 1;
    const rule = s.evenodd ? ' fill-rule="evenodd"' : "";
    const fold = s.fold
      ? `<path d="${s.fold}" fill="${shadow}" fill-opacity="0.22" stroke="${outline}" stroke-width="${(s.outline ?? 1.5) * 0.6}" stroke-linejoin="round"/>`
      : "";
    body =
      `<g transform="translate(${hx} ${hy}) scale(${grow}) translate(${-hx} ${-hy})"${state === "disabled" ? ' opacity="0.5"' : ""}>` +
      `<path d="${s.d}"${rule} fill="url(#f)" stroke="${outline}" stroke-width="${s.outline ?? 1.5}" stroke-linejoin="round" filter="url(#s)"/>` +
      fold +
      "</g>";
    if (state === "disabled") {
      const bx = hx + s.badge[0];
      const by = hy + s.badge[1];
      body +=
        `<g filter="url(#s)"><circle cx="${bx}" cy="${by}" r="4.25" fill="${badge}" stroke="${badgeInk}" stroke-width="1.5"/>` +
        `<path d="M${bx - 2.6} ${by + 2.6}L${bx + 2.6} ${by - 2.6}" stroke="${badgeInk}" stroke-width="1.5" stroke-linecap="round"/></g>`;
    }
  }

  const unit = sizePx / 24;
  const width = Math.round(BOX * unit);
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="${-PAD} ${-PAD} ${BOX} ${BOX}">` +
      `<defs>${defs}</defs>${body}</svg>`,
    width,
    hotX: Math.round((hot[0] + PAD) * unit),
    hotY: Math.round((hot[1] + PAD) * unit),
  };
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** A colour's gradient as CSS, for swatches (no DOM needed). */
export function swatchCss(color: CursorColor): string {
  const css = (spec: string) => {
    const [name, mix] = spec.split(":");
    return mix
      ? `color-mix(in srgb, rgb(var(${name})) ${Math.round(Number(mix) * 100)}%, white)`
      : `rgb(var(${name}))`;
  };
  const c = COLORS[color];
  return `linear-gradient(135deg, ${css(c.from)}, ${css(c.to)})`;
}

/** The outline colour, for drawing a swatch's ring. */
export function outlineCss(color: CursorColor): string {
  return `rgb(var(${COLORS[color].outline}))`;
}
