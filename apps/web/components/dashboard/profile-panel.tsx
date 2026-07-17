"use client";

import { ApiError } from "@byos/api-client";
import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";

import { RenameModal } from "@/components/dashboard/rename-modal";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";

function Row({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-zinc-500">{label}</span>
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {value}
        </span>
        {onEdit ? (
          <button
            onClick={onEdit}
            aria-label={`Edit ${label.toLowerCase()}`}
            className="shrink-0 text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {hasPassword ? "Change password" : "Set a password"}
        </h3>
        <p className="mt-1 text-sm text-zinc-500">
          Sign in with your username or phone — no Telegram code needed.
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
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={onClose}
            className="border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
        <p className="mt-3 text-xs text-zinc-400">At least 8 characters.</p>
      </div>
    </div>
  );
}

/** Account profile: identity details with inline edit for display name and
 *  password (used for password login, skipping Telegram OTP). */
export function ProfilePanel() {
  const { user, refresh } = useAuth();
  const authed = useAuthed();
  const toast = useToast();
  const [editing, setEditing] = useState<"name" | "password" | null>(null);

  const hasPassword = user?.has_password ?? false;

  const saveName = async (name: string) => {
    await authed((t) => api.setDisplayName(t, name));
    toast("Display name updated");
    await refresh();
  };

  const savePassword = async (current: string | undefined, next: string) => {
    await authed((t) => api.setPassword(t, next, current));
    toast(hasPassword ? "Password changed" : "Password set");
    await refresh();
  };

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center py-8">
      <h1 className="mb-6 text-2xl font-normal text-zinc-800 dark:text-zinc-200">Profile</h1>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">Account</h2>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          <Row
            label="Display name"
            value={user?.display_name || "—"}
            onEdit={() => setEditing("name")}
          />
          <Row label="Username" value={user?.username ? `@${user.username}` : "—"} />
          <Row label="Phone" value={user?.phone || "—"} />
          <Row
            label="Password"
            value={hasPassword ? "••••••••" : "Not set"}
            onEdit={() => setEditing("password")}
          />
        </div>
      </section>

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
        <PasswordModal
          hasPassword={hasPassword}
          onClose={() => setEditing(null)}
          onSubmit={savePassword}
        />
      ) : null}
    </div>
  );
}
