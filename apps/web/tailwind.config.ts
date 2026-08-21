import type { Config } from "tailwindcss";

/** Steep — "serif analytics on warm paper" (DESIGN.md).
 *
 *  The Steep palette is mapped onto the utility names the app already uses
 *  (`zinc` for neutrals, `indigo` for the primary action, `amber` for warnings)
 *  rather than introducing new ones. That re-skins every surface at once and
 *  keeps the diff in one file instead of 46 — the same trick the previous
 *  slate-teal theme used.
 *
 *  `darkMode: "class"` is kept even though the dark variants are all gone: the
 *  default is `media`, so any dark utility reintroduced later would silently
 *  fire on a system preference instead of doing nothing visible.
 */
export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Signifier → Source Serif 4. Display and headings only, weight 400.
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        // Sohne → Inter. Body, UI, navigation; carries the half-step weights.
        sans: ["var(--font-ui)", "ui-sans-serif", "system-ui", "sans-serif"],
        brand: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        // Neutrals — Steep's achromatic ramp. Paper white canvas, mist and fog
        // for nested surfaces, three functional grays, ink for all text.
        zinc: {
          50: "#FAFAFB", // Fog White — alternating section bands, hover surfaces
          100: "#F2F2F3", // Mist Gray — card surfaces, input fills
          200: "#ECECEC", // hairline borders
          300: "#E3E3E5",
          400: "#A3A6AF", // Smoke Gray — placeholders, disabled
          500: "#979799", // Ash Gray — tertiary labels, category tags
          600: "#777B86", // Slate Gray — links, muted helper text
          700: "#4B4E57",
          800: "#2A2C31",
          900: "#17191C", // Ink Black — primary text
          950: "#101114",
        },
        // Primary action. Steep's CTA is a solid ink lozenge, so the accent ramp
        // resolves to ink rather than a hue — `bg-indigo-600` becomes the pill.
        indigo: {
          50: "#F4F4F5",
          100: "#E8E8EA",
          200: "#D2D3D6",
          300: "#A9ABB1",
          400: "#5B5E66",
          500: "#2F3238",
          600: "#17191C",
          700: "#101114",
          800: "#0B0C0E",
          900: "#070809",
        },
        // The one chromatic surface. `amber-*` maps onto the peach/sienna pair so
        // existing warning styles resolve to the sanctioned warm-on-warm
        // combination instead of a foreign yellow.
        amber: {
          50: "#FEF6F1",
          100: "#FDEDE3",
          200: "#FCE7DA",
          300: "#FBE1D1", // Blush Peach — accent card background
          400: "#F5CDB2",
          500: "#E0A681",
          600: "#5D2A1A", // Sienna Brown — text and strokes on peach only
          700: "#4C2114",
        },
        peach: "#FBE1D1",
        sienna: "#5D2A1A",
        // Danger. Steep provides no risk colour and BYOS deletes bytes from the
        // user's storage for good, so the muted brick is kept — desaturated
        // enough to sit inside an achromatic system.
        red: {
          50: "#FBEEEB",
          300: "#E5B3A8",
          500: "#C24A38",
          600: "#B23A2E",
          700: "#93301E",
        },
      },
      borderRadius: {
        // Steep's geometry: 12px images, 16px small cards, 20px elevated,
        // 24px content cards, pills for every button.
        sm: "8px",
        DEFAULT: "12px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
      },
      boxShadow: {
        // Only floating artifacts, modals and popovers earn elevation, and never
        // above 10% opacity. Content cards stay flat.
        sm: "oklab(0 0 0 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.08) 0px 4px 24px 0px",
        DEFAULT: "oklab(0 0 0 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.08) 0px 4px 24px 0px",
        md: "oklab(0 0 0 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.08) 0px 4px 24px 0px",
        lg: "oklab(0 0 0 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.08) 0px 4px 24px 0px",
        xl: "oklab(0 0 0 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.1) 0px 8px 40px 0px",
        "2xl": "oklab(0 0 0 / 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.1) 0px 8px 40px 0px",
        artifact:
          "rgba(4, 23, 43, 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.1) 0px 20px 25px -5px, rgba(0, 0, 0, 0.1) 0px 8px 10px -6px",
        none: "none",
      },
      letterSpacing: {
        // Tighter tracking at larger sizes is the typographic signature.
        display: "-0.025em",
        heading: "-0.015em",
        tight2: "-0.009em",
      },
      maxWidth: {
        page: "1200px",
      },
    },
  },
  plugins: [],
} satisfies Config;
