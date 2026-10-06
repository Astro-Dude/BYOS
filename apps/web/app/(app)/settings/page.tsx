"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** /settings: on phones the shell shows the list of sections here; on wider
 *  screens, where that list is the rail, it opens the first section. */
export default function SettingsIndex() {
  const router = useRouter();
  useEffect(() => {
    // Keep the query (?from=drive) so the way back still points where you came from.
    if (window.matchMedia("(min-width: 768px)").matches) router.replace(`/settings/profile${window.location.search}`);
  }, [router]);
  return null;
}
