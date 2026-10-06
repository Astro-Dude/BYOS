"use client";

import type { AgentMode } from "@byos/api-client";
import { useId } from "react";

/** Bao, the agent: a panda in the theme's ink and paper, dressed for each
 *  permission mode (names in lib/avatars.ts).
 *
 *  Bao never changes. Only the kit does, and it escalates with what the mode
 *  may do, with bamboo worked into each:
 *  - Bookish Bao (read only): glasses and a book with a bamboo bookmark.
 *  - Butler Bao (ask first): a bow tie, a bamboo clipboard, a paw up. Asks.
 *  - Busy Bao (auto-organise): a headband and a bamboo broom, files circling.
 *  - Boss Bao (full access): a crown, a cape and a bamboo sword.
 *
 *  The head pieces tell them apart at menu size; the scenery around them
 *  (glow, bubble, orbiting files, rings) fills in when it's shown large
 *  (`aura`). Motion runs when `live`, or while a surrounding `.group` is
 *  hovered, and never under reduced motion. Loops live in globals.css (`av-`). */

// Fixed colours, not theme tokens: Bao is a black-and-white panda in dark
// mode too (an ink token would turn his patches off-white).
const INK = "rgb(23 25 28)";
const PAPER = "rgb(255 255 255)";
const SIENNA = "rgb(93 42 26)";
const PEACH = "rgb(224 166 129)";
const FUR_LIGHT = "rgb(255 255 255)";
const FUR = "rgb(230 228 226)";
const GOLD = "rgb(246 196 92)";
const BAMBOO = "rgb(138 168 102)";
const BAMBOO_LIGHT = "rgb(196 214 160)";
const BAMBOO_DARK = "rgb(88 118 66)";
const BAND = "rgb(var(--c-danger-700))";
const BRICK = "rgb(var(--c-danger-500))";
const BRICK_DEEP = "rgb(var(--c-danger-700))";

const GLOW: Record<AgentMode, string> = {
  read_only: "var(--c-400)",
  ask: "var(--c-go-300)",
  auto: "var(--c-caution-300)",
  full: "var(--c-danger-500)",
};

const HEAD = "M32 16 C44 16 51 23 51 31.5 C51 40 43 46 32 46 C21 46 13 40 13 31.5 C13 23 20 16 32 16 Z";

const outline = { strokeWidth: 1.2, strokeLinejoin: "round" } as const;
const arm = { fill: "none", strokeWidth: 5.2, strokeLinecap: "round", style: { stroke: INK } } as const;
const line = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function ModeAvatar({
  mode,
  live = false,
  aura = false,
  className = "h-5 w-5",
}: {
  mode: AgentMode;
  /** Keep moving. Otherwise still, apart from while a parent `.group` is hovered. */
  live?: boolean;
  /** A soft glow, a ground shadow and the scenery, for when it's shown large. */
  aura?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const fur = `av-fur-${uid}`;
  const glow = `av-glow-${uid}`;
  const clip = `av-clip-${uid}`;
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      data-live={live || undefined}
      className={`av av-${mode} shrink-0 overflow-visible ${className}`}
    >
      <defs>
        <radialGradient id={fur} cx="0.38" cy="0.28" r="0.85">
          <stop offset="0%" style={{ stopColor: FUR_LIGHT }} />
          <stop offset="100%" style={{ stopColor: FUR }} />
        </radialGradient>
        <clipPath id={clip}>
          <path d={HEAD} />
        </clipPath>
        {aura && (
          <radialGradient id={glow}>
            <stop offset="0%" style={{ stopColor: `rgb(${GLOW[mode]})`, stopOpacity: 0.55 }} />
            <stop offset="100%" style={{ stopColor: `rgb(${GLOW[mode]})`, stopOpacity: 0 }} />
          </radialGradient>
        )}
      </defs>

      {aura && <circle className="av-aura" cx="32" cy="36" r="31" fill={`url(#${glow})`} />}
      {aura && mode === "full" && (
        <circle
          className="av-ring"
          cx="32"
          cy="36"
          r="24"
          fill="none"
          strokeWidth="1"
          style={{ stroke: BRICK }}
        />
      )}
      {aura && mode === "auto" && <Orbit />}
      {aura && (
        <ellipse className="av-shadow" cx="32" cy="63" rx="15" ry="2" style={{ fill: INK, opacity: 0.12 }} />
      )}

      <g className="av-float">
        {mode === "full" && <Cape />}
        <Panda fur={`url(#${fur})`} />
        {mode === "read_only" && <Bookish />}
        {mode === "ask" && <Butler aura={aura} />}
        {mode === "auto" && <Busy clip={clip} />}
        {mode === "full" && <Boss />}
      </g>
    </svg>
  );
}

/** Bao, the same in every outfit. Arms belong to the outfits, since each holds
 *  something different. */
function Panda({ fur }: { fur: string }) {
  return (
    <g>
      {/* Ears */}
      <g className="av-ears">
        <circle cx="17" cy="19.5" r="5.6" style={{ fill: INK }} />
        <circle cx="47" cy="19.5" r="5.6" style={{ fill: INK }} />
      </g>
      {/* Body, sitting, feet forward with pink pads */}
      <ellipse cx="32" cy="52" rx="12" ry="9" {...outline} style={{ fill: fur, stroke: INK }} />
      <ellipse cx="24" cy="59.5" rx="5" ry="3.2" style={{ fill: INK }} />
      <ellipse cx="40" cy="59.5" rx="5" ry="3.2" style={{ fill: INK }} />
      <circle cx="24" cy="59.3" r="1.5" style={{ fill: PEACH }} />
      <circle cx="40" cy="59.3" r="1.5" style={{ fill: PEACH }} />
      {/* Head */}
      <path d={HEAD} {...outline} style={{ fill: fur, stroke: INK }} />
      {/* Eye patches, tilted the panda way */}
      <ellipse cx="24.5" cy="31" rx="4.6" ry="5.8" transform="rotate(28 24.5 31)" style={{ fill: INK }} />
      <ellipse cx="39.5" cy="31" rx="4.6" ry="5.8" transform="rotate(-28 39.5 31)" style={{ fill: INK }} />
      <g className="av-blink">
        <circle cx="25" cy="30.5" r="2.2" style={{ fill: "white" }} />
        <circle cx="39" cy="30.5" r="2.2" style={{ fill: "white" }} />
        <g className="av-look">
          <circle cx="25.3" cy="30.8" r="1.3" style={{ fill: INK }} />
          <circle cx="39.3" cy="30.8" r="1.3" style={{ fill: INK }} />
        </g>
      </g>
      <ellipse cx="19" cy="38.5" rx="2.8" ry="1.7" style={{ fill: PEACH, opacity: 0.6 }} />
      <ellipse cx="45" cy="38.5" rx="2.8" ry="1.7" style={{ fill: PEACH, opacity: 0.6 }} />
      {/* Nose and mouth */}
      <path d="M30.2 36 h3.6 q-0.4 1.9 -1.8 2.3 q-1.4 -0.4 -1.8 -2.3 z" style={{ fill: INK }} />
      <path
        d="M32 38.4 q-1.3 1.7 -2.9 0.7 M32 38.4 q1.3 1.7 2.9 0.7"
        {...line}
        strokeWidth="1.2"
        style={{ stroke: INK }}
      />
    </g>
  );
}

/** A bamboo cane from (x1,y1) to (x2,y2), with node rings along it. */
function Cane({
  x1,
  y1,
  x2,
  y2,
  width = 2.6,
  nodes = 3,
}: Record<"x1" | "y1" | "x2" | "y2", number> & {
  width?: number;
  nodes?: number;
}) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [px, py] = [-(y2 - y1) / len, (x2 - x1) / len];
  const half = width / 2 + 0.4;
  const rings = Array.from({ length: nodes }, (_, i) => {
    const t = (i + 1) / (nodes + 1);
    const [x, y] = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    return `M${x - px * half} ${y - py * half} L${x + px * half} ${y + py * half}`;
  }).join(" ");
  return (
    <g>
      <path
        d={`M${x1} ${y1} L${x2} ${y2}`}
        fill="none"
        strokeWidth={width + 1.4}
        strokeLinecap="round"
        style={{ stroke: BAMBOO_DARK }}
      />
      <path
        d={`M${x1} ${y1} L${x2} ${y2}`}
        fill="none"
        strokeWidth={width}
        strokeLinecap="round"
        style={{ stroke: BAMBOO }}
      />
      <path d={rings} fill="none" strokeWidth="1" strokeLinecap="round" style={{ stroke: BAMBOO_DARK }} />
    </g>
  );
}

function Leaf({ x, y, rotate = 0, size = 1 }: { x: number; y: number; rotate?: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${size})`}>
      <path
        d="M0 0 q4.5 -3 9.5 0 q-5 3 -9.5 0 z"
        strokeWidth="0.8"
        style={{ fill: BAMBOO, stroke: BAMBOO_DARK }}
      />
      <path d="M0.8 0 h7.6" fill="none" strokeWidth="0.6" style={{ stroke: BAMBOO_DARK }} />
    </g>
  );
}

/** Bookish Bao: glasses, a book with a bamboo bookmark, both paws on it. */
function Bookish() {
  return (
    <g>
      <circle cx="24.6" cy="30.8" r="6.2" fill="none" strokeWidth="1.5" style={{ stroke: GOLD }} />
      <circle cx="39.4" cy="30.8" r="6.2" fill="none" strokeWidth="1.5" style={{ stroke: GOLD }} />
      <path d="M30.6 30.4 q1.4 -1.2 2.8 0" {...line} strokeWidth="1.5" style={{ stroke: GOLD }} />
      <g className="av-book">
        <path
          d="M32.5 56 q0.6 2.2 -0.4 4"
          fill="none"
          strokeWidth="1.3"
          strokeLinecap="round"
          style={{ stroke: BAMBOO_DARK }}
        />
        <Leaf x={31.6} y={59.6} rotate={110} size={0.55} />
        <path
          d="M32 48.5 q-5.5 -2.6 -11 -0.6 v7.6 q5.5 -2 11 0.6 z"
          {...outline}
          style={{ fill: PAPER, stroke: SIENNA }}
        />
        <path
          d="M32 48.5 q5.5 -2.6 11 -0.6 v7.6 q-5.5 -2 -11 0.6 z"
          {...outline}
          style={{ fill: PAPER, stroke: SIENNA }}
        />
        <path
          d="M23.5 50.5 q3.5 -1 6.5 0.4 M23.5 53 q3.5 -1 6.5 0.4 M34 50.9 q3 -1.4 6.5 -0.4"
          fill="none"
          strokeWidth="0.8"
          style={{ stroke: INK, opacity: 0.35 }}
        />
      </g>
      <path d="M21.5 46.5 q-3 6 3 8" {...arm} />
      <path d="M42.5 46.5 q3 6 -3 8" {...arm} />
    </g>
  );
}

/** Butler Bao: a bow tie, a bamboo clipboard of proposed changes, a paw up. */
function Butler({ aura }: { aura: boolean }) {
  return (
    <g>
      <path
        d="M32 46.5 l-5 -2.9 v5.8 z M32 46.5 l5 -2.9 v5.8 z"
        {...outline}
        style={{ fill: SIENNA, stroke: SIENNA }}
      />
      <circle cx="32" cy="46.5" r="1.5" style={{ fill: SIENNA }} />
      {/* Bamboo clipboard of changes, ticked off */}
      <rect
        x="3.5"
        y="43.5"
        width="10.5"
        height="13.5"
        rx="1.6"
        {...outline}
        style={{ fill: BAMBOO_LIGHT, stroke: BAMBOO_DARK }}
      />
      <rect x="5" y="45.6" width="7.5" height="9.8" rx="0.6" style={{ fill: PAPER }} />
      <rect x="6.5" y="42.4" width="4.4" height="2.6" rx="0.8" style={{ fill: INK }} />
      <path
        d="M5.9 48.2 l0.9 0.9 l1.6 -1.7 M5.9 52 l0.9 0.9 l1.6 -1.7"
        {...line}
        strokeWidth="0.9"
        style={{ stroke: INK }}
      />
      <path
        d="M9.4 48.4 h2.2 M9.4 52.2 h2.2"
        fill="none"
        strokeWidth="0.8"
        style={{ stroke: INK, opacity: 0.45 }}
      />
      <path d="M21.5 47 q-4 2 -7.5 2.5" {...arm} />
      {/* Paw up: "may I?" */}
      <g className="av-wave">
        <path d="M42.5 47 q6.5 -1.5 8.5 -9.5" {...arm} />
      </g>
      {aura && (
        <g className="av-bubble">
          <rect
            x="50"
            y="4"
            width="13"
            height="11"
            rx="5"
            strokeWidth="1.2"
            style={{ fill: PAPER, stroke: INK }}
          />
          <path
            d="M54.3 8.2 q0.3 -1.8 2.1 -1.8 q1.9 0 1.9 1.7 q0 1.1 -1.1 1.6 q-0.8 0.4 -0.8 1.3"
            {...line}
            strokeWidth="1.2"
            style={{ stroke: INK }}
          />
          <circle cx="56.4" cy="12.6" r="0.7" style={{ fill: INK }} />
        </g>
      )}
    </g>
  );
}

/** Busy Bao: a headband with flapping tails, and a bamboo broom. */
function Busy({ clip }: { clip: string }) {
  return (
    <g>
      <rect x="8" y="20" width="48" height="4.2" clipPath={`url(#${clip})`} style={{ fill: BAND }} />
      <g className="av-tails">
        <path
          d="M49.5 21.5 q5 -1.5 7.5 1.5"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          style={{ stroke: BAND }}
        />
        <path
          d="M49.5 23 q4.5 1.5 5.5 5.5"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          style={{ stroke: BAND }}
        />
      </g>
      <g className="av-sweep">
        <Cane x1={55.5} y1={29} x2={48.5} y2={56} width={2.2} />
        <path d="M44 55 l9 2 l-1.8 5.5 l-9.6 -2.2 z" {...outline} style={{ fill: GOLD, stroke: SIENNA }} />
        <path
          d="M44.5 58.5 l-1 3 M47.5 59 l-1 3 M50.5 59.6 l-0.8 2.8"
          fill="none"
          strokeWidth="0.8"
          style={{ stroke: SIENNA }}
        />
      </g>
      <path d="M42.5 48 q6 -0.5 9.2 -4.5" {...arm} />
      <path d="M21.5 47 q-4 3 -3.5 7.5" {...arm} />
    </g>
  );
}

/** Boss Bao: crown, cape (drawn behind, see Cape) and a raised bamboo sword. */
function Boss() {
  return (
    <g>
      <path
        className="av-crown"
        d="M25 17.5 l1.3 -7 l3.8 3.9 l1.9 -5.2 l1.9 5.2 l3.8 -3.9 l1.3 7 z"
        {...outline}
        style={{ fill: GOLD, stroke: SIENNA }}
      />
      <circle cx="32" cy="14.8" r="0.9" style={{ fill: BRICK }} />
      <circle cx="32" cy="46.5" r="1.9" strokeWidth="0.8" style={{ fill: GOLD, stroke: SIENNA }} />
      <g className="av-sword">
        <Cane x1={47.5} y1={43} x2={55.5} y2={14.5} width={2.8} nodes={2} />
        <Leaf x={54.2} y={22} rotate={-30} size={0.6} />
        <path
          d="M43.6 42.2 L51.4 44.4"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          style={{ stroke: GOLD }}
        />
        <path
          d="M47.3 43.8 L46.3 47.4"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          style={{ stroke: SIENNA }}
        />
      </g>
      <path d="M42.5 48.5 q3 -0.5 4.2 -2" {...arm} />
      <path d="M21.5 46 l-4.5 4 l4 4" {...arm} strokeLinejoin="round" />
    </g>
  );
}

function Cape() {
  return (
    <path
      className="av-cape"
      d="M21 44 C12 50 10 56 11 62 L53 62 C54 56 52 50 43 44 Z"
      {...outline}
      style={{ fill: BRICK, stroke: BRICK_DEEP }}
    />
  );
}

/** Files and a bamboo leaf circling Busy Bao, behind it. Each turns back
 *  against the orbit to stay upright. */
function Orbit() {
  const items: [number, number, "folder" | "sheet" | "leaf"][] = [
    [2, 30, "folder"],
    [58, 24, "sheet"],
    [56, 58, "leaf"],
  ];
  return (
    <g className="av-orbit">
      {items.map(([x, y, kind], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <g className="av-upright">
            {kind === "folder" ? (
              <path
                d="M-5 -3.5 h3.6 l1.4 1.4 h5 v6 h-10 z"
                strokeWidth="1"
                strokeLinejoin="round"
                style={{ fill: "rgb(var(--c-blush))", stroke: SIENNA }}
              />
            ) : kind === "sheet" ? (
              <path
                d="M-3.5 -5 h5 l2 2 v8 h-7 z"
                strokeWidth="1"
                strokeLinejoin="round"
                style={{ fill: PAPER, stroke: INK }}
              />
            ) : (
              <Leaf x={-4.5} y={0} rotate={-20} />
            )}
          </g>
        </g>
      ))}
    </g>
  );
}
