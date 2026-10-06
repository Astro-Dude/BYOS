import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import { Providers } from "./providers";

// Signifier stand-in — the display serif. Weight 400 only, at every size: the
// serif whispers authority rather than shouting in bold (DESIGN.md). Italic is
// loaded because the display style sets one phrase per headline in italics.
const display = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// Sohne stand-in — the UI workhorse. Variable so the half-step weights
// (430/450/480) that carry Steep's fine-grained hierarchy actually resolve.
const ui = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BYOS: Bring Your Own Storage",
  description:
    "One place to organize, search, preview and share the storage you already own, with links that never break.",
};

// Sets the theme before the first paint, so a dark page never flashes white.
// Mirrors the theme effect in lib/preferences: light unless the saved choice
// is Dark, or System on a device set to dark. Kept tiny: it blocks rendering.
const THEME_BOOT = `(function(){try{var t=(JSON.parse(localStorage.getItem("byos:prefs")||"{}")||{}).theme;if(t==="system"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: the boot script sets data-theme on <html> before
  // React hydrates, which the server's markup can't know about.
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
