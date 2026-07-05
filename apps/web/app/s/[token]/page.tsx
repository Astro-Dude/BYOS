"use client";

import { ApiError, type ShareInfoItem } from "@byos/api-client";
import { Download, Eye, Lock } from "lucide-react";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

function Viewer({ url, mime }: { url: string; mime: string | null }) {
  const m = mime ?? "";
  if (m.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="shared file" className="mx-auto max-h-[75vh] rounded-lg object-contain" />;
  }
  if (m.startsWith("video/")) {
    return <video src={url} controls className="mx-auto max-h-[75vh] rounded-lg" />;
  }
  if (m.startsWith("audio/")) {
    return <audio src={url} controls className="w-full" />;
  }
  if (m === "application/pdf" || m.startsWith("text/")) {
    return <iframe src={url} title="shared file" className="h-[75vh] w-full rounded-lg border border-zinc-200" />;
  }
  return (
    <p className="py-16 text-center text-sm text-zinc-500">
      Preview isn&apos;t available for this file type.
    </p>
  );
}

export default function SharePage() {
  const params = useParams();
  const token = String(params.token);
  const [info, setInfo] = useState<ShareInfoItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [submittedPw, setSubmittedPw] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await api.shareInfo(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "This link is unavailable");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = (children: ReactNode) => (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center gap-3 text-indigo-600">
        <LogoMark className="h-7 w-7" />
        <span className="font-brand text-lg font-bold tracking-tight">BYOS</span>
      </header>
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </main>
  );

  if (loading) return card(<p className="text-center text-sm text-zinc-400">Loading…</p>);
  if (error || !info)
    return card(<p className="text-center text-sm text-red-600">{error ?? "Not found"}</p>);
  if (info.expired) return card(<p className="text-center text-sm text-zinc-600">This link has expired.</p>);
  if (info.limit_reached)
    return card(<p className="text-center text-sm text-zinc-600">This link&apos;s download limit is reached.</p>);

  if (info.has_password && submittedPw === undefined) {
    return card(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedPw(pw);
        }}
        className="mx-auto w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5"
      >
        <div className="flex items-center gap-2 text-zinc-900">
          <Lock className="h-4 w-4" />
          <span className="font-medium">Password required</span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">This shared file is protected.</p>
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Enter password"
          className="mt-3"
        />
        <Button type="submit" className="mt-3 w-full" disabled={!pw}>
          Unlock
        </Button>
      </form>,
    );
  }

  const contentUrl = api.shareUrl(token, submittedPw);
  return card(
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-zinc-900">{info.file_name}</span>
        {info.view_only ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
            <Eye className="h-3.5 w-3.5" /> View only
          </span>
        ) : (
          <a
            href={contentUrl}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        )}
      </div>
      <Viewer url={contentUrl} mime={info.mime} />
    </div>,
  );
}
