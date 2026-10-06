import {
  ArrowRight,
  FolderTree,
  KeyRound,
  MessageCircleQuestion,
  ScanText,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { AgentMode } from "@byos/api-client";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { AskDemo } from "@/components/marketing/ask-demo";
import { SwipeRow } from "@/components/marketing/swipe-row";
import { ThemeToggle } from "@/components/theme-toggle";
import { BaoCompanion } from "@/components/marketing/bao-companion";
import { ModeAvatar } from "@/components/mode-avatar";
import { AVATAR_TINT, AVATARS } from "@/lib/avatars";
import {
  AliasArtifact,
  DriveArtifact,
  IndexingArtifact,
  StatArtifact,
  StorageArtifact,
} from "@/components/marketing/artifacts";
import { RedirectIfAuthed } from "@/components/redirect-if-authed";
import { Reveal } from "@/components/reveal";
import { StorageIcon } from "@/components/storage-icon";

// The page uses the screen: fluid up to a very wide cap, with side padding that
// grows with it, rather than a narrow column with empty margins either side.
// Long paragraphs keep their own measure (max-w-xl and friends).
const WRAP = "mx-auto w-full max-w-[112rem] px-6 sm:px-10 xl:px-16";

const PILLARS = [
  {
    label: "Storage",
    title: "Your bytes never move",
    body: "Files stay in storage you already own: your Telegram account, a GitHub repository or an S3 bucket. BYOS only keeps track of names, folders, versions and links. Leave, and your files stay right where they are.",
  },
  {
    label: "Structure",
    title: "A real filesystem on top",
    body: "Nested folders, duplicate detection, unlimited versions, favourites, tags and full-text search. Browsing is instant because it never waits on your storage.",
  },
  {
    label: "Sharing",
    title: "Links you can govern",
    body: "A permanent link that survives every re-upload, or one that runs out after a few days. Revoke any link without touching the file.",
  },
];

const STORAGES = [
  {
    provider: "telegram",
    name: "Telegram",
    tagline: "Free, with no total cap.",
    facts: ["Files up to 2 GB each", "Lives in your own account", "Also how you sign in"],
  },
  {
    provider: "github",
    name: "GitHub",
    tagline: "A private repository you own.",
    facts: [
      "BYOS creates the repo for you",
      "Files up to 2 GB each, kept out of git history",
      "Warns before your token expires",
    ],
  },
  {
    provider: "s3",
    name: "S3",
    tagline: "Any S3-compatible bucket.",
    facts: [
      "AWS S3, Cloudflare R2, Backblaze B2, MinIO",
      "Big files upload in parts",
      "Your region, your bill",
    ],
  },
];

const BYOK = [
  {
    icon: KeyRound,
    title: "Your key, your model",
    body: "Use OpenAI, OpenRouter, Gemini, Groq, Together, or a model you host. Save several and switch any time. Keys are encrypted and only used for your requests.",
  },
  {
    icon: Sparkles,
    title: "Ask across every file",
    body: "Index once and ask questions of the whole drive. Answers cite the documents they came from, and one click opens the source beside the reply.",
  },
  {
    icon: ScanText,
    title: "Reads scans and photos",
    body: "Scanned PDFs have no text, so search can't see them. BYOS reads those pages with your own vision model. Only the pages that need it, so normal PDFs cost nothing.",
  },
  {
    icon: Terminal,
    title: "Retrieval you control",
    body: "Query rewriting, HyDE, LLM reranking, and corrective retrieval are each a toggle. Long documents chunk and retrieve instead of overflowing the context window.",
  },
  {
    icon: FolderTree,
    title: "Organise the whole drive",
    body: "Type /organize, or just say \"tidy my downloads\". Files are grouped by topic and each kind of file gets one naming pattern. Nothing is renamed or deleted unless you say so.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Asks before it guesses",
    body: "The 2025 Lisbon trip or the 2026 one? Your banana bread or your mum's? When a request could mean two things, Bao asks, with the options it actually found.",
  },
];

const MODES: { bot: AgentMode; name: string; body: string }[] = [
  {
    bot: "read_only",
    name: "Read only",
    body: "Answers questions about your files. Never changes or plans anything.",
  },
  {
    bot: "ask",
    name: "Ask first",
    body: "Drafts a plan you see as a diagram, revise in plain words and approve before anything moves.",
  },
  {
    bot: "auto",
    name: "Auto-organise",
    body: "Moves, renames, tags and stars on its own. Asks before deleting or sharing.",
  },
  {
    bot: "full",
    name: "Full access",
    body: "Applies everything itself, including deletes and public links.",
  },
];

const AGENT_TOOLS = [
  "Organise the whole drive",
  "Show the plan as a diagram",
  "Ask you when something's unclear",
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
      {/* Bao walks the bottom of the screen, doing a job for each section. */}
      <BaoCompanion />

      {/* Transparent top bar — no background, no border, no shadow. */}
      <header className={`${WRAP} flex items-center justify-between py-6`}>
        <Logo wordClassName="text-xl" />
        <nav className="flex items-center gap-3 sm:gap-6">
          <ThemeToggle />
          <Link href="/login" className="link-arrow hidden sm:inline-flex">
            Log in
          </Link>
          <Link href="/register" className="pill-filled">
            Get started
          </Link>
        </nav>
      </header>

      {/* ── Hero: display serif with one italic phrase, pill pair, artifacts ── */}
      <section data-bao="hello" className={`${WRAP} pb-20 pt-10 sm:pb-28 sm:pt-16`}>
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
              Keep your files in Telegram, a GitHub repository or an S3 bucket. BYOS adds search, folders,
              versions, permanent links and Bao, an assistant that tidies up on your terms. Your files never
              leave your storage.
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
              {["No card required", "Telegram, GitHub or S3", "Your keys, your models"].map((t) => (
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
      <section data-bao="store" className="bg-zinc-50 py-16 sm:py-24">
        <div className={WRAP}>
          <Reveal as="h2" animation="steep-settle" className="type-heading max-w-2xl">
            Providers store bytes. BYOS provides <span className="type-em">the experience</span>.
          </Reveal>
          <SwipeRow label="What BYOS adds" grid="md:grid-cols-3 md:gap-6" className="mt-10 sm:mt-14">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={i * 120} className="surface-card p-6 sm:p-8">
                <span className="type-label">{p.label}</span>
                <h3 className="mt-4 text-[1.25rem] font-medium text-zinc-900">{p.title}</h3>
                <p className="mt-3 text-[1rem] leading-[1.5] text-zinc-600">{p.body}</p>
              </Reveal>
            ))}
          </SwipeRow>
        </div>
      </section>

      {/* ── Storages: where the bytes can live ───────────────────────────── */}
      <section className="py-16 sm:py-24">
        <div className={`${WRAP} grid items-center gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]`}>
          <div className="min-w-0">
            <Reveal as="p" className="type-label">
              Bring your own storage
            </Reveal>
            <Reveal as="h2" animation="steep-settle" className="type-heading mt-5 max-w-3xl">
              One drive, <span className="type-em">three kinds</span> of storage.
            </Reveal>
            <Reveal as="p" delay={120} className="mt-6 max-w-2xl text-[1.125rem] leading-[1.4] text-zinc-600">
              Connect one or all three. Pick a default, choose another for any upload, and see where every
              file lives. Folders, search and links work the same wherever the bytes are.
            </Reveal>
            <SwipeRow label="Storage options" grid="md:grid-cols-3 md:gap-4" className="mt-10 sm:mt-12">
              {STORAGES.map((st, i) => (
                <Reveal key={st.provider} delay={i * 110} className="surface-card p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white">
                    <StorageIcon provider={st.provider} className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 text-[1.125rem] font-medium text-zinc-900">{st.name}</h3>
                  <p className="mt-1 text-[0.9375rem] text-zinc-600">{st.tagline}</p>
                  <ul className="mt-4 space-y-2 border-t border-zinc-200 pt-4">
                    {st.facts.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2 text-[0.875rem] leading-[1.4] text-zinc-700"
                      >
                        <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </Reveal>
              ))}
            </SwipeRow>
          </div>
          <Reveal delay={240} className="lg:pl-4">
            <StorageArtifact />
            <p className="mt-6 max-w-md text-[1.0625rem] leading-[1.35] text-zinc-600">
              BYOS stores your credentials encrypted and only uses them to move your own files. If one
              expires, it tells you before anything breaks.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Aliases: the one peach card on this page ──────────────────────── */}
      <section data-bao="share" className="bg-zinc-50 py-16 sm:py-24">
        {/* The card is a little narrower than its neighbour and stretches to
            its height, so the two columns end level. */}
        <div className={`${WRAP} grid items-stretch gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]`}>
          <Reveal className="surface-blush flex flex-col p-7 sm:p-10">
            <span className="text-[0.8125rem]">The flagship</span>
            <h2 className="type-heading-sm mt-4 font-display" style={{ color: "var(--ink-on-blush)" }}>
              One link, forever. Replace what sits behind it whenever you like.
            </h2>
            <p className="mt-5 text-[1.125rem] leading-[1.4]">
              Send <span className="italic">byos.link/a/portfolio</span> once. Swap the file whenever you like.
              The link stays the same. Rename it, or revoke it outright.
            </p>
            <p className="mt-6 text-[0.875rem] lg:mt-auto lg:pt-6">Permanent dynamic aliases</p>
          </Reveal>
          <Reveal delay={160} className="lg:pl-6">
            <AliasArtifact />
            <p className="mt-8 max-w-md text-[1.0625rem] leading-[1.35] text-zinc-600">
              Need it only for a while? Send an expiring link instead; it stops working after the days you
              pick. Either way, the file stays in your own storage.
            </p>
            <Link href="/register" className="link-arrow mt-6">
              Claim your username <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ── BYOK: every feature ───────────────────────────────────────────── */}
      <section data-bao="ask" className="py-16 sm:py-24">
        <div className={WRAP}>
          <Reveal as="p" className="type-label">
            Bring Your Own Key
          </Reveal>
          <Reveal as="h2" animation="steep-settle" className="type-heading mt-5 max-w-3xl">
            An assistant that reads your drive and <span className="type-em">reorganises</span> it when you
            let it.
          </Reveal>
          <Reveal as="p" delay={120} className="mt-6 max-w-2xl text-[1.125rem] leading-[1.4] text-zinc-600">
            No bundled model, no usage tier, no prompts leaving for a service you didn&apos;t pick. You supply
            the key; BYOS supplies the tools and the guardrails.
          </Reveal>

          {/* The feature cards (two a row) take the wider side, so six cards stay
              three short rows; the examples beside them ride down the page as it
              scrolls. On phones the live example comes first, then the cards as a
              swipe row. */}
          <div className="mt-10 grid items-start gap-10 sm:mt-14 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:gap-14">
            <SwipeRow label="What the assistant can do" grid="md:grid-cols-2 md:gap-6">
              {BYOK.map((f, i) => (
                <Reveal key={f.title} delay={i * 100} className="surface-card p-6 sm:p-7">
                  <f.icon className="h-5 w-5 text-zinc-900" />
                  <h3 className="mt-4 text-[1.125rem] font-medium text-zinc-900">{f.title}</h3>
                  <p className="mt-2 text-[0.9375rem] leading-[1.5] text-zinc-600">{f.body}</p>
                </Reveal>
              ))}
            </SwipeRow>
            <div className="-order-1 space-y-6 lg:sticky lg:top-24 lg:order-none">
              <Reveal delay={200}>
                <AskDemo />
              </Reveal>
              <Reveal delay={340}>
                <StatArtifact />
              </Reveal>
            </div>
          </div>

          {/* Permission modes */}
          <div data-bao="modes" aria-hidden />
          <Reveal as="h3" className="type-heading-sm mt-16 sm:mt-24">
            You decide how much it may do <span className="type-em">unattended</span>.
          </Reveal>
          <SwipeRow
            label="Permission modes"
            grid="md:grid-cols-2 md:gap-px md:overflow-hidden md:rounded-2xl md:bg-zinc-200 lg:grid-cols-4"
            className="mt-8 sm:mt-10"
          >
            {MODES.map((m, i) => (
              <Reveal
                key={m.name}
                delay={i * 90}
                className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-7 md:rounded-none md:border-0"
              >
                <div
                  className={`flex h-24 w-24 items-center justify-center rounded-full border ${AVATAR_TINT[m.bot]}`}
                >
                  <ModeAvatar mode={m.bot} live aura className="h-20 w-20" />
                </div>
                <h4 className="mt-3 text-[1.0625rem] font-medium text-zinc-900">{m.name}</h4>
                <p className="font-display text-[0.9375rem] italic text-zinc-500">{AVATARS[m.bot].name}</p>
                <p className="mt-2 text-[0.9375rem] leading-[1.5] text-zinc-600">{m.body}</p>
              </Reveal>
            ))}
          </SwipeRow>
          <Reveal as="p" className="mt-6 max-w-2xl text-[0.9375rem] leading-[1.5] text-zinc-600">
            Before anything moves you see your drive as it will look: new folders, where each file lands,
            renames and tags. Ask for changes in plain words and Bao reworks the plan in place. Apply it in
            one click, and if a change doesn&apos;t go through, Bao fixes it.
          </Reveal>

          {/* Tool inventory */}
          <Reveal as="h3" className="type-heading-sm mt-16 sm:mt-24">
            Everything it can be asked to do.
          </Reveal>
          <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-px sm:mt-10 sm:gap-x-10 lg:grid-cols-3 2xl:grid-cols-4">
            {AGENT_TOOLS.map((t, i) => (
              <Reveal
                as="li"
                key={t}
                delay={i * 40}
                className="flex items-baseline gap-2 border-b border-zinc-200 py-3 sm:gap-3 sm:py-3.5"
              >
                <span className="text-[0.75rem] text-zinc-400 sm:text-[0.8125rem]">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[0.875rem] leading-snug text-zinc-900 sm:text-[1rem]">{t}</span>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Closing ───────────────────────────────────────────────────────── */}
      <section data-bao="bye" className="py-20 sm:py-32">
        <div className={`${WRAP} text-center`}>
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

      <footer className={`${WRAP} pb-14`}>
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-t border-zinc-200 pt-8">
          <Logo wordClassName="text-lg" />
          <p className="type-label">Storage providers store bytes; BYOS provides the experience.</p>
        </div>
      </footer>
    </main>
  );
}
