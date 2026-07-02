import Link from "next/link";

import { Logo } from "@/components/logo";
import { RedirectIfAuthed } from "@/components/redirect-if-authed";

const features = [
  ["Bring your own storage", "Your files stay in your Telegram, Drive, S3 — BYOS never holds the bytes."],
  ["Permanent dynamic aliases", "Share /resume once. Replace the file forever. The link never changes."],
  ["Instant search", "Browse, filter, and search across every provider without ever calling them."],
  ["Versioning & sharing", "Unlimited versions, restore anytime, and links with passwords, expiry, and limits."],
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <RedirectIfAuthed />
      <header className="flex items-center justify-between py-6">
        <Logo markClassName="h-7 w-7" wordClassName="text-lg" />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-zinc-600 hover:text-zinc-900">
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="flex flex-1 flex-col justify-center py-16">
        <p className="text-sm font-medium uppercase tracking-wider text-indigo-600">
          Bring Your Own Storage
        </p>
        <h1 className="mt-3 max-w-3xl text-5xl font-bold tracking-tight text-zinc-900">
          The operating system for your personal cloud storage.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-zinc-600">
          You already own storage. BYOS adds the layer on top — organization, search, preview,
          versioning, sharing, and permanent links — without locking you into any single provider.
        </p>
        <div className="mt-8 flex gap-4">
          <Link
            href="/register"
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Log in
          </Link>
        </div>

        <dl className="mt-20 grid grid-cols-1 gap-8 sm:grid-cols-2">
          {features.map(([title, body]) => (
            <div key={title}>
              <dt className="font-semibold text-zinc-900">{title}</dt>
              <dd className="mt-1 text-sm text-zinc-600">{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="border-t border-zinc-100 py-6 text-sm text-zinc-400">
        BYOS — storage providers store bytes; BYOS provides the experience.
      </footer>
    </main>
  );
}
