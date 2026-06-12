"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useBrowse } from "@/components/browse/BrowseProvider";

type Item = { id: number; name: string };

const PER_PAGE = 30;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Input de filtro de mangakas (sincronizado con el buscador de la barra). */
export function MangakaFilterInput() {
  const browse = useBrowse();
  if (!browse) return null;
  return (
    <input
      type="search"
      value={browse.q}
      onChange={(e) => browse.setQ(e.target.value)}
      placeholder="Filtrar mangaka…"
      aria-label="Filtrar mangaka"
      className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
    />
  );
}

/** Listado alfabético de mangakas, filtrado por el buscador compartido. */
export function MangakaList({ all }: { all: Item[] }) {
  const browse = useBrowse();
  const q = browse?.q ?? "";
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const nq = norm(q);
    return nq ? all.filter((m) => norm(m.name).includes(nq)) : all;
  }, [q, all]);

  if (filtered.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted">
        {q
          ? "Ningún mangaka coincide con tu búsqueda."
          : "El índice de mangakas se está armando. Volvé en un rato."}
      </p>
    );
  }

  const lastPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const cur = Math.min(page, lastPage);
  const slice = filtered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {slice.map((m) => (
          <Link
            key={m.id}
            href={`/autor/${m.id}`}
            title={m.name}
            className="truncate rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium transition hover:border-accent hover:text-accent"
          >
            {m.name}
          </Link>
        ))}
      </div>
      <ClientPager page={cur} lastPage={lastPage} onPage={setPage} />
    </>
  );
}

export function ClientPager({
  page,
  lastPage,
  onPage,
}: {
  page: number;
  lastPage: number;
  onPage: (n: number) => void;
}) {
  if (lastPage <= 1) return null;

  const windowSize = 10;
  const start = Math.max(
    1,
    Math.min(page - Math.floor(windowSize / 2), lastPage - windowSize + 1),
  );
  const end = Math.min(start + windowSize - 1, lastPage);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-1.5 text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-lg px-3 py-1.5 text-muted transition hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted"
      >
        ‹ Anterior
      </button>

      {pages.map((n) =>
        n === page ? (
          <span
            key={n}
            aria-current="page"
            className="min-w-9 rounded-lg border border-accent px-3 py-1.5 text-center font-medium text-accent"
          >
            {n}
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            className="min-w-9 rounded-lg px-3 py-1.5 text-center text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            {n}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page >= lastPage}
        onClick={() => onPage(page + 1)}
        className="rounded-lg px-3 py-1.5 text-muted transition hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted"
      >
        Siguiente ›
      </button>
    </nav>
  );
}
