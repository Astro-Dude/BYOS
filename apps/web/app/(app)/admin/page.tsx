"use client";

import { ApiError, type PlatformStats } from "@byos/api-client";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
import { StorageIcon, providerName } from "@/components/storage-icon";
import { formatBytes } from "@/lib/utils";

/** Platform analytics.
 *
 *  The route isn't secret but its data is: the endpoint 404s for non-admins, so
 *  a curious user who types the URL gets the same empty state as a broken link
 *  rather than a "forbidden" that confirms the page exists.
 */
const SECTIONS = [
  { id: "pulse", label: "Pulse" },
  { id: "adoption", label: "Adoption" },
  { id: "growth", label: "Growth" },
  { id: "content", label: "What's stored" },
  { id: "sharing", label: "Sharing" },
  { id: "activity", label: "Activity" },
  { id: "assistant", label: "Bao" },
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
  // A clicked link wins until the jump settles: near the end of the page a short
  // section can't scroll to the top, so position alone would mark its neighbour.
  const clicked = useRef<{ id: string; until: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    const pick = () => {
      frame = 0;
      if (clicked.current && Date.now() < clicked.current.until) {
        setActive(clicked.current.id);
        return;
      }
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
      const bottomed = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
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
            onClick={() => {
              clicked.current = { id: s.id, until: Date.now() + 900 };
              setActive(s.id);
            }}
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
  const eng = stats.engagement;
  const funnel = stats.funnel ?? [];
  const signedUp = funnel[0]?.count ?? 0;
  const bao = stats.assistant;
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "0%");

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

            {eng ? (
              <Panel
                id="adoption"
                className="lg:col-span-2 2xl:col-span-3"
                title="Who keeps coming back"
                hint="People active in the last day, week and month: an audited action or a question to Bao. Stickiness is the share of the month's people who show up on a given day."
                delay={100}
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Today" value={eng.dau.toLocaleString()} sub="active in the last 24 hours" />
                  <Stat label="This week" value={eng.wau.toLocaleString()} sub="last 7 days" />
                  <Stat label="This month" value={eng.mau.toLocaleString()} sub="last 30 days" />
                  <Stat label="Stickiness" value={pct(eng.dau, eng.mau)} sub="today out of this month" />
                </div>
                {funnel.length ? (
                  <div className="mt-8">
                    <p className="type-label mb-4">How far accounts get</p>
                    <Lollipop
                      rows={funnel.map((f) => ({
                        label: f.label,
                        value: f.count,
                        sub: `${pct(f.count, signedUp)} of signups`,
                      }))}
                    />
                  </div>
                ) : null}
              </Panel>
            ) : null}

            <Panel
              id="growth"
              className="lg:col-span-2 2xl:col-span-3"
              title="Storage under management"
              hint="Total storage across all accounts. It steps up as files are added."
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

            <Panel title="Where the bytes live" hint="Files and storage by provider." delay={200}>
              {stats.providers.length ? (
                <>
                  <StackedPill
                    rows={stats.providers.map((p) => ({ label: providerName(p.label), count: p.count }))}
                  />
                  <div className="mt-5 divide-y divide-zinc-200 border-t border-zinc-200">
                    {stats.providers.map((p) => {
                      const accounts = stats.storage_accounts?.find((a) => a.label === p.label)?.count ?? 0;
                      return (
                        <div key={p.label} className="flex items-center gap-3 py-2.5 text-[0.875rem]">
                          <StorageIcon provider={p.label} className="h-4 w-4 shrink-0 text-zinc-500" />
                          <span className="flex-1 text-zinc-900">{providerName(p.label)}</span>
                          <span className="text-zinc-500">{p.count.toLocaleString()} files</span>
                          <span className="w-20 text-right text-zinc-500">{formatBytes(p.bytes)}</span>
                          <span className="w-28 text-right text-zinc-500">
                            {accounts.toLocaleString()} connected
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="type-label">No files yet.</p>
              )}
            </Panel>

            {stats.storage_status?.length ? (
              <Panel
                title="Storage connections"
                hint="Every connected storage by state. Anything not connected needs its owner to reconnect it in Settings."
                delay={230}
              >
                <StackedPill rows={stats.storage_status.map((r) => ({ label: r.label, count: r.count }))} />
              </Panel>
            ) : null}

            <Panel title="Tags in use" hint="Sized by how many files carry them." delay={260}>
              {stats.tags.length ? (
                <TagCloud rows={stats.tags} />
              ) : (
                <p className="type-label">Nobody has tagged anything.</p>
              )}
            </Panel>

            <Panel
              id="sharing"
              title="How long links last"
              hint="Share links that expire, and ones that stay open."
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

            <Panel
              title="What's being done"
              hint={`Audited actions, last ${stats.window_days} days.`}
              delay={140}
            >
              {stats.actions.length ? (
                <Lollipop rows={stats.actions.map((a) => ({ label: a.action, value: a.count }))} />
              ) : (
                <p className="type-label">No audited activity in the window.</p>
              )}
            </Panel>

            {bao ? (
              <>
                <Panel
                  id="assistant"
                  className="lg:col-span-2 2xl:col-span-3"
                  title="Bao at work"
                  hint={`Questions asked and plans applied each day, last ${stats.window_days} days.`}
                  delay={80}
                >
                  <Ridgeline
                    series={[
                      { label: "Questions", points: bao.questions },
                      { label: "Plans applied", points: bao.plans_applied, accent: true },
                    ]}
                  />
                </Panel>

                <Panel
                  title="What became of the plans"
                  hint="Every plan Bao proposed, by where it ended up, and how the changes in applied plans went."
                  delay={120}
                >
                  {bao.plans_by_status.length ? (
                    <>
                      <StackedPill rows={bao.plans_by_status} />
                      <div className="mt-6 grid items-center gap-6 sm:grid-cols-2">
                        <ArcGauge
                          value={bao.changes.ok}
                          of={bao.changes.ok + bao.changes.failed}
                          label="Changes that worked"
                        />
                        <div className="grid gap-4">
                          <Stat
                            label="Failed"
                            value={bao.changes.failed.toLocaleString()}
                            sub="changes that didn't go through"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="type-label">Bao hasn&apos;t proposed anything yet.</p>
                  )}
                </Panel>

                <Panel
                  title="What Bao changes"
                  hint="Kinds of change in every plan, applied or not."
                  delay={160}
                >
                  {bao.change_kinds.length ? (
                    <Lollipop rows={bao.change_kinds.map((k) => ({ label: k.label, value: k.count }))} />
                  ) : (
                    <p className="type-label">No changes proposed yet.</p>
                  )}
                </Panel>

                <Panel
                  title="Keys people bring"
                  hint="BYOK keys by provider, named from each key's API address, and the models they're set to."
                  delay={200}
                >
                  {bao.providers.length ? (
                    <>
                      <StackedPill rows={bao.providers} />
                      <div className="mt-6">
                        <Lollipop rows={bao.models.map((m) => ({ label: m.label, value: m.count, sub: m.provider }))} />
                      </div>
                    </>
                  ) : (
                    <p className="type-label">Nobody has added a key yet.</p>
                  )}
                </Panel>
              </>
            ) : null}

            <Panel
              id="accounts"
              title="Busiest accounts"
              hint="Top three by bytes stored."
              delay={80}
            >
              <Lollipop
                rows={stats.top_users.slice(0, 3).map((u) => ({
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

          <p className="type-label mt-8">Generated {new Date(stats.generated_at).toLocaleString()}</p>
        </div>
      </div>
    </main>
  );
}
