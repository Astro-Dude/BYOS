"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth-context";
import { homeAfterSignIn } from "@/lib/pending-question";

/** Sends already-signed-in visitors straight to the dashboard. Renders nothing.
 *  Drop into public pages (landing) so a persisted session skips the marketing/
 *  login screens. */
export function RedirectIfAuthed() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) router.replace(homeAfterSignIn());
  }, [loading, user, router]);

  return null;
}
