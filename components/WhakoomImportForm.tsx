"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { importWhakoomUrlAction } from "@/app/actions";
import type { SingleImportResult } from "@/lib/whakoomImport";

export default function WhakoomImportForm() {
  const [url, setUrl] = useState("");
  const [res, setRes] = useState<SingleImportResult | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!url.trim()) return;
    setRes(null);
    start(async () => {
      const r = await importWhakoomUrlAction(url);
      setRes(r);
      if (r.ok) setUrl("");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Importar desde Whakoom</h2>
      <p className="mb-3 mt-1 text-xs text-muted">
        Pegá la URL de una edición de Whakoom (preventas, títulos en español que
        el crawl todavía no tiene). La guarda mapeada o, si no resuelve, sin
        mapear para curar.
      </p>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://www.whakoom.com/ediciones/…"
          className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={submit}
          disabled={pending}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Importando…" : "Importar"}
        </button>
      </div>

      {res && (
        <div className="mt-3 text-sm">
          {res.ok ? (
            <p className="text-emerald-400">
              ✓ Importado: <b>{res.title}</b> ({res.publisher}) —{" "}
              {res.anilistId ? (
                <Link
                  href={`/manga/${res.anilistId}`}
                  className="text-accent hover:underline"
                >
                  mapeado a #{res.anilistId} ↗
                </Link>
              ) : (
                <>
                  sin mapear ·{" "}
                  <Link
                    href="/admin/mapeos?estado=unmapped"
                    className="text-accent hover:underline"
                  >
                    mapealo acá
                  </Link>
                </>
              )}
            </p>
          ) : (
            <p className="text-red-400">✗ {res.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
