"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatProximaDate, formatReleaseLabel } from "@/lib/releaseDate";

export interface BrowseCard {
  id: number;
  title: string;
  coverImage: string | null;
  publishers: string[];
  national: boolean;
  upcoming: boolean;
  releaseLabel: string | null;
  next: { volume: number | null; date: string } | null;
}

const PER_PAGE = 60;
const TABS = [
  { t: "az", label: "A-Z" },
  { t: "series", label: "🔜 Series nuevas" },
  { t: "tomos", label: "📅 Próximos tomos" },
] as const;

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Browse del catálogo local con búsqueda INSTANTÁNEA (filtra en memoria, sin
 * round-trip al server) — como el A-Z nacional de prod. Recibe todas las obras
 * y filtra por tab + texto al instante.
 */
export default function CatalogBrowser({ cards }: { cards: BrowseCard[] }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["t"]>("az");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return cards.filter((c) => {
      if (tab === "series" && !c.upcoming) return false;
      if (tab === "tomos" && !c.next) return false;
      if (nq && !norm(c.title).includes(nq)) return false;
      return true;
    });
  }, [cards, q, tab]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const cur = Math.min(page, pageCount);
  const shown = filtered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        placeholder="Buscar obra…"
        autoComplete="off"
        className="mb-3 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />

      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        {TABS.map(({ t, label }) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 transition ${
              tab === t
                ? "bg-accent text-white"
                : "bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {q ? `Sin resultados para "${q}".` : "No hay obras."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shown.map((w) => (
            <Link
              key={w.id}
              href={`/serie/${w.id}`}
              className="group rounded-xl border border-border bg-surface p-2 transition hover:border-accent"
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                {w.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.coverImage} alt={w.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">
                    {w.title}
                  </div>
                )}
                {w.next && (
                  <span className="absolute bottom-1 left-1 right-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
                    📅 {w.next.volume ? `#${w.next.volume} · ` : ""}
                    {formatProximaDate(w.next.date)}
                  </span>
                )}
                {!w.next && w.upcoming && (
                  <span className="absolute bottom-1 left-1 right-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
                    🔜 {formatReleaseLabel(w.releaseLabel) ?? "Próximo a salir"}
                  </span>
                )}
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm font-medium">{w.title}</p>
              <p className="text-xs text-muted">
                {w.national && "🇦🇷 "}
                {w.publishers.join(" · ")}
              </p>
            </Link>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          <button
            type="button"
            disabled={cur <= 1}
            onClick={() => setPage(cur - 1)}
            className="rounded-lg border border-border px-3 py-1.5 transition hover:border-accent disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="text-muted">
            Página {cur} de {pageCount} · {filtered.length} obras
          </span>
          <button
            type="button"
            disabled={cur >= pageCount}
            onClick={() => setPage(cur + 1)}
            className="rounded-lg border border-border px-3 py-1.5 transition hover:border-accent disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}
    </>
  );
}
