"use client";

import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { SETTINGS_GROUPS } from "@/components/settings/sections";

export type SettingsOrigin = { href: string; label: string };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const LABELS: Record<string, string> = Object.fromEntries(
  SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

/** Settings' frame. Desktop: a rail of sections beside the open one. Phones:
 *  the way phone apps do it, a list of sections at /settings, and each section
 *  as its own screen with a back button to that list. `active` is null on the
 *  list itself. */
export function SettingsShell({
  active,
  back,
  user,
  children,
}: {
  active: string | null;
  back: SettingsOrigin;
  user: { display_name: string | null; username: string | null };
  children: ReactNode;
}) {
  const name = user.display_name || user.username || "You";
  const [switcher, setSwitcher] = useState(false);
  const pathname = usePathname();
  useEffect(() => setSwitcher(false), [pathname]);
  return (
    <div className="min-h-[100dvh] bg-white text-zinc-900 md:flex">
      {/* Desktop rail */}
      <aside className="thin-scroll sticky top-0 hidden h-[100dvh] w-64 shrink-0 overflow-y-auto border-r border-zinc-200 px-5 py-8 md:block">
        <Link
          href={back.href}
          className="mb-6 inline-flex items-center gap-1.5 text-[0.8125rem] text-zinc-500 hover:text-zinc-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {back.label}
        </Link>
        <p className="type-heading-sm mb-6">Settings</p>
        <nav aria-label="Settings sections" className="flex flex-col gap-5">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="type-label px-3 pb-1">{group.label}</p>
              {group.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/settings/${item.id}`}
                  aria-current={active === item.id ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.9375rem] transition-colors ${
                    active === item.id
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Phones: the list of sections */}
      {active === null ? (
        <div className="px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] md:hidden">
          <Link
            href={back.href}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-[0.8125rem] text-zinc-600 transition-colors hover:border-zinc-900 hover:text-zinc-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {back.label}
          </Link>
          <h1 className="type-heading mt-5">Settings</h1>

          <Link
            href="/settings/profile"
            className="mt-5 flex items-center gap-3 rounded-2xl bg-zinc-100 p-4 transition-colors active:bg-zinc-200"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[0.9375rem] text-white">
              {initialsOf(name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[1rem] text-zinc-900">{name}</span>
              {user.username ? (
                <span className="block truncate text-[0.8125rem] text-zinc-500">@{user.username}</span>
              ) : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
          </Link>

          {SETTINGS_GROUPS.map((group) => (
            <section key={group.label} className="mt-7">
              <h2 className="type-label mb-2 px-1">{group.label}</h2>
              <div className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200">
                {group.items.map((item) => (
                  <Link
                    key={item.id}
                    href={`/settings/${item.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-zinc-50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                      <item.icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-[0.9375rem] text-zinc-900">{item.label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        /* Phones: a section's own top bar, back to the list */
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] backdrop-blur md:hidden">
          <Link
            href="/settings"
            aria-label="All settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-700 transition-colors active:bg-zinc-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          {/* The title switches section, so every section is a tap away. */}
          <button
            type="button"
            onClick={() => setSwitcher(true)}
            aria-haspopup="dialog"
            aria-expanded={switcher}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full py-1.5 pl-1 pr-3 text-left transition-colors active:bg-zinc-100"
          >
            <span className="truncate text-[1.0625rem] text-zinc-900">{LABELS[active] ?? "Settings"}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
          </button>
        </header>
      )}

      {/* Phones: every section in a sheet, opened from the title. */}
      {switcher && active !== null ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Settings sections">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setSwitcher(false)}
            className="absolute inset-0 bg-zinc-900/40"
          />
          <div className="sheet-up thin-scroll absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200" aria-hidden />
            <div className="mb-2 flex items-center justify-between">
              <p className="type-heading-sm">Settings</p>
              <button
                type="button"
                onClick={() => setSwitcher(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 active:bg-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {SETTINGS_GROUPS.map((group) => (
              <section key={group.label} className="mt-4">
                <h2 className="type-label mb-1.5 px-1">{group.label}</h2>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const on = item.id === active;
                    return (
                      <Link
                        key={item.id}
                        href={`/settings/${item.id}`}
                        aria-current={on ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors ${
                          on ? "bg-zinc-900 text-white" : "text-zinc-900 active:bg-zinc-100"
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            on ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          <item.icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1 text-[0.9375rem]">{item.label}</span>
                        {on ? <Check className="h-4 w-4 shrink-0" /> : null}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
            <Link
              href={back.href}
              className="mt-5 flex items-center justify-center gap-1.5 rounded-full border border-zinc-200 py-2.5 text-[0.9375rem] text-zinc-700 active:bg-zinc-50"
            >
              <ArrowLeft className="h-4 w-4" /> {back.label}
            </Link>
          </div>
        </div>
      ) : null}

      <main
        className={`min-w-0 flex-1 px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 md:px-10 md:py-10 lg:px-14 ${
          active === null ? "hidden md:block" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
