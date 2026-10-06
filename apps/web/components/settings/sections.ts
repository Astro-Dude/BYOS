import {
  Cloud,
  Code2,
  Database,
  HardDrive,
  KeyRound,
  type LucideIcon,
  MessageCircle,
  MessageSquareText,
  Palette,
  User,
  Webhook,
} from "lucide-react";

/** Every Settings page, in nav order. The id is the URL: /settings/<id>. */
export const SETTINGS_GROUPS: { label: string; items: { id: string; label: string; icon: LucideIcon }[] }[] = [
  {
    label: "Account",
    items: [
      { id: "profile", label: "Profile", icon: User },
      { id: "storage", label: "Storage", icon: Cloud },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "drive", label: "Drive", icon: HardDrive },
      { id: "chat", label: "Chat", icon: MessageCircle },
    ],
  },
  {
    label: "AI",
    items: [
      { id: "models", label: "Model keys", icon: KeyRound },
      { id: "prompts", label: "System prompts", icon: MessageSquareText },
      { id: "indexing", label: "Indexing", icon: Database },
    ],
  },
  {
    label: "Developer",
    items: [
      { id: "api-keys", label: "API keys", icon: Code2 },
      { id: "webhooks", label: "Webhooks", icon: Webhook },
    ],
  },
];

export const SETTINGS_IDS = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.id));

/** A shortcut into Settings from BYOK's chat: the index pill, "Add a key". */
export type SettingsTarget = {
  tab?: "keys" | "prompts" | "index";
  indexKeyId?: string;
  newKey?: boolean;
  newPrompt?: boolean;
};

/** The Settings page a shortcut lands on, with the way back to BYOK. */
export function settingsHref(target: SettingsTarget): string {
  const params = new URLSearchParams({ from: "byok" });
  if (target.tab === "index") {
    if (target.indexKeyId) params.set("key", target.indexKeyId);
    return `/settings/indexing?${params}`;
  }
  if (target.tab === "prompts") {
    if (target.newPrompt) params.set("new", "1");
    return `/settings/prompts?${params}`;
  }
  if (target.newKey) params.set("new", "1");
  return `/settings/models?${params}`;
}
