import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/** The filled action. Composes `.pill-filled`, so every call site picks up
 *  Steep's pill geometry and any later change to it lands in one place.
 *
 *  Disabled drops to a hairline outline rather than a half-opacity ink fill — a
 *  faded black slab reads as a broken button, not an unavailable one.
 */
export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "pill-filled",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        "disabled:cursor-not-allowed disabled:bg-transparent disabled:text-zinc-400 disabled:ring-1 disabled:ring-inset disabled:ring-zinc-200 disabled:hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}
