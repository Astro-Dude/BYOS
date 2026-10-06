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

export default function RootLayout({ children }: { children: ReactNode }) {
  // Light only, per DESIGN.md ("Theme: light"). No theme class, no boot script.
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
