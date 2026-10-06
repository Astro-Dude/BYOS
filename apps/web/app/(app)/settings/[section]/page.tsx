"use client";

import type { AiKey, AiPrompt } from "@byos/api-client";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { IndexingSection, KeysSection, PromptsSection } from "@/components/byok/ai-sections";
import { ProfileSettings } from "@/components/settings/account";
import { SettingsHeader } from "@/components/settings/controls";
import { ApiKeysSettings, WebhooksSettings } from "@/components/settings/developer";
import { AppearanceSettings, ChatSettings, DriveSettings } from "@/components/settings/preferences";
import { SETTINGS_IDS } from "@/components/settings/sections";
import { StorageSettings } from "@/components/settings/storage";
import { api } from "@/lib/api";
import { useAuthed } from "@/lib/auth-context";

/** The saved model keys and prompts, for the sections that need them. */
function useVault(enabled: boolean) {
  const authed = useAuthed();
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const [ks, ps] = await authed((t) => Promise.all([api.listAiKeys(t), api.listAiPrompts(t)]));
    setKeys(ks);
    setPrompts(ps);
    setLoaded(true);
  }, [authed]);
  useEffect(() => {
    if (enabled) load().catch(() => undefined);
  }, [enabled, load]);
  return { keys, prompts, loaded, reload: () => void load() };
}

/** Shortcuts from BYOK: `?new=1` opens the add-key form, `?key=<id>` picks
 *  the key to index with. Read after mount, so the page itself stays static. */
function useShortcut() {
  const [shortcut, setShortcut] = useState<{ newKey: boolean; key?: string }>({ newKey: false });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setShortcut({ newKey: q.get("new") === "1", key: q.get("key") ?? undefined });
  }, []);
  return shortcut;
}

export default function SettingsSection() {
  const { section } = useParams<{ section: string }>();
  const shortcut = useShortcut();
  if (!SETTINGS_IDS.includes(section)) notFound();
  const vault = useVault(["chat", "models", "prompts", "indexing"].includes(section));

  switch (section) {
    case "profile":
      return <ProfileSettings />;
    case "storage":
      return <StorageSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "drive":
      return <DriveSettings />;
    case "chat":
      return <ChatSettings prompts={vault.prompts} />;
    case "models":
      return (
        <>
          <SettingsHeader
            title="Model keys"
            description="Your own AI keys. They're encrypted and only used for your requests."
          />
          <KeysSection
            // Remounts once the shortcut is read, so the add-key form can open.
            key={shortcut.newKey ? "new" : "list"}
            keys={vault.keys}
            loading={!vault.loaded}
            onChanged={vault.reload}
            startWithNewKey={shortcut.newKey}
          />
        </>
      );
    case "prompts":
      return (
        <>
          <SettingsHeader title="System prompts" description="Instructions you can give the model at the start of a chat." />
          <PromptsSection
            key={shortcut.newKey ? "new" : "list"}
            prompts={vault.prompts}
            onChanged={vault.reload}
            startWithNew={shortcut.newKey}
          />
        </>
      );
    case "indexing":
      return (
        <>
          <SettingsHeader title="Indexing" description="Prepare your files so chat can search what's inside them." />
          <IndexingSection
            key={shortcut.key ?? "any"}
            keys={vault.keys}
            loading={!vault.loaded}
            initialKeyId={shortcut.key}
          />
        </>
      );
    case "api-keys":
      return <ApiKeysSettings />;
    case "webhooks":
      return <WebhooksSettings />;
    default:
      notFound();
  }
}
