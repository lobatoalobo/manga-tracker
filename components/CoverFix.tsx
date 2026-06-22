"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWorkAction, uploadCoverAction } from "@/app/actions";

/**
 * Arreglo rápido de portada faltante (en /admin/herramientas → "Series sin
 * portada"). Subí un archivo o pegá una URL: ambos van a R2 (propia) vía
 * updateWorkAction, que ademas bloquea la portada en `curated` (ningún job la
 * pisa). Al guardar, la serie sale de la lista (router.refresh). Ver covers-r2.
 */
export default function CoverFix({
  workId,
  serieHref,
}: {
  workId: number;
  serieHref: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (cover: string) =>
    start(async () => {
      await updateWorkAction(workId, { coverImage: cover });
      router.refresh();
    });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadCoverAction(fd);
    setUploading(false);
    e.target.value = "";
    if (r.ok) save(r.url);
    else setErr(r.error);
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <a
        href={serieHref}
        className="rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
      >
        Ver
      </a>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && url.trim()) save(url.trim());
        }}
        placeholder="URL…"
        disabled={pending || uploading}
        className="w-28 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => url.trim() && save(url.trim())}
        disabled={pending || uploading || !url.trim()}
        className="rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-30"
      >
        OK
      </button>
      <label
        className={`cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent ${pending || uploading ? "opacity-50" : ""}`}
      >
        {uploading ? "…" : "📤"}
        <input
          type="file"
          accept="image/*"
          onChange={onFile}
          disabled={pending || uploading}
          className="hidden"
        />
      </label>
      {err && <span className="text-xs text-rose-400">{err}</span>}
    </span>
  );
}
