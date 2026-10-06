"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** /settings: on phones the shell shows the list of sections here; on wider
 *  screens, where that list is the rail, it opens the first section. */
export default function SettingsIndex() {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) router.replace("/settings/profile");
  }, [router]);
  return null;
}
