"use client";

import { type AiConversation, type AiKey, type AiPrompt } from "@byos/api-client";
import { ArrowLeft, ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AccountMenu, initialsOf } from "@/components/byok/account-menu";
import { DriveChat } from "@/components/byok/drive-chat";
import { Glow } from "@/components/byok/glow";
import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { settingsHref } from "@/components/settings/sections";
import { IntroSplash } from "@/components/intro-splash";
import { RailToggle, RingButton } from "@/components/ui/rail-toggle";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

export default function ByokPage() {
  const { user, loading } = useAuth();
  const authed = useAuthed();
  const router = useRouter();
  const toast = useToast();

  const [showIntro, setShowIntro] = useState(true);
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<AiConversation | null>(null);
  // Desktop opens with the sidebar pinned; mobile starts closed and opens it as
  // an overlay drawer (Claude-style), so the chat owns the whole small screen.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
  }, []);

  const closeOnMobile = useCallback(() => {
    if (!window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOnMobile();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, closeOnMobile]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const loadVault = useCallback(async () => {
    const [ks, ps] = await authed((t) => Promise.all([api.listAiKeys(t), api.listAiPrompts(t)]));
    setKeys(ks);
    setPrompts(ps);
  }, [authed]);

  const loadConversations = useCallback(async () => {
    const cs = await authed((t) => api.listConversations(t));
    setConversations(cs);
  }, [authed]);

  useEffect(() => {
    if (!user) return;
    loadVault().catch(() => undefined);
    loadConversations().catch(() => undefined);
  }, [user, loadVault, loadConversations]);

  // ChatGPT-style: "New chat" just drops to the home composer; the conversation
  // is created lazily on the first message (DriveChat → onActivate).
  const newChat = () => {
    setActiveId(null);
    closeOnMobile();
  };

  const activateConversation = (c: AiConversation) => {
    setConversations((prev) => [c, ...prev.filter((p) => p.id !== c.id)]);
    setActiveId(c.id);
  };

  const removeConversation = async (id: string) => {
    setConfirmDelete(null);
    try {
      await authed((t) => api.deleteConversation(t, id));
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setActiveId((prev) => (prev === id ? null : prev));
      toast("Chat deleted");
    } catch {
      toast("Couldn't delete chat", "error");
    }
  };

  const saveRename = async (id: string) => {
    const title = renameText.trim();
    setRenamingId(null);
    if (!title) return;
    const updated = await authed((t) => api.renameConversation(t, id, title));
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
  };

  if (loading || !user) return <div className="min-h-screen bg-white" />;

  return (
    <>
      {showIntro ? (
        <IntroSplash
          word="BYOK"
          subtitle="Bring Your Own Key"
          skippable
          grid
          minMs={2400}
          onFinished={() => setShowIntro(false)}
        />
      ) : null}

      {/* overflow-clip (not hidden): a hidden box can still be scrolled by focus()
          or scrollIntoView, which shoved the whole frame up mid-run and left the
          page blank below. A clipped one can't be scrolled at all. */}
      <Glow className="h-[100dvh] overflow-clip bg-white text-zinc-900">
        <div className="relative flex h-[100dvh] overflow-clip">
          {/* Collapsed rail — expand + quick new chat */}
          {!sidebarOpen ? (
            <div className="relative hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-white py-4 md:flex">
              <RailToggle collapsed onToggle={() => setSidebarOpen(true)} />
              <button
                onClick={newChat}
                className="btn-icon-sm"
                title="New chat"
                aria-label="New chat"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                onClick={() => setSidebarOpen(true)}
                className="mt-auto flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-[0.8125rem] text-zinc-900 transition-colors hover:bg-zinc-200"
                title={user.display_name || user.username || "Account"}
                aria-label="Account"
              >
                {initialsOf(user.display_name || user.username || "?")}
              </button>
            </div>
          ) : null}

          {/* Scrim behind the mobile drawer */}
          {sidebarOpen ? (
            <button
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-zinc-900/40 backdrop-blur-[1px] md:hidden"
              aria-label="Close sidebar"
            />
          ) : null}

          {/* Sidebar — overlay drawer on mobile, pinned column on desktop */}
          <aside
            className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] shrink-0 flex-col border-r border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl transition-transform duration-200 ease-out md:relative md:z-auto md:w-72 md:pb-0 md:pt-0 md:shadow-none md:transition-none ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full md:hidden"
            }`}
          >
            <div className="flex items-center gap-2 px-4 py-4">
              <span className="type-heading-sm flex-1">BYOK</span>
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-[0.8125rem] text-zinc-600 transition-colors hover:border-zinc-900 hover:text-zinc-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Drive
              </Link>
              {/* Phones: the drawer's own close, styled like the desktop handle. */}
              <RingButton label="Close sidebar" onClick={() => setSidebarOpen(false)} className="md:hidden">
                <ChevronLeft className="h-4 w-4" />
              </RingButton>
            </div>
            <RailToggle collapsed={false} onToggle={() => setSidebarOpen(false)} />

            <div className="px-3">
              <button
                onClick={newChat}
                className="flex w-full items-center gap-2 rounded-full border border-zinc-200 px-4 py-2.5 text-[0.9375rem] text-zinc-900 transition-colors hover:border-zinc-900"
              >
                <Plus className="h-4 w-4" /> New chat
              </button>
            </div>

            <nav className="thin-scroll mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 rounded-full px-3 py-2 text-[0.9375rem] transition-colors ${
 activeId === c.id
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-100"
                  }`}
                >
                  {renamingId === c.id ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(c.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => void saveRename(c.id)}
                      className="min-w-0 flex-1 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[0.9375rem] text-zinc-900 outline-none focus:border-zinc-900"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setActiveId(c.id);
                          closeOnMobile();
                        }}
                        className="min-w-0 flex-1 truncate py-0.5 text-left"
                      >
                        {c.title}
                      </button>
                      <button
                        onClick={() => {
                          setRenamingId(c.id);
                          setRenameText(c.title);
                        }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 opacity-100 hover:bg-zinc-200/70 hover:text-zinc-800 md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100"
                        aria-label="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(c)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 opacity-100 hover:bg-zinc-200/70 hover:text-red-500 md:h-6 md:w-6 md:opacity-0 md:group-hover:opacity-100"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {conversations.length === 0 ? (
                <p className="px-2 py-4 text-[0.8125rem] text-zinc-400">No conversations yet.</p>
              ) : null}
            </nav>

            <div className="border-t border-zinc-200 p-2">
              <AccountMenu onSettings={() => router.push("/settings/models?from=byok")} />
            </div>
          </aside>

          {/* Main */}
          <main className="flex min-h-0 w-full flex-1 flex-col overflow-clip">
            <DriveChat
              conversationId={activeId}
              onOpenSidebar={() => setSidebarOpen(true)}
              keys={keys}
              prompts={prompts}
              onActivate={activateConversation}
              onActivity={() => void loadConversations()}
              onOpenSettings={(target) => router.push(settingsHref(target))}
              onKeyUpdated={(updated) => setKeys((ks) => ks.map((k) => (k.id === updated.id ? updated : k)))}
              onDiscard={(id) => setConversations((cs) => cs.filter((c) => c.id !== id))}
            />
          </main>
        </div>
      </Glow>

      {confirmDelete ? (
        <ConfirmModal
          title="Delete chat?"
          message={`“${confirmDelete.title}” will be permanently deleted.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void removeConversation(confirmDelete.id)}
        />
      ) : null}
    </>
  );
}
