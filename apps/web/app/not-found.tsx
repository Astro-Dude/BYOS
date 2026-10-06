import Link from "next/link";

import { ModeAvatar } from "@/components/mode-avatar";

/** Any URL that isn't a page: Bookish Bao, searching the shelves for it. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 py-16 text-center">
      <ModeAvatar mode="read_only" live aura className="h-32 w-32 sm:h-40 sm:w-40" />
      <p className="type-label mt-6">404</p>
      <h1 className="type-heading mt-2 max-w-xl text-balance">
        Bao looked on every shelf. This page <span className="type-em">isn&apos;t</span> here.
      </h1>
      <p className="mt-4 max-w-md text-[0.9375rem] leading-[1.5] text-zinc-500">
        The link may be old, or the file or folder it pointed to was unshared.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard" className="pill-filled">
          Go to your drive
        </Link>
        <Link href="/" className="pill-ghost">
          Home
        </Link>
      </div>
    </main>
  );
}
