"use client";

import { useEffect, useMemo, useState } from "react";
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
  genres: string[];
  next: { volume: number | null; date: string } | null;
}

export interface BrowseState {
  q: string;
  tab: Tab;
  genres: string[];
  gmode: GMode;
  page: number;
}

const PER_PAGE = 60;
const TABS = [
  { t: "az", label: "A-Z" },
  { t: "series", label: "🔜 Series nuevas" },
  { t: "tomos", label: "📅 Próximos tomos" },
] as const;

type Tab = (typeof TABS)[number]["t"];
type GMode = "all" | "any";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function readUrl(): BrowseState {
  const empty: BrowseState = { q: "", tab: "az", genres: [], gmode: "all", page: 1 };
  if (typeof window === "undefined") return empty;
  const p = new URLSearchParams(window.location.search);
  const tab = p.get("tab");
  const genres = (p.get("genres") ?? p.get("genre") ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  return {
    q: p.get("q") ?? "",
    tab: tab === "series" || tab === "tomos" ? tab : "az",
    genres,
    gmode: p.get("gmode") === "any" ? "any" : "all",
    page: Math.max(1, Number(p.get("page")) || 1),
  };
}

/** Ventana de hasta 5 números de página alrededor del actual. */
function pageWindow(cur: number, count: number, size = 5): number[] {
  let start = Math.max(1, cur - Math.floor(size / 2));
  const end = Math.min(count, start + size - 1);
  start = Math.max(1, end - size + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * Browse del catálogo local con búsqueda y filtros INSTANTÁNEOS (en memoria) y
 * estado sincronizado a la URL vía history (sin re-fetch): back/forward,
 * restauración de scroll y deep-links funcionan. El estado inicial llega por
 * props desde el server (en SSR no hay `window`). Mobile-first.
 */
export default function CatalogBrowser({
  cards,
  collected = [],
  wished = [],
  initial,
}: {
  cards: BrowseCard[];
  collected?: number[];
  wished?: number[];
  initial: BrowseState;
}) {
  const mine = useMemo(() => new Set(collected), [collected]);
  const wish = useMemo(() => new Set(wished), [wished]);
  const [q, setQ] = useState(initial.q);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [genres, setGenres] = useState<string[]>(initial.genres);
  const [gmode, setGMode] = useState<GMode>(initial.gmode);
  const [page, setPage] = useState(initial.page);

  const genreOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards)
      for (const g of c.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([g, n]) => ({ g, n }));
  }, [cards]);

  function syncUrl(next: BrowseState, replace: boolean) {
    const params = new URLSearchParams();
    if (next.tab !== "az") params.set("tab", next.tab);
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.genres.length) params.set("genres", next.genres.join(","));
    if (next.genres.length > 1 && next.gmode === "any") params.set("gmode", "any");
    if (next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    const url = `/catalogo${qs ? `?${qs}` : ""}`;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }

  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      setQ(u.q);
      setTab(u.tab);
      setGenres(u.genres);
      setGMode(u.gmode);
      setPage(u.page);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return cards.filter((c) => {
      if (tab === "series" && !c.upcoming) return false;
      if (tab === "tomos" && !c.next) return false;
      if (genres.length) {
        const ok =
          gmode === "all"
            ? genres.every((g) => c.genres.includes(g))
            : genres.some((g) => c.genres.includes(g));
        if (!ok) return false;
      }
      if (nq && !norm(c.title).includes(nq)) return false;
      return true;
    });
  }, [cards, q, tab, genres, gmode]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const cur = Math.min(page, pageCount);
  const shown = filtered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

  function update(patch: Partial<BrowseState>, replace = false) {
    const next: BrowseState = { q, tab, genres, gmode, page: 1, ...patch };
    setQ(next.q);
    setTab(next.tab);
    setGenres(next.genres);
    setGMode(next.gmode);
    setPage(next.page);
    syncUrl(next, replace);
  }
  function goPage(p: number) {
    setPage(p);
    syncUrl({ q, tab, genres, gmode, page: p }, false);
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => update({ q: e.target.value }, true)}
        placeholder="Buscar obra…"
        autoComplete="off"
        className="mb-3 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {TABS.map(({ t, label }) => (
          <button
            key={t}
            type="button"
            onClick={() => update({ tab: t })}
            className={`rounded-full px-3 py-1 transition ${
              tab === t ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value=""
          onChange={(e) => {
            const g = e.target.value;
            if (g && !genres.includes(g)) update({ genres: [...genres, g] });
          }}
          className="ml-auto rounded-full border border-border bg-surface-2 px-3 py-1 text-sm outline-none focus:border-accent"
          aria-label="Agregar género"
        >
          <option value="">+ Género…</option>
          {genreOptions
            .filter(({ g }) => !genres.includes(g))
            .map(({ g, n }) => (
              <option key={g} value={g}>
                {g} ({n})
              </option>
            ))}
        </select>
      </div>

      {genres.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => update({ genres: genres.filter((x) => x !== g) })}
              className="rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-accent transition hover:bg-accent/25"
            >
              {g} ✕
            </button>
          ))}
          {genres.length >= 2 && (
            <div className="flex overflow-hidden rounded-full border border-border text-xs">
              {(["all", "any"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => update({ gmode: m })}
                  className={`px-2.5 py-1 transition ${
                    gmode === m ? "bg-accent text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  {m === "all" ? "Todos" : "Cualquiera"}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => update({ genres: [] })}
            className="text-xs text-muted hover:text-foreground"
          >
            limpiar
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No hay series para esa búsqueda.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shown.map((w) => {
            const owned = mine.has(w.id);
            const wishedFlag = !owned && wish.has(w.id);
            return (
              <Link
                key={w.id}
                href={`/serie/${w.id}`}
                className={`group rounded-xl border bg-surface p-2 transition hover:border-accent ${
                  owned
                    ? "border-accent/70 ring-1 ring-accent/40"
                    : wishedFlag
                      ? "border-rose-400/60 ring-1 ring-rose-400/30"
                      : "border-border"
                }`}
              >
                <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-surface-2">
                  {w.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.coverImage} alt={w.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">
                      {w.title}
                    </div>
                  )}
                  {w.national && (
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
                      🇦🇷
                    </span>
                  )}
                  {owned && (
                    <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
                      ✓
                    </span>
                  )}
                  {wishedFlag && (
                    <span className="absolute right-1 top-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      ❤
                    </span>
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
                <p className="truncate text-xs text-muted">
                  {w.publishers.length ? w.publishers.join(" · ") : "Ivrea Argentina"}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-sm">
          <button
            type="button"
            disabled={cur <= 1}
            onClick={() => goPage(cur - 1)}
            className="rounded-lg border border-border px-3 py-1.5 transition hover:border-accent disabled:opacity-40"
          >
            ←
          </button>
          {pageWindow(cur, pageCount).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => goPage(p)}
              aria-current={p === cur}
              className={`min-w-9 rounded-lg border px-3 py-1.5 transition ${
                p === cur ? "border-accent bg-accent text-white" : "border-border hover:border-accent"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            disabled={cur >= pageCount}
            onClick={() => goPage(cur + 1)}
            className="rounded-lg border border-border px-3 py-1.5 transition hover:border-accent disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
      <p className="mt-2 text-center text-xs text-muted">{filtered.length} obras</p>
    </>
  );
}
