import type { AgentMode } from "@byos/api-client";

/** Bao, the agent's panda, and who Bao is in each permission mode (drawn by
 *  components/mode-avatar). Kept out of that client component so server pages
 *  can read it too. */
export const AVATARS: Record<AgentMode, { name: string }> = {
  read_only: { name: "Bookish Bao" },
  ask: { name: "Butler Bao" },
  auto: { name: "Busy Bao" },
  full: { name: "Boss Bao" },
};

/** Bao's background per mode: grey, green, yellow, red as the mode may do more,
 *  so a permissive mode shows at a glance. Used by the composer chip and the
 *  landing page. */
export const AVATAR_TINT: Record<AgentMode, string> = {
  read_only: "border-zinc-300 bg-zinc-100 hover:bg-zinc-200/70",
  ask: "border-[rgb(var(--c-go-300))] bg-[rgb(var(--c-go-50))] hover:bg-[rgb(var(--c-go-300)/0.35)]",
  auto: "border-[rgb(var(--c-caution-300))] bg-[rgb(var(--c-caution-50))] hover:bg-[rgb(var(--c-caution-300)/0.35)]",
  full: "border-[rgb(var(--c-danger-300))] bg-[rgb(var(--c-danger-50))] hover:bg-[rgb(var(--c-danger-300)/0.35)]",
};
