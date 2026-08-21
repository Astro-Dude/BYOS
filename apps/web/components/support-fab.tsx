"use client";

import { Coffee } from "lucide-react";
import { useState } from "react";

import { SupportModal, supportEnabled } from "@/components/support-modal";

/** Floating "buy me a coffee" button.
 *
 *  Collapsed it's a plain circle; on hover or keyboard focus it grows sideways to
 *  reveal the label. It's the label's `max-width` that animates — `width: auto`
 *  can't be transitioned, so the text is clipped behind `overflow-hidden` and
 *  released from a max-width of 0.
 *
 *  `group` sits on the wrapper rather than the button so the halo (a sibling of
 *  the button) can react to hover too, and `group-focus-within` covers keyboard
 *  users, for whom hover never fires.
 */
export function SupportFab() {
  const [open, setOpen] = useState(false);

  if (!supportEnabled) return null;

  return (
    <>
      <div className="group fixed bottom-5 right-5 z-[140] print:hidden">
        <span
          aria-hidden
          className="byok-halo pointer-events-none absolute inset-0 rounded-full bg-amber-400/30 blur-md transition-opacity duration-300 group-hover:opacity-0"
        />
        <button
          onClick={() => setOpen(true)}
          aria-label="Buy me a coffee"
          className="relative flex h-12 items-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 px-3.5 text-white shadow-lg shadow-amber-950/25 outline-none transition-all duration-300 ease-out hover:pr-5 hover:shadow-xl hover:shadow-amber-950/40 focus-visible:ring-2 focus-visible:ring-amber-300 active:scale-95 group-focus-within:pr-5"
        >
          <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
            <Coffee className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-px" />
            <span
              aria-hidden
              className="absolute -top-2 left-1/2 flex -translate-x-1/2 gap-[3px] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <span className="byok-steam block h-1.5 w-[2px] rounded-full bg-white/80" />
              <span
                className="byok-steam block h-1.5 w-[2px] rounded-full bg-white/60"
                style={{ animationDelay: "0.55s" }}
              />
            </span>
          </span>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium transition-all duration-300 ease-out group-hover:ml-2 group-hover:max-w-[11rem] group-focus-within:ml-2 group-focus-within:max-w-[11rem]">
            Buy me a coffee
          </span>
        </button>
      </div>

      {open ? <SupportModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
