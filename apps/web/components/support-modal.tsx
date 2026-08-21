"use client";

import { Coffee, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Razorpay's button id is a public, client-side identifier — but it lives in an
 *  env var rather than the source so a self-hosted BYOS doesn't ship somebody
 *  else's donate button. Unset means the whole feature stays hidden. */
const BUTTON_ID = process.env.NEXT_PUBLIC_RAZORPAY_BUTTON_ID ?? "";
const SCRIPT_SRC = "https://checkout.razorpay.com/v1/payment-button.js";

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
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const form = formRef.current;
    if (!form || injected.current || !BUTTON_ID) return;
    injected.current = true; // StrictMode runs effects twice in development

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    // setAttribute, not dataset: the attribute name has underscores, and this
    // leaves no doubt about what lands in the DOM.
    script.setAttribute("data-payment_button_id", BUTTON_ID);
    script.onerror = () => setBlocked(true);
    form.appendChild(script);

    // Razorpay inserts the button as a sibling of the script. Content blockers
    // routinely block payment hosts, and a silently empty box is worse than
    // saying so.
    const timer = setTimeout(() => {
      if (form.querySelectorAll(":scope > *:not(script)").length === 0) setBlocked(true);
    }, 6000);
    return () => clearTimeout(timer);
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

        <div className="mt-4 flex min-h-[3rem] items-center justify-center">
          {/* Razorpay renders its button inside this form. */}
          <form ref={formRef} />
          {blocked ? (
            <p className="text-center text-[0.8125rem] text-zinc-500">
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
