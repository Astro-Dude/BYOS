"use client";

import { type AiConversation, type AiKey, type AiPrompt } from "@byos/api-client";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AccountMenu, initialsOf } from "@/components/byok/account-menu";
import { DriveChat } from "@/components/byok/drive-chat";
import { Glow } from "@/components/byok/glow";
import { SettingsModal } from "@/components/byok/settings-modal";
import { ConfirmModal } from "@/components/dashboard/confirm-modal";
import { IntroSplash } from "@/components/intro-splash";
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
  const [showSettings, setShowSettings] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<AiConversation | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
  const newChat = () => setActiveId(null);

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

  if (loading || !user) return <div className="min-h-screen bg-zinc-950" />;

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

      <Glow className="h-screen bg-zinc-950 text-zinc-100">
        <div className="flex h-screen">
          {/* Collapsed rail — expand + quick new chat */}
          {!sidebarOpen ? (
            <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-zinc-900/95 py-4 backdrop-blur-xl">
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                title="Open sidebar"
                aria-label="Open sidebar"
              >
                <PanelLeftOpen className="h-5 w-5" />
              </button>
              <button
                onClick={newChat}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                title="New chat"
                aria-label="New chat"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                onClick={() => setSidebarOpen(true)}
                className="mt-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-zinc-200 transition hover:bg-white/20"
                title={user.display_name || user.username || "Account"}
                aria-label="Account"
              >
                {initialsOf(user.display_name || user.username || "?")}
              </button>
            </div>
          ) : null}

          {/* Sidebar */}
          <aside
            className={`${sidebarOpen ? "flex w-72" : "hidden"} shrink-0 flex-col border-r border-white/10 bg-zinc-900/95 backdrop-blur-xl`}
          >
            <div className="flex items-center gap-2 px-4 py-4">
              <span className="flex-1 font-brand text-lg font-bold tracking-[0.3em] text-white">
                BYOK
              </span>
              <Link
                href="/dashboard"
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Drive
              </Link>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-zinc-400 transition hover:text-zinc-200"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <div className="px-3">
              <button
                onClick={newChat}
                className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/10"
              >
                <Plus className="h-4 w-4" /> New chat
              </button>
            </div>

            <nav className="thin-scroll mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 rounded-lg px-2 py-2 text-sm ${
                    activeId === c.id ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:bg-white/5"
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
                      className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-sm text-zinc-100 outline-none"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => setActiveId(c.id)}
                        className="min-w-0 flex-1 truncate text-left"
                      >
                        {c.title}
                      </button>
                      <button
                        onClick={() => {
                          setRenamingId(c.id);
                          setRenameText(c.title);
                        }}
                        className="shrink-0 text-zinc-500 opacity-0 hover:text-zinc-200 group-hover:opacity-100"
                        aria-label="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(c)}
                        className="shrink-0 text-zinc-500 opacity-0 hover:text-red-500 group-hover:opacity-100"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {conversations.length === 0 ? (
                <p className="px-2 py-4 text-xs text-zinc-600">No conversations yet.</p>
              ) : null}
            </nav>

            <div className="border-t border-white/10 p-2">
              <AccountMenu onSettings={() => setShowSettings(true)} />
            </div>
          </aside>

          {/* Main */}
          <main className="flex min-h-0 flex-1 flex-col">
            <DriveChat
              conversationId={activeId}
              keys={keys}
              prompts={prompts}
              onActivate={activateConversation}
              onActivity={() => void loadConversations()}
            />
          </main>
        </div>
      </Glow>

      {showSettings ? (
        <SettingsModal
          keys={keys}
          prompts={prompts}
          onClose={() => setShowSettings(false)}
          onChanged={() => void loadVault()}
        />
      ) : null}

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
