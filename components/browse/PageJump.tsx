"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Salto directo a una página (para el A-Z de AniList, que tiene muchas). */
export default function PageJump({
  page,
  lastPage,
  basePath,
}: {
  page: number;
  lastPage: number;
  basePath: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(page));

  function go(e: React.FormEvent) {
    e.preventDefault();
    const n = Math.min(Math.max(1, Number(value) || 1), lastPage);
    const sep = basePath.includes("?") ? "&" : "?";
    router.push(`${basePath}${sep}page=${n}`);
  }

  return (
    <form onSubmit={go} className="flex items-center gap-1.5 text-sm text-muted">
      <span>Ir a página</span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-center text-sm text-foreground outline-none focus:border-accent"
        aria-label="Número de página"
      />
      <span>de {lastPage}</span>
      <button className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white transition hover:opacity-90">
        Ir
      </button>
    </form>
  );
}
