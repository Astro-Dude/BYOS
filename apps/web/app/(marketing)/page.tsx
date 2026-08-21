import {
  ArrowRight,
  Eye,
  KeyRound,
  ScanText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wand2,
} from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import {
  AliasArtifact,
  ComposerArtifact,
  DriveArtifact,
  IndexingArtifact,
  StatArtifact,
} from "@/components/marketing/artifacts";
import { RedirectIfAuthed } from "@/components/redirect-if-authed";
import { Reveal } from "@/components/reveal";

const PILLARS = [
  {
    label: "Storage",
    title: "Your bytes never move",
    body: "Files stay in the Telegram account you already own. BYOS holds the metadata — the index, the folder tree, the versions, the links — and nothing else. Close your account and your files are still exactly where they were.",
  },
  {
    label: "Structure",
    title: "A real filesystem on top",
    body: "Nested folders, duplicate detection, unlimited versions with restore, favourites, tags, and full-text search across everything — all resolved from the database, so browsing never waits on a provider.",
  },
  {
    label: "Sharing",
    title: "Links you can govern",
    body: "Password-protected, expiring, download-limited, view-only. Revoke any link without touching the file, and see exactly what was opened and when.",
  },
];

const BYOK = [
  {
    icon: KeyRound,
    title: "Your key, your model",
    body: "Any OpenAI-compatible endpoint — OpenAI, OpenRouter, Gemini, Groq, Together, or something you host. Save several, switch per conversation. Keys are Fernet-encrypted at rest and only ever used for your requests.",
  },
  {
    icon: Sparkles,
    title: "Ask across every file",
    body: "Index once and ask questions of the whole drive. Answers cite the documents they came from, and one click opens the source beside the reply.",
  },
  {
    icon: ScanText,
    title: "Reads scans and photos",
    body: "A scanned PDF has no text layer, so it's invisible to search. BYOS renders those pages and transcribes them with your own vision model — only the pages that need it, so a text PDF costs nothing.",
  },
  {
    icon: Terminal,
    title: "Retrieval you control",
    body: "Query rewriting, HyDE, LLM reranking, and corrective retrieval are each a toggle. Long documents chunk and retrieve instead of overflowing the context window.",
  },
];

const MODES = [
  { icon: Eye, name: "Read only", body: "Searches and reads to answer questions. Changes nothing." },
  { icon: ShieldCheck, name: "Ask first", body: "Proposes every change and waits for your confirmation." },
  { icon: Wand2, name: "Auto-organise", body: "Moves, renames, tags and stars on its own. Asks before deleting or sharing." },
  { icon: ShieldAlert, name: "Full access", body: "Applies everything itself, including deletes and public links." },
];

const AGENT_TOOLS = [
  "Create folders",
  "Rename files",
  "Move between folders",
  "Star and unstar",
  "Add and remove tags",
  "Rename and move folders",
  "Find duplicates",
  "Read file contents",
  "Search inside documents",
  "Delete permanently",
  "Create share links",
  "Publish permanent aliases",
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white">
      <RedirectIfAuthed />

      {/* Transparent top bar — no background, no border, no shadow. */}
      <header className="mx-auto flex max-w-page items-center justify-between px-6 py-6">
        <Logo wordClassName="text-xl" />
        <nav className="flex items-center gap-6">
          <Link href="/login" className="link-arrow hidden sm:inline-flex">
            Log in
          </Link>
          <Link href="/register" className="pill-filled">
            Get started
          </Link>
        </nav>
      </header>

      {/* ── Hero: display serif with one italic phrase, pill pair, artifacts ── */}
      <section className="mx-auto max-w-page px-6 pb-20 pt-10 sm:pb-28 sm:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal as="p" animation="steep-rise" className="type-label">
              Bring Your Own Storage
            </Reveal>
            <Reveal as="h1" animation="steep-settle" className="type-display mt-5">
              The layer your storage <span className="type-em">always needed</span>.
            </Reveal>
            <Reveal
              as="p"
              delay={120}
              className="mt-7 max-w-xl text-[1.0625rem] leading-[1.35] text-zinc-600"
            >
              You already pay for storage. BYOS adds everything on top — search, structure,
              versions, permanent links, and an assistant that can actually tidy the place —
              without ever taking custody of your files.
            </Reveal>
            <Reveal delay={220} className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/register" className="pill-filled">
                Create your account
              </Link>
              <Link href="/login" className="pill-ghost">
                Log in
              </Link>
            </Reveal>
            <Reveal delay={320} className="mt-8 flex flex-wrap gap-x-8 gap-y-2">
              {["No card required", "Telegram-only sign-in", "Your keys, your models"].map((t) => (
                <span key={t} className="type-label">
                  {t}
                </span>
              ))}
            </Reveal>
          </div>

          {/* The artifact collage — overlapping fragments at varied offsets. */}
          <div className="relative">
            <Reveal delay={200}>
              <DriveArtifact />
            </Reveal>
            <Reveal delay={380} className="relative z-10 -mt-4 ml-auto w-[78%] sm:-mt-6">
              <AliasArtifact />
            </Reveal>
            <Reveal delay={540} className="relative z-20 -mt-4 w-[62%] sm:-mt-6">
              <IndexingArtifact />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Pillars on a fog band ─────────────────────────────────────────── */}
      <section className="bg-zinc-50 py-20 sm:py-24">
        <div className="mx-auto max-w-page px-6">
          <Reveal as="h2" animation="steep-settle" className="type-heading max-w-2xl">
            Providers store bytes. BYOS provides <span className="type-em">the experience</span>.
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={i * 120} className="surface-card p-8">
                <span className="type-label">{p.label}</span>
                <h3 className="mt-4 text-[1.25rem] font-medium text-zinc-900">{p.title}</h3>
                <p className="mt-3 text-[1rem] leading-[1.5] text-zinc-600">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Aliases: the one peach card on this page ──────────────────────── */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto grid max-w-page items-center gap-10 px-6 lg:grid-cols-2">
          <Reveal className="surface-blush p-10">
            <span className="text-[0.8125rem]">The flagship</span>
            <h2 className="type-heading-sm mt-4 font-display" style={{ color: "#5d2a1a" }}>
              One link, forever. Replace what sits behind it whenever you like.
            </h2>
            <p className="mt-5 text-[1.125rem] leading-[1.4]">
              Send <span className="italic">byos.link/a/resume</span> once. Swap the file next
              month, next year, after a rewrite — the link never changes and nobody needs telling.
              Password it, expire it, cap the downloads, or revoke it outright.
            </p>
            <p className="mt-6 text-[0.875rem]">Permanent dynamic aliases</p>
          </Reveal>
          <Reveal delay={160} className="lg:pl-6">
            <AliasArtifact />
            <p className="mt-8 max-w-md text-[1.0625rem] leading-[1.35] text-zinc-600">
              Every open is recorded, so you can see whether the recruiter actually read it — and
              the file itself never leaves your own storage to make that possible.
            </p>
            <Link href="/register" className="link-arrow mt-6">
              Claim your username <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ── BYOK: every feature ───────────────────────────────────────────── */}
      <section className="bg-zinc-50 py-20 sm:py-24">
        <div className="mx-auto max-w-page px-6">
          <Reveal as="p" className="type-label">
            Bring Your Own Key
          </Reveal>
          <Reveal as="h2" animation="steep-settle" className="type-heading mt-5 max-w-3xl">
            An assistant that reads your drive — and <span className="type-em">reorganises</span> it
            when you let it.
          </Reveal>
          <Reveal as="p" delay={120} className="mt-6 max-w-2xl text-[1.125rem] leading-[1.4] text-zinc-600">
            No bundled model, no usage tier, no prompts leaving for a service you didn&apos;t pick.
            You supply the key; BYOS supplies the tools and the guardrails.
          </Reveal>

          <div className="mt-14 grid items-start gap-10 lg:grid-cols-[1fr_0.85fr]">
            <div className="grid gap-6 sm:grid-cols-2">
              {BYOK.map((f, i) => (
                <Reveal key={f.title} delay={i * 100} className="surface-card p-7">
                  <f.icon className="h-5 w-5 text-zinc-900" />
                  <h3 className="mt-4 text-[1.125rem] font-medium text-zinc-900">{f.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-[1.5] text-zinc-600">{f.body}</p>
                </Reveal>
              ))}
            </div>
            <div className="space-y-6 lg:sticky lg:top-10">
              <Reveal delay={200}>
                <ComposerArtifact />
              </Reveal>
              <Reveal delay={340}>
                <StatArtifact />
              </Reveal>
            </div>
          </div>

          {/* Permission modes */}
          <Reveal as="h3" className="type-heading-sm mt-24">
            You decide how much it may do <span className="type-em">unattended</span>.
          </Reveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-zinc-200 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((m, i) => (
              <Reveal key={m.name} delay={i * 90} className="bg-white p-7">
                <m.icon className="h-5 w-5 text-zinc-900" />
                <h4 className="mt-4 text-[1.0625rem] font-medium text-zinc-900">{m.name}</h4>
                <p className="mt-2 text-[0.9375rem] leading-[1.5] text-zinc-600">{m.body}</p>
              </Reveal>
            ))}
          </div>
          <Reveal as="p" className="mt-6 max-w-2xl text-[0.9375rem] leading-[1.5] text-zinc-600">
            In the confirming modes nothing touches your drive until you approve it. You get the
            exact list — every rename, every move, every deletion — and apply or discard the batch
            in one click.
          </Reveal>

          {/* Tool inventory */}
          <Reveal as="h3" className="type-heading-sm mt-24">
            Everything it can be asked to do.
          </Reveal>
          <ul className="mt-10 grid gap-x-10 gap-y-px sm:grid-cols-2 lg:grid-cols-3">
            {AGENT_TOOLS.map((t, i) => (
              <Reveal
                as="li"
                key={t}
                delay={i * 40}
                className="flex items-baseline gap-3 border-b border-zinc-200 py-3.5"
              >
                <span className="text-[0.8125rem] text-zinc-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[1rem] text-zinc-900">{t}</span>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Closing ───────────────────────────────────────────────────────── */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-page px-6 text-center">
          <Reveal as="h2" animation="steep-settle" className="type-heading-lg mx-auto max-w-3xl">
            Keep your storage. Get the <span className="type-em">software</span> it deserves.
          </Reveal>
          <Reveal delay={160} className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className="pill-filled">
              Create your account
            </Link>
            <Link href="/login" className="pill-ghost">
              Log in
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="mx-auto max-w-page px-6 pb-14">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-t border-zinc-200 pt-8">
          <Logo wordClassName="text-lg" />
          <p className="type-label">
            Storage providers store bytes; BYOS provides the experience.
          </p>
        </div>
      </footer>
    </main>
  );
}
