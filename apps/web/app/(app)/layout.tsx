import type { ReactNode } from "react";

import { SupportFab } from "@/components/support-fab";

/** Layout for the signed-in app (Drive + BYOK). The support button lives here
 *  rather than in the root layout so it doesn't follow you onto the marketing,
 *  login and public-share pages. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SupportFab />
    </>
  );
}
