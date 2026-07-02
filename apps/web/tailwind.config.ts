import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        brand: ["var(--font-brand)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Premium neutral base — warm greige, not cold gray. Page bg = zinc-50,
        // cards stay white for quiet contrast; ink = zinc-900.
        zinc: {
          50: "#F6F5F2",
          100: "#EFEDE8",
          200: "#E9E7E1",
          300: "#D9D6CE",
          400: "#B4AEA4",
          500: "#8B867D",
          600: "#6D685F",
          700: "#4B473F",
          800: "#2E2C27",
          900: "#1B1A18",
          950: "#131210",
        },
        // Accent — desaturated slate-teal (Vault). Used sparingly: primary
        // buttons, active nav, links, focus rings.
        indigo: {
          50: "#EBF1EF",
          100: "#D7E5E1",
          200: "#B9D2CB",
          300: "#8FB6AD",
          400: "#5E958B",
          500: "#4A8177",
          600: "#3C6E66",
          700: "#2E554F",
          800: "#26443F",
          900: "#1F3733",
        },
        // Danger — muted brick, not neon red.
        red: {
          50: "#FBEEEB",
          500: "#C24A38",
          600: "#B23A2E",
          700: "#93301E",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
