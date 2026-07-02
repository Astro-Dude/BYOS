import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import { Providers } from "./providers";

// Geometric grotesque for the BYOS brand/wordmark (a free stand-in for Neotriad).
const brand = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BYOS — Bring Your Own Storage",
  description:
    "A unified layer on top of the storage you already own: organize, search, preview, version, and share — with permanent dynamic aliases.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={brand.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
