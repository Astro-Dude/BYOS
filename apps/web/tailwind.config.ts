import type { Config } from "tailwindcss";

/** Steep — "serif analytics on warm paper" (DESIGN.md).
 *
 *  The Steep palette is mapped onto the utility names the app already uses
 *  (`zinc` for neutrals, `indigo` for the primary action, `amber` for warnings)
 *  rather than introducing new ones. That re-skins every surface at once and
 *  keeps the diff in one file instead of 46 — the same trick the previous
 *  slate-teal theme used.
 *
 *  `darkMode: "class"` is deliberate even with no dark theme: Tailwind's default
 *  is `media`, so a stray `dark:` utility would silently fire on a visitor's OS
 *  preference. With the class mode set and nothing ever applying the class, such
 *  a utility does nothing instead of half-theming a page.
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
        // Every neutral resolves through a CSS variable holding an RGB channel
        // triplet, so `<alpha-value>` keeps opacity modifiers working and a theme
        // swap is a value change rather than a second set of utilities. See the
        // token block in globals.css for what each step means.
        //
        // `white` is overridden on purpose: it means "the page", and the page is
        // not white in dark mode. Anything that must stay literally white uses
        // `paper` below.
        white: "rgb(var(--c-paper) / <alpha-value>)",
        zinc: {
          50: "rgb(var(--c-50) / <alpha-value>)",
          100: "rgb(var(--c-100) / <alpha-value>)",
          200: "rgb(var(--c-200) / <alpha-value>)",
          300: "rgb(var(--c-300) / <alpha-value>)",
          400: "rgb(var(--c-400) / <alpha-value>)",
          500: "rgb(var(--c-500) / <alpha-value>)",
          600: "rgb(var(--c-600) / <alpha-value>)",
          700: "rgb(var(--c-700) / <alpha-value>)",
          800: "rgb(var(--c-800) / <alpha-value>)",
          900: "rgb(var(--c-900) / <alpha-value>)",
          950: "rgb(var(--c-950) / <alpha-value>)",
        },
        // Primary action. Steep's CTA is a solid ink lozenge, so the accent ramp
        // resolves to the neutral ink rather than a hue — and inverts with it, so
        // the pill is dark on paper and pale on ink.
        indigo: {
          50: "rgb(var(--c-50) / <alpha-value>)",
          100: "rgb(var(--c-100) / <alpha-value>)",
          200: "rgb(var(--c-200) / <alpha-value>)",
          300: "rgb(var(--c-300) / <alpha-value>)",
          400: "rgb(var(--c-700) / <alpha-value>)",
          500: "rgb(var(--c-800) / <alpha-value>)",
          600: "rgb(var(--c-900) / <alpha-value>)",
          700: "rgb(var(--c-950) / <alpha-value>)",
          800: "rgb(var(--c-950) / <alpha-value>)",
          900: "rgb(var(--c-950) / <alpha-value>)",
        },
        // The warm pair, mapped onto `amber-*` so existing warning styles resolve
        // to the sanctioned ground/ink combination. It follows the theme: 600 is
        // sienna on paper and blush on ink, because a warning has to stay legible
        // either way.
        amber: {
          50: "rgb(var(--c-blush) / <alpha-value>)",
          100: "rgb(var(--c-blush) / <alpha-value>)",
          200: "rgb(var(--c-blush) / <alpha-value>)",
          300: "rgb(var(--c-blush) / <alpha-value>)", // ground
          400: "rgb(var(--c-blush-mid) / <alpha-value>)",
          500: "rgb(var(--c-blush-mid) / <alpha-value>)",
          600: "rgb(var(--c-blush-ink) / <alpha-value>)", // ink on the ground
          700: "rgb(var(--c-blush-ink) / <alpha-value>)",
        },
        peach: "rgb(var(--c-blush) / <alpha-value>)",
        sienna: "rgb(var(--c-blush-ink) / <alpha-value>)",
        // Danger. Steep provides no risk colour and BYOS deletes bytes from the
        // user's storage for good, so the muted brick is kept — and it lightens
        // in dark mode so it still reads as risk.
        red: {
          50: "rgb(var(--c-danger-50) / <alpha-value>)",
          300: "rgb(var(--c-danger-300) / <alpha-value>)",
          500: "rgb(var(--c-danger-500) / <alpha-value>)",
          600: "rgb(var(--c-danger-600) / <alpha-value>)",
          700: "rgb(var(--c-danger-700) / <alpha-value>)",
        },
        // Fixed, theme-independent values for surfaces that are deliberately dark
        // in both themes — the terminal is a terminal.
        ink: "#17191C",
        paper: "#FFFFFF",
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
