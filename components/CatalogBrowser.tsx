"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { formatProximaDate, formatReleaseLabel } from "@/lib/releaseDate";
import { toggleWishAction } from "@/app/actions";
import ArgentinaFlag from "@/components/ArgentinaFlag";
import UsaFlag from "@/components/UsaFlag";
import type { WishEdition } from "@/components/WishButton";
import { GENRE_CATEGORIES, DEMOGRAPHICS } from "@/lib/genres";

export interface BrowseCard {
  id: number;
  title: string;
  coverImage: string | null;
  publishers: string[];
  national: boolean;
  intl?: boolean;
  upcoming: boolean;
  releaseLabel: string | null;
  genres: string[];
  demographic: string | null;
  next: { volume: number | null; date: string } | null;
  reissue?: { volume: number | null; date: string } | null;
  editions?: WishEdition[]; // ediciones deseables (para el corazón por edición)
}

export interface BrowseState {
  q: string;
  tab: Tab;
  genres: string[];
  gmode: GMode;
  demographics: string[];
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

/** Estilo de chip toggle (género/demografía). */
const chipCls = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs transition ${
    on
      ? "border-accent bg-accent/15 text-accent"
      : "border-border text-muted hover:text-foreground"
  }`;

function readUrl(): BrowseState {
  const empty: BrowseState = {
    q: "",
    tab: "az",
    genres: [],
    gmode: "any",
    demographics: [],
    page: 1,
  };
  if (typeof window === "undefined") return empty;
  const p = new URLSearchParams(window.location.search);
  const tab = p.get("tab");
  const split = (v: string | null) =>
    (v ?? "").split(",").map((g) => g.trim()).filter(Boolean);
  return {
    q: p.get("q") ?? "",
    tab: tab === "series" || tab === "tomos" ? tab : "az",
    genres: split(p.get("genres") ?? p.get("genre")),
    gmode: p.get("gmode") === "all" ? "all" : "any",
    demographics: split(p.get("demo")),
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
  wishedMap = {},
  canWish = false,
  initial,
  basePath = "/catalogo",
  showTabs = true,
  emptyPublisher = "Ivrea Argentina",
}: {
  cards: BrowseCard[];
  collected?: number[];
  /** workId → keys de edición deseadas (para el highlight y el modal). */
  wishedMap?: Record<number, string[]>;
  canWish?: boolean;
  initial: BrowseState;
  /** Ruta base para sincronizar la URL (p. ej. "/internacional"). */
  basePath?: string;
  /** Mostrar las pestañas A-Z / Series nuevas / Próximos tomos (catálogo AR). */
  showTabs?: boolean;
  /** Editorial a mostrar cuando una card no trae publishers. */
  emptyPublisher?: string;
}) {
  const mine = useMemo(() => new Set(collected), [collected]);
  const [wishMap, setWishMap] = useState<Map<number, Set<string>>>(
    () => new Map(Object.entries(wishedMap).map(([k, v]) => [Number(k), new Set(v)])),
  );
  const [wishModal, setWishModal] = useState<BrowseCard | null>(null);
  const [, startWish] = useTransition();

  const wishedAny = (id: number) => (wishMap.get(id)?.size ?? 0) > 0;
  const editionsOf = (w: BrowseCard): WishEdition[] =>
    w.editions && w.editions.length ? w.editions : [{ key: "", publisher: null, region: null, label: emptyPublisher }];

  function toggleEdition(w: BrowseCard, ed: WishEdition) {
    const isW = wishMap.get(w.id)?.has(ed.key) ?? false;
    setWishMap((m) => {
      const n = new Map(m);
      const s = new Set(n.get(w.id) ?? []);
      if (isW) s.delete(ed.key);
      else s.add(ed.key);
      n.set(w.id, s);
      return n;
    });
    startWish(() =>
      toggleWishAction({
        anilistId: -w.id,
        title: w.title,
        coverImage: w.coverImage ?? "",
        wished: isW,
        editionKey: ed.key,
        publisher: ed.publisher,
        region: ed.region,
      }),
    );
  }

  function onHeart(w: BrowseCard, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const eds = editionsOf(w);
    if (eds.length <= 1) toggleEdition(w, eds[0]);
    else setWishModal(w); // varias ediciones → elegir en modal
  }
  const [q, setQ] = useState(initial.q);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [genres, setGenres] = useState<string[]>(initial.genres);
  const [gmode, setGMode] = useState<GMode>(initial.gmode);
  const [demographics, setDemographics] = useState<string[]>(
    initial.demographics,
  );
  const [page, setPage] = useState(initial.page);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Conteo por género / demografía sobre el catálogo actual (para mostrar el
  // número y ocultar los que están en 0).
  const genreCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards)
      for (const g of c.genres) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  }, [cards]);
  const demoCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) if (c.demographic) m.set(c.demographic, (m.get(c.demographic) ?? 0) + 1);
    return m;
  }, [cards]);

  function syncUrl(next: BrowseState, replace: boolean) {
    const params = new URLSearchParams();
    if (next.tab !== "az") params.set("tab", next.tab);
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.genres.length) params.set("genres", next.genres.join(","));
    if (next.genres.length > 1 && next.gmode === "all") params.set("gmode", "all");
    if (next.demographics.length) params.set("demo", next.demographics.join(","));
    if (next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    const url = `${basePath}${qs ? `?${qs}` : ""}`;
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
      setDemographics(u.demographics);
      setPage(u.page);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return cards.filter((c) => {
      if (tab === "series" && !c.upcoming) return false;
      if (tab === "tomos" && !c.next && !c.reissue) return false;
      if (genres.length) {
        const ok =
          gmode === "all"
            ? genres.every((g) => c.genres.includes(g))
            : genres.some((g) => c.genres.includes(g));
        if (!ok) return false;
      }
      if (
        demographics.length &&
        !(c.demographic && demographics.includes(c.demographic))
      )
        return false;
      if (nq && !norm(c.title).includes(nq)) return false;
      return true;
    });
  }, [cards, q, tab, genres, gmode, demographics]);

  // Ordenar por fecha de salida (más pronto primero) en las pestañas de
  // próximos; en A-Z se respeta el alfabético que ya viene del server.
  const soonest = (c: BrowseCard) => {
    const ds = [c.next?.date, c.reissue?.date]
      .filter(Boolean)
      .map((d) => +new Date(d as string));
    return ds.length ? Math.min(...ds) : Infinity;
  };
  const ordered = useMemo(() => {
    if (tab === "tomos")
      return [...filtered].sort((a, b) => soonest(a) - soonest(b));
    if (tab === "series")
      return [...filtered].sort((a, b) =>
        (a.releaseLabel ?? "9999").localeCompare(b.releaseLabel ?? "9999"),
      );
    return filtered;
  }, [filtered, tab]);

  const pageCount = Math.max(1, Math.ceil(ordered.length / PER_PAGE));
  const cur = Math.min(page, pageCount);
  const shown = ordered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

  function update(patch: Partial<BrowseState>, replace = false) {
    const next: BrowseState = {
      q,
      tab,
      genres,
      gmode,
      demographics,
      page: 1,
      ...patch,
    };
    setQ(next.q);
    setTab(next.tab);
    setGenres(next.genres);
    setGMode(next.gmode);
    setDemographics(next.demographics);
    setPage(next.page);
    syncUrl(next, replace);
  }
  function goPage(p: number) {
    setPage(p);
    syncUrl({ q, tab, genres, gmode, demographics, page: p }, false);
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

      {/* Tabs (fila propia). Solo catálogo nacional (releases de Ivrea). */}
      {showTabs && (
      <div className="mb-2 flex flex-wrap gap-2 text-sm">
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
      </div>
      )}

      {/* Filtros: panel colapsable (demografía + géneros por categoría). */}
      <div className="mb-2 flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="rounded-full border border-border bg-surface-2 px-3 py-1 transition hover:text-foreground"
        >
          Filtros
          {genres.length + demographics.length > 0
            ? ` · ${genres.length + demographics.length}`
            : ""}{" "}
          {filtersOpen ? "▲" : "▾"}
        </button>
        {(genres.length > 0 || demographics.length > 0) && (
          <button
            type="button"
            onClick={() => update({ genres: [], demographics: [] })}
            className="text-xs text-muted hover:text-foreground"
          >
            limpiar
          </button>
        )}
      </div>

      {filtersOpen && (
        <div className="mb-3 max-h-[60vh] space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-4">
          {DEMOGRAPHICS.some((d) => (demoCount.get(d) ?? 0) > 0) && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                Demografía
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DEMOGRAPHICS.filter((d) => (demoCount.get(d) ?? 0) > 0).map(
                  (d) => {
                    const on = demographics.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          update({
                            demographics: on
                              ? demographics.filter((x) => x !== d)
                              : [...demographics, d],
                          })
                        }
                        className={chipCls(on)}
                      >
                        {d} <span className="opacity-60">{demoCount.get(d)}</span>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Géneros
              </p>
              {genres.length >= 2 && (
                <div className="flex shrink-0 overflow-hidden rounded-full border border-border text-xs">
                  {(["any", "all"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => update({ gmode: m })}
                      className={`px-2.5 py-1 transition ${
                        gmode === m ? "bg-accent text-white" : "text-muted hover:text-foreground"
                      }`}
                    >
                      {m === "any" ? "Cualquiera" : "Todos"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3">
              {GENRE_CATEGORIES.map((cat) => {
                const items = cat.genres
                  .map((g) => ({ g, n: genreCount.get(g) ?? 0 }))
                  .filter((x) => x.n > 0)
                  .sort((a, b) => b.n - a.n);
                if (!items.length) return null;
                return (
                  <div key={cat.category}>
                    <p className="mb-1 text-[11px] text-muted">{cat.category}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map(({ g, n }) => {
                        const on = genres.includes(g);
                        return (
                          <button
                            key={g}
                            type="button"
                            onClick={() =>
                              update({
                                genres: on
                                  ? genres.filter((x) => x !== g)
                                  : [...genres, g],
                              })
                            }
                            className={chipCls(on)}
                          >
                            {g} <span className="opacity-60">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Chips activos (siempre visibles, aun con el panel cerrado). */}
      {(genres.length > 0 || demographics.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {demographics.map((d) => (
            <button
              key={`d-${d}`}
              type="button"
              onClick={() =>
                update({ demographics: demographics.filter((x) => x !== d) })
              }
              className="rounded-full bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-300 transition hover:bg-sky-500/25"
            >
              {d} ✕
            </button>
          ))}
          {genres.map((g) => (
            <button
              key={`g-${g}`}
              type="button"
              onClick={() => update({ genres: genres.filter((x) => x !== g) })}
              className="rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-accent transition hover:bg-accent/25"
            >
              {g} ✕
            </button>
          ))}
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
            const isWished = wishedAny(w.id);
            const wishedFlag = !owned && isWished;
            return (
              <div key={w.id} className="relative">
                <Link
                  href={`/serie/${w.id}`}
                  className={`block rounded-xl border bg-surface p-2 transition hover:border-accent ${
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
                    {(w.national || w.intl) && (
                      <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/60 px-1 py-0.5">
                        {w.national && (
                          <ArgentinaFlag className="h-2.5 w-4 rounded-[1px]" />
                        )}
                        {w.intl && <UsaFlag className="h-2.5 w-4 rounded-[1px]" />}
                      </span>
                    )}
                    {owned && (
                      <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
                        ✓
                      </span>
                    )}
                    {(w.next || w.reissue || (!owned && w.upcoming)) && (
                      <div className="absolute bottom-1 left-1 right-1 flex flex-col gap-0.5">
                        {w.next && (
                          <span className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
                            📅 {w.next.volume ? `#${w.next.volume} · ` : ""}
                            {formatProximaDate(w.next.date)}
                          </span>
                        )}
                        {w.reissue && (
                          <span className="rounded bg-violet-600/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
                            ♻️ {w.reissue.volume ? `#${w.reissue.volume} · ` : ""}
                            {formatProximaDate(w.reissue.date)}
                          </span>
                        )}
                        {!w.next && !w.reissue && !owned && w.upcoming && (
                          <span className="rounded bg-amber-500/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
                            🔜 {formatReleaseLabel(w.releaseLabel) ?? "Próximo a salir"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium">{w.title}</p>
                  <p className="truncate text-xs text-muted">
                    {w.publishers.length ? w.publishers.join(" · ") : emptyPublisher}
                  </p>
                </Link>

                {/* Marcar deseado sin entrar a la serie (fuera del Link). Con
                    varias ediciones abre un modal para elegir cuál. */}
                {canWish && !owned && (
                  <button
                    type="button"
                    aria-label={isWished ? "Editar deseados" : "Agregar a deseados"}
                    onClick={(e) => onHeart(w, e)}
                    className={`absolute right-2 top-2 z-10 rounded-full px-1.5 py-0.5 text-sm leading-none shadow transition ${
                      isWished ? "bg-rose-500 text-white" : "bg-black/55 text-white hover:bg-rose-500"
                    }`}
                  >
                    {isWished ? "❤" : "🤍"}
                  </button>
                )}
              </div>
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

      {/* Modal de selección de edición para deseados (varias ediciones). */}
      {wishModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setWishModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted">Agregar a deseados</p>
                <p className="truncate font-medium">{wishModal.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setWishModal(null)}
                aria-label="Cerrar"
                className="shrink-0 rounded-lg px-2 py-1 text-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <p className="mb-2 text-xs text-muted">Elegí qué edición querés desear:</p>
            <div className="space-y-1.5">
              {editionsOf(wishModal).map((ed) => {
                const isW = wishMap.get(wishModal.id)?.has(ed.key) ?? false;
                return (
                  <button
                    key={ed.key}
                    type="button"
                    onClick={() => toggleEdition(wishModal, ed)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                      isW ? "border-rose-400/60 bg-rose-500/10" : "border-border hover:border-accent"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {ed.region === "INT" ? (
                        <UsaFlag className="h-3 w-4.5 rounded-[1px]" />
                      ) : (
                        <ArgentinaFlag className="h-3 w-4.5 rounded-[1px]" />
                      )}
                      {ed.label}
                    </span>
                    <span className={isW ? "text-rose-400" : "text-muted"}>
                      {isW ? "❤ Deseada" : "🤍"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
