"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Sign-up no longer exists — logging in with Telegram creates your account.
export default function RegisterPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
