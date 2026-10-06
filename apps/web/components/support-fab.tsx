"use client";

import { Coffee } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
 *
 *  The two wisps off the cup are permanent rather than hover-gated — the button
 *  should read as hot whether or not anything is pointing at it.
 *
 *  The floating button only shows from tablet width up, and never in BYOK,
 *  where it would sit on the composer's send button. There, and on phones, the
 *  same dialog opens from a "Buy me a coffee" item in the menus (`openSupport`).
 */
const OPEN_EVENT = "byos:open-support";

/** Open the support dialog from anywhere (a menu item, a sheet). */
export function openSupport() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function SupportFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  if (!supportEnabled) return null;
  const floating = !pathname.startsWith("/byok");

  return (
    <>
      <div className={`group fixed bottom-5 right-5 z-[90] hidden print:hidden ${floating ? "md:block" : ""}`}>
        {/* Blush breath rather than a coloured glow — the accent pair is the only
            warmth the system allows, and it retreats as soon as you engage. */}
        <span
          aria-hidden
          className="byok-halo pointer-events-none absolute inset-0 rounded-full bg-peach blur-md transition-opacity duration-300 group-hover:opacity-0"
        />
        <button
          onClick={() => setOpen(true)}
          aria-label="Buy me a coffee"
          className="relative flex h-12 items-center rounded-full bg-zinc-900 px-4 text-white outline-none transition-all duration-300 ease-out hover:bg-zinc-800 hover:pr-5 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 active:scale-[0.97] group-focus-within:pr-5"
        >
          <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
            <Coffee className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-px" />
            <span aria-hidden className="absolute -top-2 left-1/2 flex -translate-x-1/2 gap-[3px]">
              <span className="byok-steam block h-1.5 w-[2px] rounded-full bg-white/80" />
              <span
                className="byok-steam block h-1.5 w-[2px] rounded-full bg-white/60"
                style={{ animationDelay: "0.55s" }}
              />
            </span>
          </span>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[0.9375rem] font-normal transition-all duration-300 ease-out group-hover:ml-2 group-hover:max-w-[11rem] group-focus-within:ml-2 group-focus-within:max-w-[11rem]">
            Buy me a coffee
          </span>
        </button>
      </div>

      {open ? <SupportModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
