"use client";

import { useState, useTransition } from "react";
import { setSharingAction } from "@/app/actions";

export default function ShareToggle({
  initialSlug,
}: {
  initialSlug: string | null;
}) {
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const url =
    slug && typeof window !== "undefined"
      ? `${window.location.origin}/u/${slug}`
      : "";

  function toggle(enable: boolean) {
    startTransition(async () => {
      const res = await setSharingAction(enable);
      setSlug(res.slug);
      setCopied(false);
    });
  }

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Compartir mi colección</p>
          <p className="text-xs text-muted">
            {slug
              ? "Tu colección es pública vía este link (solo lectura)."
              : "Tu colección es privada."}
          </p>
        </div>
        <button
          onClick={() => toggle(!slug)}
          disabled={isPending}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
            slug
              ? "border border-border text-muted hover:border-red-500 hover:text-red-400"
              : "bg-accent text-white hover:opacity-90"
          }`}
        >
          {isPending ? "…" : slug ? "Dejar de compartir" : "Compartir"}
        </button>
      </div>

      {slug && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            className="min-w-56 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted outline-none"
          />
          <button
            onClick={copy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:border-accent"
          >
            {copied ? "¡Copiado!" : "Copiar"}
          </button>
        </div>
      )}
    </div>
  );
}
