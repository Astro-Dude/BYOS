"use client";

import { ArrowRight, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { savePendingQuestion } from "@/lib/pending-question";

const EXAMPLES: { q: string; a: ReactNode; file: string }[] = [
  {
    q: "When does my blender's warranty end?",
    a: (
      <>
        The <mark>Kitchenware</mark> warranty covers it until 14 March 2027.
      </>
    ),
    file: "Blender_Warranty.pdf",
  },
  {
    q: "What time is my flight to Lisbon?",
    a: (
      <>
        TP 1342 leaves at <mark>06:40</mark> on 12 May. The gate closes at 06:10.
      </>
    ),
    file: "Lisbon_Boarding_Pass.pdf",
  },
  {
    q: "How much flour goes in the banana bread?",
    a: (
      <>
        <mark>250 g</mark> plain flour, plus a teaspoon of baking soda.
      </>
    ),
    file: "Banana_bread.pdf",
  },
  {
    q: "Put every Studio Nova logo draft in one folder",
    a: (
      <>
        Found <mark>14 drafts</mark>. I&apos;ll make “Studio Nova/Logos” and move them there once you confirm.
      </>
    ),
    file: "14 files",
  },
];

/** The landing page's composer, for real: type a question and Enter (or the
 *  arrow) takes you to sign in, with the question waiting in the chat after.
 *  Until you type, it cycles through examples with the answers they'd get. */
export function AskDemo({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [i, setI] = useState(0);
  const example = EXAMPLES[i % EXAMPLES.length]!;
  const typing = value.trim().length > 0;

  // Rotate the examples while the box is idle; hold still once someone's in it.
  useEffect(() => {
    if (focused || typing) return;
    const id = setInterval(() => setI((n) => n + 1), 4500);
    return () => clearInterval(id);
  }, [focused, typing]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    // An empty box asks the example on show, so the arrow always does something.
    savePendingQuestion(value.trim() || example.q);
    router.push(user ? "/byok" : "/login");
  };

  return (
    <div className={`surface-artifact p-3 ${className}`}>
      <form
        onSubmit={submit}
        className={`flex items-center gap-3 rounded-2xl border px-4 py-2.5 transition-colors ${
          focused ? "border-zinc-900" : "border-zinc-200 hover:border-zinc-400"
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={example.q}
          aria-label="Ask your drive a question"
          enterKeyHint="go"
          className="min-w-0 flex-1 bg-transparent py-1 text-[0.9375rem] text-zinc-900 outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          aria-label={user ? "Ask in the chat" : "Sign in to ask"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-transform hover:scale-105 active:scale-95"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      {typing ? null : (
        <div key={i} className="ask-demo-swap">
          <p className="px-2 pt-3 text-[0.9375rem] leading-[1.35] text-zinc-900">{example.a}</p>
          <div className="flex items-center gap-1.5 px-2 pt-2 text-[0.8125rem] text-zinc-500">
            <FileText className="h-3 w-3" /> {example.file}
          </div>
        </div>
      )}
    </div>
  );
}
