"use client";

import { ApiError, type AdminRow } from "@byos/api-client";
import { Loader2, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth, useAuthed } from "@/lib/auth-context";

/** Who can see this page.
 *
 *  Admins used to come from config alone, which meant a redeploy to add one.
 *  The list is the database now; `ADMIN_IDS` stays as the break-glass account
 *  that can't be locked out — shown here as an unrevokable row rather than
 *  hidden, so the list never lies about who has access.
 */
export function AdminsPanel() {
  const authed = useAuthed();
  const { user } = useAuth();
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () =>
    authed((t) => api.listAdmins(t))
      .then(setRows)
      .catch(() => setRows([]));

  useEffect(() => {
    void load();
    // `load` is recreated every render; the effect only needs to run per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const message = (e: unknown, fallback: string) =>
    e instanceof ApiError && e.message ? e.message : fallback;

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = identifier.trim();
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const row = await authed((t) => api.grantAdmin(t, id));
      setIdentifier("");
      setNote(`${row.username ? `@${row.username}` : "That account"} can now see the dashboard.`);
      await load();
    } catch (err) {
      setError(message(err, "Couldn't promote that account."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: AdminRow) => {
    setError(null);
    setNote(null);
    try {
      await authed((t) => api.revokeAdmin(t, row.id));
      await load();
    } catch (err) {
      setError(message(err, "Couldn't revoke that account."));
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={grant} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="@username or phone number"
          aria-label="Username or phone of the account to promote"
          className="field flex-1"
        />
        <button type="submit" disabled={busy || !identifier.trim()} className="pill-filled shrink-0">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Make admin
        </button>
      </form>

      {error ? <p className="text-[0.9375rem] text-red-600">{error}</p> : null}
      {note ? <p className="text-[0.9375rem] text-zinc-600">{note}</p> : null}

      <div className="-mx-2 divide-y divide-zinc-200 border-t border-zinc-200">
        {rows === null ? (
          <p className="type-label px-2 py-4">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="type-label px-2 py-4">No admins listed.</p>
        ) : (
          rows.map((row) => {
            const self = row.id === user?.id;
            return (
              <div key={row.id} className="flex items-center gap-3 px-2 py-3.5">
                <ShieldCheck className="h-[17px] w-[17px] shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem] text-zinc-900">
                    {row.username ? `@${row.username}` : (row.phone ?? "Unnamed account")}
                    {self ? <span className="type-label ml-2">you</span> : null}
                  </p>
                  {row.username && row.phone ? (
                    <p className="type-label mt-0.5 truncate">{row.phone}</p>
                  ) : null}
                </div>
                {row.bootstrap ? (
                  <span className="pill-sm-ghost pointer-events-none" title="Set by ADMIN_IDS">
                    Break-glass
                  </span>
                ) : self ? null : (
                  <button
                    onClick={() => void revoke(row)}
                    className="pill-sm-ghost"
                    aria-label={`Revoke admin from ${row.username ?? row.phone ?? "account"}`}
                  >
                    <UserMinus className="h-3.5 w-3.5" /> Revoke
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="type-label">
        Phones match by their last digits, so the country code is optional. The break-glass account
        comes from the server&apos;s environment and can&apos;t be removed here.
      </p>
    </div>
  );
}
