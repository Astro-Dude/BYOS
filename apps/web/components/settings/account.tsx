"use client";

import { ApiError } from "@byos/api-client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RenameModal } from "@/components/dashboard/rename-modal";
import { SettingRow, SettingsGroup, SettingsHeader } from "@/components/settings/controls";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

const editButton = "pill-sm-ghost shrink-0";

/** Modal to set or change the account password (used for password login). */
function PasswordModal({
  hasPassword,
  onClose,
  onSubmit,
}: {
  hasPassword: boolean;
  onClose: () => void;
  onSubmit: (current: string | undefined, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (hasPassword && !current) return setError("Enter your current password.");
    if (next.length < 8) return setError("Password must be at least 8 characters.");
    if (next !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await onSubmit(hasPassword ? current : undefined, next);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't save password");
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-scrim z-50"
      onClick={onClose}
    >
      <div
        className="modal-surface max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="type-heading-sm">
          {hasPassword ? "Change password" : "Set a password"}
        </h3>
        <p className="mt-1 text-[0.9375rem] text-zinc-500">
          Sign in with your username or phone. No Telegram code needed.
        </p>
        <div className="mt-4 space-y-3">
          {hasPassword ? (
            <PasswordInput
              autoComplete="current-password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
            />
          ) : null}
          <PasswordInput
            autoComplete="new-password"
            placeholder="New password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoFocus={!hasPassword}
          />
          <PasswordInput
            autoComplete="new-password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {error ? <p className="text-[0.9375rem] text-red-600">{error}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={onClose}
            className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !next || !confirm || (hasPassword && !current)}
          >
            {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
          </Button>
        </div>
        <p className="mt-3 text-[0.8125rem] text-zinc-400">At least 8 characters.</p>
      </div>
    </div>
  );
}

/** Who you are: name, username, phone, and the storage behind the account. */
export function ProfileSettings() {
  const { user, refresh, logout } = useAuth();
  const authed = useAuthed();
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState<"name" | "username" | "password" | null>(null);
  const hasPassword = user?.has_password ?? false;

  const savePassword = async (current: string | undefined, next: string) => {
    await authed((t) => api.setPassword(t, next, current));
    toast(hasPassword ? "Password changed" : "Password set");
    await refresh();
  };

  const saveName = async (name: string) => {
    await authed((t) => api.setDisplayName(t, name));
    toast("Display name updated");
    await refresh();
  };

  const saveUsername = async (username: string) => {
    try {
      await authed((t) => api.setUsername(t, username));
      toast("Username saved");
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't save that username", "error");
    }
  };

  return (
    <>
      <SettingsHeader title="Profile" description="How you appear in BYOS, and the account behind it." />
      <SettingsGroup title="Account">
        <SettingRow label="Display name" description={user?.display_name || "Not set"}>
          <button className={editButton} onClick={() => setEditing("name")}>
            Edit
          </button>
        </SettingRow>
        <SettingRow
          label="Username"
          description={
            user?.username
              ? `@${user.username}. Your public links use it.`
              : "Not set. Pick one to get public links like …/you/portfolio."
          }
        >
          {user?.username ? null : (
            <button className={editButton} onClick={() => setEditing("username")}>
              Set username
            </button>
          )}
        </SettingRow>
        <SettingRow label="Phone" description={user?.phone || "Not set"} />
      </SettingsGroup>

      <SettingsGroup title="Sign in">
        <SettingRow
          label="Password"
          description={
            hasPassword
              ? "Set. Sign in with your username or phone and this password."
              : "Not set. Without one, you sign in with a Telegram code."
          }
        >
          <button className={editButton} onClick={() => setEditing("password")}>
            {hasPassword ? "Change" : "Set password"}
          </button>
        </SettingRow>
        <SettingRow label="Log out" description="Signs you out on this device. Your files stay where they are.">
          <button
            className={`${editButton} flex items-center gap-1.5`}
            onClick={() => void logout().then(() => router.replace("/login"))}
          >
            <LogOut className="h-3.5 w-3.5" /> Log out
          </button>
        </SettingRow>
      </SettingsGroup>

      {editing === "name" ? (
        <RenameModal
          title="Display name"
          initial={user?.display_name ?? ""}
          placeholder="Your name"
          confirmLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={saveName}
        />
      ) : null}
      {editing === "password" ? (
        <PasswordModal hasPassword={hasPassword} onClose={() => setEditing(null)} onSubmit={savePassword} />
      ) : null}
      {editing === "username" ? (
        <RenameModal
          title="Username"
          initial=""
          placeholder="3 to 30 letters, numbers, - or _"
          confirmLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={saveUsername}
        />
      ) : null}
    </>
  );
}
