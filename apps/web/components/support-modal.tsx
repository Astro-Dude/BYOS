"use client";

import { Coffee, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Razorpay's button id is a public, client-side identifier — but it lives in an
 *  env var rather than the source so a self-hosted BYOS doesn't ship somebody
 *  else's donate button. Unset means the whole feature stays hidden. */
const BUTTON_ID = process.env.NEXT_PUBLIC_RAZORPAY_BUTTON_ID ?? "";
const SCRIPT_SRC = "https://checkout.razorpay.com/v1/payment-button.js";

/** Shortest time the skeleton stays up. On a warm cache the button can inject in
 *  well under a frame, and a skeleton that appears and vanishes reads as a
 *  glitch — worse than no skeleton. Holding it briefly makes the wait look
 *  deliberate. */
const MIN_SKELETON_MS = 450;

export const supportEnabled = BUTTON_ID.length > 0;

/** "Buy the developer a coffee".
 *
 *  Razorpay ships a <script> that injects its button next to itself, which React
 *  can't do from JSX (scripts in JSX never execute). So the script is created and
 *  appended to a real <form> node in an effect, and the whole thing lives in a
 *  modal — mounting it on demand means the third-party script only loads for
 *  someone who actually opened it.
 */
export function SupportModal({ onClose }: { onClose: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const injected = useRef(false);
  /** Razorpay's script is a third-party fetch plus a render, which routinely
   *  takes a second or two — long enough that an empty box reads as broken. */
  const [status, setStatus] = useState<"loading" | "ready" | "blocked">("loading");

  useEffect(() => {
    const form = formRef.current;
    if (!form || !BUTTON_ID) return;

    // Razorpay inserts the button as a sibling of the script tag, so any
    // non-script child means it has arrived.
    const arrived = () => !!form.querySelector(":scope > *:not(script)");

    // React StrictMode runs effects twice in development. The guard below stops
    // the script being injected twice — but the observer and timer must be
    // re-registered on every pass, because the first pass's cleanup tore them
    // down. Getting that wrong left nothing watching and the skeleton spun
    // forever.
    if (arrived()) {
      // Already injected — StrictMode's second pass, most likely.
      setStatus("ready");
      return;
    }

    const openedAt = Date.now();
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    /** Flip to ready, but never sooner than MIN_SKELETON_MS after opening. */
    const showButton = () => {
      const elapsed = Date.now() - openedAt;
      if (elapsed >= MIN_SKELETON_MS) setStatus("ready");
      else holdTimer = setTimeout(() => setStatus("ready"), MIN_SKELETON_MS - elapsed);
    };

    const observer = new MutationObserver(() => {
      if (arrived()) {
        showButton();
        observer.disconnect();
      }
    });
    observer.observe(form, { childList: true, subtree: true });

    if (!injected.current) {
      injected.current = true;
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      // setAttribute, not dataset: the attribute name has underscores, and this
      // leaves no doubt about what lands in the DOM.
      script.setAttribute("data-payment_button_id", BUTTON_ID);
      script.onerror = () => setStatus("blocked");
      form.appendChild(script);
    }

    // Last word on the outcome: whatever the observer did or didn't see, decide
    // from the DOM. Content blockers routinely block payment hosts, and the form
    // must never be left hidden behind a skeleton that never resolves.
    const timer = setTimeout(() => setStatus(arrived() ? "ready" : "blocked"), 8000);

    return () => {
      clearTimeout(timer);
      clearTimeout(holdTimer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-scrim z-[130]"
      onClick={onClose}
    >
      <div
        className="modal-surface max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-peach text-sienna">
            <Coffee className="h-[1.125rem] w-[1.125rem]" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="type-heading-sm">
              Buy the developer a <span className="type-em">coffee</span>
            </h3>
            <p className="mt-3 text-[1.0625rem] leading-[1.35] text-zinc-600">
              BYOS is free and runs on storage you already own. If it&apos;s useful to you, a
              small tip helps cover the hosting.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative mt-6 flex min-h-[3.25rem] items-center justify-center">
          {/* Razorpay renders its button inside this form. The form is never
              hidden: the skeleton sits *behind* it, so if detection ever misses
              the injection the button is still visible rather than invisible. */}
          <form ref={formRef} className="relative z-10" />

          {status === "loading" ? (
            <div aria-hidden className="absolute inset-0 z-0 flex items-center justify-center">
              <span className="byok-shimmer h-11 w-48 rounded-full" />
            </div>
          ) : null}
          {status === "loading" ? (
            <span className="sr-only" role="status">
              Loading the payment button…
            </span>
          ) : null}

          {status === "blocked" ? (
            <p className="text-center text-[0.8125rem] leading-[1.5] text-zinc-500">
              The payment button couldn&apos;t load — a content blocker or extension is likely
              blocking <span className="font-mono">checkout.razorpay.com</span>. Allow it and
              reopen this, or reach out directly.
            </p>
          ) : null}
        </div>

        <p className="mt-4 flex items-center justify-center gap-1 text-[0.7rem] text-zinc-400">
          Payment handled by Razorpay
          <ExternalLink className="h-3 w-3" />
        </p>
      </div>
    </div>
  );
}
