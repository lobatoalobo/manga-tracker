"use client";

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";

type Item = { id: number; name: string };

const PER_PAGE = 30;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

const Ctx = createContext<{
  q: string;
  setQ: (v: string) => void;
  filtered: Item[];
  page: number;
  setPage: (n: number) => void;
} | null>(null);

/**
 * Estado compartido del tab Mangaka: el input de filtro (en la barra de tabs)
 * y la lista (debajo) viven en componentes distintos pero comparten este
 * contexto, así el filtrado es instantáneo (client-side, sin recargar).
 */
export function MangakaProvider({
  all,
  children,
}: {
  all: Item[];
  children: React.ReactNode;
}) {
  const [q, setQRaw] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const nq = norm(q);
    return nq ? all.filter((m) => norm(m.name).startsWith(nq)) : all;
  }, [q, all]);

  const setQ = (v: string) => {
    setQRaw(v);
    setPage(1); // al cambiar el filtro, volvemos a la primera página
  };

  return (
    <Ctx.Provider value={{ q, setQ, filtered, page, setPage }}>
      {children}
    </Ctx.Provider>
  );
}

const FILTER_HINT = "Seleccioná Mangaka para habilitar";

/**
 * Filtro de mangakas. Siempre visible en la barra: habilitado solo en el tab
 * Mangaka; en el resto se ve deshabilitado y muestra un tooltip (hover en
 * desktop, tap en mobile), igual que "Solo terminadas".
 */
export function MangakaFilterInput({ enabled }: { enabled: boolean }) {
  const ctx = useContext(Ctx);
  const [showTip, setShowTip] = useState(false);

  if (!enabled || !ctx) {
    return (
      <span
        className="group relative ml-1"
        onClick={() => {
          setShowTip(true);
          setTimeout(() => setShowTip(false), 2500);
        }}
      >
        <input
          type="search"
          readOnly
          tabIndex={-1}
          placeholder="Filtrar mangaka…"
          title={FILTER_HINT}
          aria-disabled="true"
          className="pointer-events-none w-40 cursor-not-allowed rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted opacity-40 sm:w-52"
        />
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground shadow-lg group-hover:block ${
            showTip ? "block" : "hidden"
          }`}
        >
          {FILTER_HINT}
        </span>
      </span>
    );
  }

  return (
    <input
      type="search"
      value={ctx.q}
      onChange={(e) => ctx.setQ(e.target.value)}
      placeholder="Filtrar mangaka…"
      aria-label="Filtrar mangaka"
      className="ml-1 w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none sm:w-52"
    />
  );
}

export function MangakaList() {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const { filtered, page, setPage, q } = ctx;

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

function ClientPager({
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
