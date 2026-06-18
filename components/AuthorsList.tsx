"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Índice de autores con búsqueda instantánea (filtra en memoria). */
export default function AuthorsList({
  authors,
}: {
  authors: { name: string; count: number }[];
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return nq ? authors.filter((a) => norm(a.name).includes(nq)) : authors;
  }, [authors, q]);

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar autor…"
        autoComplete="off"
        className="mb-4 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Sin resultados.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.map((a) => (
            <li key={a.name}>
              <Link
                href={`/autores/${encodeURIComponent(a.name)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm transition hover:border-accent"
              >
                <span className="truncate font-medium">{a.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {a.count} {a.count === 1 ? "obra" : "obras"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-center text-xs text-muted">{filtered.length} autores</p>
    </>
  );
}
