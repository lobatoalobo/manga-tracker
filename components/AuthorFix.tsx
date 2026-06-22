"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWorkAction } from "@/app/actions";

/**
 * Completar el autor de una serie que no lo tiene (en /admin/autores → "Series
 * sin autor"). Escribís el autor y guardás: updateWorkAction lo setea y lo bloquea
 * en `curated` (ningún job lo pisa). Al guardar, la serie sale de la lista.
 */
export default function AuthorFix({
  workId,
  serieHref,
}: {
  workId: number;
  serieHref: string;
}) {
  const router = useRouter();
  const [author, setAuthor] = useState("");
  const [pending, start] = useTransition();

  const save = () => {
    const value = author.trim();
    if (!value) return;
    start(async () => {
      await updateWorkAction(workId, { author: value });
      router.refresh();
    });
  };

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <a
        href={serieHref}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
      >
        Ver
      </a>
      <input
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Autor…"
        disabled={pending}
        className="w-40 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-50"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || !author.trim()}
        className="rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent disabled:opacity-30"
      >
        Guardar
      </button>
    </span>
  );
}
