"use client";

import { ApiError, type PlatformStats } from "@byos/api-client";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AdminsPanel } from "@/components/admin/admins-panel";
import {
  ArcGauge,
  Bands,
  Lollipop,
  Punchcard,
  RadialClock,
  Ridgeline,
  StackedPill,
  StepArea,
  TagCloud,
  Waffle,
} from "@/components/admin/charts";
import { Reveal } from "@/components/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { formatBytes } from "@/lib/utils";

/** Platform analytics.
 *
 *  The route isn't secret but its data is: the endpoint 404s for non-admins, so
 *  a curious user who types the URL gets the same empty state as a broken link
 *  rather than a "forbidden" that confirms the page exists.
 */
const SECTIONS = [
  { id: "pulse", label: "Pulse" },
  { id: "growth", label: "Growth" },
  { id: "content", label: "What's stored" },
  { id: "sharing", label: "Sharing" },
  { id: "activity", label: "Activity" },
  { id: "accounts", label: "Accounts" },
  { id: "health", label: "Housekeeping" },
  { id: "surface", label: "Platform surface" },
  { id: "admins", label: "Admins" },
];

/** Left rail — anchors with the section you're looking at marked.
 *
 *  Position, not intersection. An observer watching a narrow band works only
 *  while some heading is inside it; here the sections are tall enough that the
 *  band is often empty, which left the rail marking whichever section it saw
 *  last — including "Platform surface" while sitting at the very top. Reading
 *  nine rects per frame is cheap and always right: the active section is simply
 *  the last one whose heading has passed the reading line.
 */
function SectionNav() {
  const [active, setActive] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    let frame = 0;
    const pick = () => {
      frame = 0;
      // A fixed reading line rather than a fraction of the viewport: at 25% of a
      // tall window the line sat below the *next* heading whenever a panel was
      // short, so clicking "Accounts" lit "Housekeeping". 96px clears an anchor
      // jump (which parks a heading at its 24px scroll-margin) without reaching
      // past the shortest panel.
      const line = 96;
      let current = SECTIONS[0]!.id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      // The last section sits too close to the end of the page for its heading
      // ever to reach the reading line, so bottoming out counts as reaching it —
      // otherwise clicking "Admins" marks the section above it.
      const bottomed =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      setActive(bottomed ? SECTIONS.at(-1)!.id : current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <nav className="hidden w-44 shrink-0 xl:block">
      <div className="sticky top-6 space-y-0.5">
        <p className="type-label mb-3 px-3.5">On this page</p>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={active === s.id ? "nav-item-active" : "nav-item"}
          >
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface-card p-5">
      <p className="type-label">{label}</p>
      <p className="mt-2 text-[1.375rem] tabular-nums text-zinc-900">{value}</p>
      {sub ? <p className="type-label mt-1">{sub}</p> : null}
    </div>
  );
}

/** A titled section of the dashboard.
 *
 *  `scroll-mt-6` matters: the nav links are plain anchors, and without it the
 *  heading lands flush against the viewport edge with no breathing room.
 */
function Panel({
  id,
  title,
  hint,
  children,
  delay = 0,
  className = "",
}: {
  id?: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <Reveal delay={delay} className={`surface-card scroll-mt-6 p-6 sm:p-7 ${className}`}>
      <h2 id={id} className="type-heading-sm scroll-mt-6">
        {title}
      </h2>
      {hint ? <p className="mt-2 text-[0.9375rem] text-zinc-600">{hint}</p> : null}
      <div className="mt-6">{children}</div>
    </Reveal>
  );
}

export default function AdminPage() {
  const authed = useAuthed();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  // Same guard as the other app pages: unauthenticated visitors go to login
  // rather than being shown a page that can only fail. Without this the fetch
  // threw 401 and the skeleton never resolved.
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    authed((t) => api.adminOverview(t))
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        // 404 is the deliberate "you're not an admin" response.
        if (!cancelled) setDenied(e instanceof ApiError && e.status === 404);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, authLoading, user]);

  // Blank rather than a skeleton while the session resolves, so a redirect
  // doesn't flash a page the visitor was never going to see.
  if (authLoading || !user) return <div className="min-h-screen bg-white" />;

  if (loading) {
    return (
      <main className="px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-4 h-11 w-72" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-6 h-64 rounded-2xl" />
      </main>
    );
  }

  if (denied || !stats) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
        <h1 className="type-heading">Nothing here.</h1>
        <p className="mt-5 text-[1.0625rem] leading-[1.4] text-zinc-600">
          This page doesn&apos;t exist for your account.
        </p>
        <Link href="/dashboard" className="link-arrow mt-8 justify-center">
          <ArrowLeft className="h-4 w-4" /> Back to Drive
        </Link>
      </main>
    );
  }

  const t = stats.totals;
  const newest = stats.signups.at(-1)?.value ?? 0;
  const uploadedToday = stats.uploads.at(-1)?.value ?? 0;
  const activeToday = stats.active.at(-1)?.value ?? 0;
  const cov = stats.index_coverage;
  const v = stats.versions;

  return (
    <main className="px-4 pb-28 pt-8 sm:px-6 md:pb-16 lg:px-8">
      <Reveal as="div" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="type-label flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" /> Admin
          </p>
          <h1 className="type-heading mt-3">
            The whole <span className="type-em">platform</span>.
          </h1>
        </div>
        <Link href="/dashboard" className="link-arrow">
          <ArrowLeft className="h-4 w-4" /> Back to Drive
        </Link>
      </Reveal>

      <div className="mt-10 flex gap-10">
        <SectionNav />

        <div className="min-w-0 flex-1">
          <Reveal delay={100} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Accounts" value={t.users.toLocaleString()} sub={`${activeToday} active today`} />
            <Stat label="Files" value={t.files.toLocaleString()} sub={`${uploadedToday} added today`} />
            <Stat label="Stored" value={formatBytes(t.bytes)} />
            <Stat
              label="Public links"
              value={(t.aliases + t.shares).toLocaleString()}
              sub={`${t.aliases} alias${t.aliases === 1 ? "" : "es"}, ${t.shares} share${t.shares === 1 ? "" : "s"}`}
            />
          </Reveal>

          {/* `grid-cols-1` is load-bearing, not decoration: without an explicit
              track the single column is sized to its widest item's max-content,
              and the punchcard's 30 marks pushed every card to 499px inside a
              390px phone. Tailwind's column utilities use minmax(0, 1fr). */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            <Panel
              id="pulse"
              className="lg:col-span-2 2xl:col-span-3"
              title="Signups and uploads"
              hint={`Last ${stats.window_days} days. ${newest} signup${newest === 1 ? "" : "s"} and ${uploadedToday} upload${uploadedToday === 1 ? "" : "s"} today.`}
            >
              <Ridgeline
                series={[
                  { label: "Uploads", points: stats.uploads },
                  { label: "Signups", points: stats.signups, accent: true },
                ]}
              />
            </Panel>

            <Panel
              className="lg:col-span-2 2xl:col-span-3"
              title="Who turned up"
              hint="Distinct accounts taking an audited action each day. Area tracks the count; rings are days nobody turned up."
              delay={80}
            >
              <Punchcard points={stats.active} unit="people" />
            </Panel>

            <Panel
              id="growth"
              className="lg:col-span-2 2xl:col-span-3"
              title="Storage under management"
              hint="Cumulative bytes across every account. Stepped, because storage grows when files land — not continuously."
              delay={140}
            >
              <StepArea points={stats.growth} format={formatBytes} />
            </Panel>

            <Panel id="content" title="What they store" hint="Share of all files by extension." delay={80}>
              <Waffle slices={stats.types.map((x) => ({ ext: x.ext, count: x.count }))} />
            </Panel>

            <Panel title="File sizes" hint="Where the mass sits." delay={140}>
              <Bands rows={stats.sizes} />
            </Panel>

            <Panel
              title="Where the bytes live"
              hint="Files by storage provider."
              delay={200}
            >
              {stats.providers.length ? (
                <StackedPill rows={stats.providers.map((p) => ({ label: p.label, count: p.count }))} />
              ) : (
                <p className="type-label">No files yet.</p>
              )}
            </Panel>

            <Panel title="Tags in use" hint="Sized by how many files carry them." delay={260}>
              {stats.tags.length ? (
                <TagCloud rows={stats.tags} />
              ) : (
                <p className="type-label">Nobody has tagged anything.</p>
              )}
            </Panel>

            <Panel
              id="sharing"
              title="How links are guarded"
              hint="Every share link by its strictest setting."
              delay={80}
            >
              {stats.shares_by_kind.length ? (
                <StackedPill rows={stats.shares_by_kind} />
              ) : (
                <p className="type-label">No share links yet.</p>
              )}
            </Panel>

            <Panel title="What aliases point at" hint="Permanent links by target." delay={140}>
              {stats.aliases_by_kind.length ? (
                <StackedPill rows={stats.aliases_by_kind} />
              ) : (
                <p className="type-label">No aliases claimed yet.</p>
              )}
            </Panel>

            <Panel id="activity" title="When people work" hint="Audited actions by hour, UTC." delay={80}>
              <RadialClock points={stats.hours} />
            </Panel>

            <Panel title="What's being done" hint={`Audited actions, last ${stats.window_days} days.`} delay={140}>
              {stats.actions.length ? (
                <Lollipop rows={stats.actions.map((a) => ({ label: a.action, value: a.count }))} />
              ) : (
                <p className="type-label">No audited activity in the window.</p>
              )}
            </Panel>

            <Panel id="accounts" className="lg:col-span-2 2xl:col-span-1" title="Busiest accounts" hint="By bytes stored." delay={80}>
              <Lollipop
                rows={stats.top_users.map((u) => ({
                  label: u.label,
                  value: u.bytes,
                  sub: `${u.files} file${u.files === 1 ? "" : "s"}`,
                }))}
                format={formatBytes}
              />
            </Panel>

            <Panel
              id="health"
              className="lg:col-span-2 2xl:col-span-3"
              title="Housekeeping"
              hint="Search coverage, revision churn, and the space identical copies are wasting."
              delay={80}
            >
              <div className="grid items-center gap-8 sm:grid-cols-2 lg:grid-cols-3">
                <ArcGauge value={cov.indexed} of={cov.files} label="Files indexed for search" />
                <div className="grid gap-4">
                  <Stat
                    label="Revisions"
                    value={v.revisions.toLocaleString()}
                    sub={`across ${v.versioned_files.toLocaleString()} file${v.versioned_files === 1 ? "" : "s"}`}
                  />
                  <Stat label="Versions stored" value={v.total.toLocaleString()} />
                </div>
                <div className="grid gap-4">
                  <Stat
                    label="Duplicate groups"
                    value={stats.duplicates.groups.toLocaleString()}
                    sub="identical content"
                  />
                  <Stat
                    label="Reclaimable"
                    value={formatBytes(stats.duplicates.reclaimable_bytes)}
                    sub="if every copy but one went"
                  />
                </div>
              </div>
            </Panel>

            <Panel id="surface" className="lg:col-span-2 2xl:col-span-3" title="Platform surface" delay={80}>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Folders" value={t.folders.toLocaleString()} />
                <Stat label="API keys" value={t.api_keys.toLocaleString()} />
                <Stat label="Webhooks" value={t.webhooks.toLocaleString()} />
                <Stat label="BYOK keys" value={t.ai_keys.toLocaleString()} />
                <Stat label="Chats" value={t.conversations.toLocaleString()} />
                <Stat label="Indexed chunks" value={t.indexed_chunks.toLocaleString()} />
              </div>
            </Panel>

            <Panel
              id="admins"
              className="lg:col-span-2 2xl:col-span-3"
              title="Who can see this"
              hint="Promote by username or phone. Anyone here sees everything on this page."
              delay={80}
            >
              <AdminsPanel />
            </Panel>
          </div>

          <p className="type-label mt-8">
            Generated {new Date(stats.generated_at).toLocaleString()}
          </p>

          {/* Trailing space so the last sections can actually scroll to the top.
              Without it the page bottoms out early, every one of the short final
              panels shares the same clamped scroll position, and clicking them
              in the rail marks the wrong one. Only needed where the rail is. */}
          <div aria-hidden className="hidden xl:block xl:h-[45vh]" />
        </div>
      </div>
    </main>
  );
}
