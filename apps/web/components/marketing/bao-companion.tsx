"use client";

import type { AgentMode } from "@byos/api-client";
import { Check, FileText, Folder, KeyRound, Link2, Lock } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";

import { ModeAvatar } from "@/components/mode-avatar";

/** The four Baos roaming the landing page, each about his own job.
 *
 *  Every Bao walks to a random spot on the screen, works there for a few
 *  seconds (a speech bubble says what he's doing), then wanders off to the
 *  next. Each walks at his own pace: Bookish strolls, Busy hurries. A real
 *  scroll sends them all off to new spots, so the crew keeps moving with you.
 *
 *  A fixed layer over the page with pointer events off, so they never get in
 *  the way of a click. The button at the bottom right jails them: they march
 *  into a cell there and rattle the bars, hop and plead until someone frees
 *  them. Every visit starts with them free. Under reduced motion they stand
 *  still where they start. Hidden on phones, where there's no room to roam. */

type Job = {
  mode: AgentMode;
  /** Pixels per second when walking. */
  speed: number;
  /** How long he works at each stop, ms. */
  work: number;
  lines: string[];
};

const CREW: Job[] = [
  {
    mode: "read_only",
    speed: 70,
    work: 4200,
    lines: [
      "Reading Blender_Warranty.pdf…",
      "Covered until March 2027",
      "Looking for the Wi-Fi password…",
      "Found it: welcome guide, page 2",
      "Checking which Lisbon trip you mean…",
    ],
  },
  {
    mode: "ask",
    speed: 105,
    work: 3800,
    lines: [
      "Plan ready: 9 moves for Recipes. Approve?",
      "Approved, thank you",
      "Sorting the Lisbon photos…",
      "3 new folders. Have a look?",
    ],
  },
  {
    mode: "auto",
    speed: 170,
    work: 2800,
    lines: [
      "IMG_4410.jpg → Trips/Lisbon/Tram 28.jpg",
      "untitled (2).docx → Recipes/Banana bread.docx",
      "Screenshot 14.png → Receipts/Laptop stand.png",
      "logo_final_v3.psd → Studio Nova/Logo v3.psd",
    ],
  },
  {
    mode: "full",
    speed: 130,
    work: 3200,
    lines: [
      "Published byos.app/a/portfolio",
      "Share link: expires in 7 days",
      "Removed a duplicate photo",
      "Done. All 18 changes applied",
    ],
  },
];

const SIZE = 56;

type Spot = { x: number; y: number };

type Phase = "free" | "jailed";

/** What a jailed Bao says, one at a time over the cell. */
const PLEAS = [
  "Let us out! We had files to sort!",
  "I didn't even rename anything!",
  "Bail is one click. Just saying.",
  "Who's going to file the receipts now?",
  "I was THIS close to finishing Recipes.",
  "We'll be quiet. Mostly.",
];

export function BaoCompanion() {
  const [phase, setPhase] = useState<Phase>("free");
  const [still, setStill] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Where each Bao stands in the cell: they walk there when jailed, and
  // burst out from there when freed.
  const [cellSpots, setCellSpots] = useState<Spot[] | null>(null);
  // Which Baos have reached the cell; the rest are still on their way.
  const [inside, setInside] = useState<boolean[]>(() => CREW.map(() => false));
  const cellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setMounted(true);
  }, []);

  const spotsInCell = (): Spot[] => {
    const r = cellRef.current?.getBoundingClientRect();
    if (!r) return CREW.map(() => randomSpot());
    const gap = (r.width - 16 - SIZE) / (CREW.length - 1);
    return CREW.map((_, i) => ({ x: r.left + 8 + i * gap, y: r.top + r.height - SIZE - 6 }));
  };

  // Locked at once: the cell builds itself while they're rounded up, and each
  // Bao is inside the moment he gets there.
  const jail = () => {
    setPhase("jailed");
    setInside(CREW.map(() => still));
    requestAnimationFrame(() => setCellSpots(spotsInCell()));
  };
  const free = () => {
    setCellSpots(spotsInCell());
    setInside(CREW.map(() => false));
    setPhase("free");
  };
  const arrived = (i: number) => setInside((cur) => cur.map((v, j) => (j === i ? true : v)));

  if (!mounted) return null;
  const jailed = phase === "jailed";
  return (
    <div className="pointer-events-none fixed inset-0 z-40 hidden overflow-hidden sm:block" aria-hidden>
      {CREW.map((job, i) =>
        jailed && inside[i] ? null : (
          <Roamer
            key={job.mode}
            job={job}
            index={i}
            still={still}
            from={jailed ? undefined : cellSpots?.[i]}
            to={jailed ? cellSpots?.[i] : undefined}
            onArrive={() => arrived(i)}
          />
        ),
      )}

      <div className="pointer-events-auto absolute bottom-6 right-6 flex flex-col items-end gap-3">
        {jailed ? <Cell ref={cellRef} inside={inside} still={still} /> : null}
        <button
          type="button"
          onClick={jailed ? free : jail}
          className={`flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-[0.875rem] font-medium shadow-[var(--shadow-popover)] transition ${
            jailed
              ? "bg-zinc-900 text-[rgb(var(--c-paper))] hover:bg-zinc-800"
              : "border border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400"
          }`}
          title={jailed ? "Let the Baos out" : "Lock the Baos up"}
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--c-caution-50))] ring-1 ring-[rgb(var(--c-caution-300))]">
            <ModeAvatar mode={jailed ? "auto" : "full"} className="h-7 w-7" />
          </span>
          {jailed ? (
            <>
              <KeyRound className="h-4 w-4" /> Free the Baos
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" /> Jail the Baos
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** The cell at the bottom right: it builds itself (frame, then the bars drop
 *  in one by one) while the Baos are rounded up, and each takes his place as
 *  he arrives. Inside they very much want out, each in his own way. */
const Cell = forwardRef<HTMLDivElement, { inside: boolean[]; still: boolean }>(function Cell(
  { inside, still },
  ref,
) {
  const [plea, setPlea] = useState(0);
  const anyone = inside.some(Boolean);
  useEffect(() => {
    if (!anyone || still) return;
    const id = window.setInterval(() => setPlea((n) => n + 1), 2600);
    return () => window.clearInterval(id);
  }, [anyone, still]);

  return (
    <div className="relative">
      {anyone ? (
        <div className="absolute bottom-full right-0 mb-2 w-max max-w-[16rem]">
          <div
            key={plea}
            className="bao-bubble rounded-2xl border border-zinc-200 bg-white px-3 py-1.5 text-[0.75rem] leading-snug text-zinc-800 shadow-[var(--shadow-popover)]"
          >
            {PLEAS[plea % PLEAS.length]}
          </div>
        </div>
      ) : null}
      <div
        ref={ref}
        className="jail-cell relative h-[5.5rem] w-[17rem] overflow-hidden rounded-2xl border-2 border-zinc-800 bg-zinc-100 shadow-[var(--shadow-popover)]"
      >
        {/* The inmates, each in his own spot; empty until he arrives. */}
        <div className="absolute inset-x-2 bottom-1.5 flex items-end justify-between">
          {CREW.map((job, i) => (
            <div key={job.mode} className="h-14 w-14">
              {inside[i] ? (
                <div className="jail-in">
                  <div className={`jail-bao jail-bao-${i}`}>
                    <ModeAvatar mode={job.mode} live className="h-14 w-14" />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {/* The bars, in front of them, rattling now and then once anyone's in. */}
        <div className={`absolute inset-0 flex justify-evenly ${anyone ? "jail-bars" : ""}`}>
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className="jail-bar h-full w-[3px] rounded-full bg-zinc-800/85"
              style={{ animationDelay: `${120 + i * 45}ms` }}
            />
          ))}
        </div>
        <span className="absolute inset-x-0 top-0 h-1.5 bg-zinc-800" />
        <span className="jail-plaque absolute left-1/2 top-0 -translate-x-1/2 rounded-b-md bg-zinc-800 px-2 pb-0.5 text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--c-paper))]">
          Bao jail
        </span>
      </div>
    </div>
  );
});

/** A random spot, kept clear of the very edges and the top bar. */
function randomSpot(): Spot {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: 16 + Math.random() * Math.max(1, w - SIZE - 260),
    y: 90 + Math.random() * Math.max(1, h - SIZE - 150),
  };
}

function Roamer({
  job,
  index,
  still,
  from,
  to,
  onArrive,
}: {
  job: Job;
  index: number;
  still: boolean;
  /** Start here (the cell, when just freed) and dash off straight away. */
  from?: Spot;
  /** Being jailed: walk here and stop wandering. */
  to?: Spot;
  /** Got to `to`: he's in the cell now. */
  onArrive?: () => void;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [walkMs, setWalkMs] = useState(0);
  const [walking, setWalking] = useState(false);
  const [facingLeft, setFacingLeft] = useState(false);
  const [line, setLine] = useState(0);
  const at = useRef<Spot | null>(null);
  const timer = useRef(0);
  const goRef = useRef<(to: Spot) => void>(() => undefined);
  const caught = useRef(false);
  const fromRef = useRef(from);
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;

  useEffect(() => {
    const start = fromRef.current ?? randomSpot(); // somewhere new on every load
    at.current = start;
    setSpot(start);
    if (still) return;

    const go = (to: Spot) => {
      const from = at.current ?? to;
      // Caught, they hurry: everyone's in the cell within the lock-up time.
      const speed = caught.current ? 1400 : job.speed;
      const ms = Math.max(600, (Math.hypot(to.x - from.x, to.y - from.y) / speed) * 1000);
      setFacingLeft(to.x < from.x);
      setWalkMs(ms);
      setWalking(true);
      setSpot(to);
      at.current = to;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setWalking(false);
        if (caught.current) {
          onArriveRef.current?.(); // in the cell now: no more wandering
          return;
        }
        setLine((n) => n + 1);
        // Work here a while, then wander on.
        timer.current = window.setTimeout(() => go(randomSpot()), job.work + Math.random() * 1500);
      }, ms);
    };
    goRef.current = go;

    // Stagger the first walk so they don't all set off at once; freed from the
    // cell, they all dash out at once.
    timer.current = window.setTimeout(
      () => go(randomSpot()),
      fromRef.current ? 60 + index * 120 : 500 + index * 700,
    );

    // A real scroll sends everyone off somewhere new.
    let last = window.scrollY;
    const onScroll = () => {
      if (caught.current || Math.abs(window.scrollY - last) < 240) return;
      last = window.scrollY;
      go(randomSpot());
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("scroll", onScroll);
    };
  }, [index, job, still]);

  // Jailed: hurry into the cell. Freed on the way: back to work.
  useEffect(() => {
    if (to) {
      caught.current = true;
      goRef.current(to);
    } else if (caught.current) {
      caught.current = false;
      goRef.current(randomSpot());
    }
  }, [to]);

  if (!spot) return null;
  const text = job.lines[line % job.lines.length]!;
  return (
    <div
      className="absolute left-0 top-0"
      style={{
        transform: `translate(${spot.x}px, ${spot.y}px)`,
        transition: walkMs ? `transform ${walkMs}ms linear` : undefined,
      }}
    >
      <div className="relative">
        {!walking && !to ? (
          <div className="absolute bottom-full left-0 mb-1 w-max max-w-[16rem]">
            <div
              key={line}
              className="bao-bubble flex items-center gap-1.5 rounded-2xl border border-zinc-200 bg-white px-2.5 py-1 text-[0.6875rem] leading-snug text-zinc-800 shadow-[var(--shadow-popover)]"
            >
              <Prop mode={job.mode} done={line % 2 === 1} />
              {text}
            </div>
          </div>
        ) : null}
        <div style={{ transform: facingLeft ? "scaleX(-1)" : undefined }}>
          <div className={walking ? "bao-walking" : "bao-working"}>
            <ModeAvatar mode={job.mode} live className="h-14 w-14" />
          </div>
        </div>
        {/* Busy carries a file over his head while he walks. */}
        {walking && job.mode === "auto" ? (
          <span className="bao-carry absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[0.625rem] text-zinc-700 shadow-sm">
            <FileText className="h-2.5 w-2.5" /> file
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The small icon at the start of each Bao's bubble. */
function Prop({ mode, done }: { mode: AgentMode; done: boolean }) {
  const cls = "h-3 w-3 shrink-0";
  if (mode === "read_only") return <FileText className={`${cls} text-zinc-500`} />;
  if (mode === "ask")
    return done ? (
      <Check className={`${cls} text-[rgb(var(--c-go-500))]`} />
    ) : (
      <FileText className={`${cls} text-zinc-500`} />
    );
  if (mode === "auto") return <Folder className={`${cls} text-[rgb(var(--c-caution-500))]`} />;
  return <Link2 className={`${cls} text-[rgb(var(--c-danger-500))]`} />;
}
