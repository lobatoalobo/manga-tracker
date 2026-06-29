"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  maxVolumes?: number; // tomos de la edición más larga (orden "más tomos")
  finished?: boolean; // serie completa (alguna edición COMPLETA)
  next: { volume: number | null; date: string } | null;
  reissue?: { volume: number | null; date: string } | null;
  editions?: WishEdition[]; // ediciones deseables (para el corazón por edición)
}

export interface BrowseState {
  q: string;
  tab: Tab;
  region: Region;
  pubs: string[]; // editoriales seleccionadas (nombre completo); [] = todas
  sort: Sort;
  completed: boolean; // solo series completas
  genres: string[];
  gmode: GMode;
  demographics: string[];
  page: number;
}

const PER_PAGE = 60;
const TABS = [
  { t: "az", label: "Todo" },
  { t: "series", label: "🔜 Series nuevas" },
  { t: "tomos", label: "📅 Próximos tomos" },
] as const;

// Regiones (split primario). "Series nuevas"/"Próximos" son lentes NACIONALES
// (datos de Ivrea), así que no aplican en Internacional.
const REGIONS = [
  { r: "all", label: "Todo" },
  { r: "ar", label: "🇦🇷 Nacional" },
  { r: "int", label: "🇺🇸 Internacional" },
] as const;

// Orden: dos ejes que ciclan (A-Z y Tomos), cada uno con 3 estados. "none" =
// orden por defecto del server (alfabético). Solo uno activo a la vez.
type Sort = "none" | "az" | "za" | "vols-desc" | "vols-asc";

type Tab = (typeof TABS)[number]["t"];
type Region = (typeof REGIONS)[number]["r"];
type GMode = "all" | "any";

/** Etiqueta corta de editorial para los chips (sin sufijo redundante). */
function pubLabel(p: string): string {
  return p.replace(/\s+(Argentina|Media|Press|Manga|Comics)$/i, "").trim();
}

/** Estilo de chip toggle (género/demografía). */
const chipCls = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs transition ${
    on
      ? "border-accent bg-accent/15 text-accent"
      : "border-border text-muted hover:text-foreground"
  }`;

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
  showSearch = true,
  emptyPublisher = "Ivrea Argentina",
  showGenreFilters = true,
  intlPublishers = [],
  nationalPublishers = [],
  total = 0,
}: {
  cards: BrowseCard[];
  total?: number;
  collected?: number[];
  /** workId → keys de edición deseadas (para el highlight y el modal). */
  wishedMap?: Record<number, string[]>;
  canWish?: boolean;
  initial: BrowseState;
  /** Ruta base para sincronizar la URL (p. ej. "/internacional"). */
  basePath?: string;
  /** Mostrar las pestañas A-Z / Series nuevas / Próximos tomos (catálogo AR). */
  showTabs?: boolean;
  /** Mostrar el buscador (off en la página de autor, donde hay pocas obras). */
  showSearch?: boolean;
  /** Editorial a mostrar cuando una card no trae publishers. */
  emptyPublisher?: string;
  /** Feature flag: mostrar el panel de filtros por género/demografía. */
  showGenreFilters?: boolean;
  /** Editoriales internacionales (para mostrar solo las de la región activa). */
  intlPublishers?: string[];
  /** Editoriales nacionales (para los chips de Editorial en región Nacional). */
  nationalPublishers?: string[];
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
  const router = useRouter();
  const [isPending, startNav] = useTransition();
  // Filtros: el server es la fuente de verdad (props.initial). Cambiar cualquiera
  // NAVEGA (router.push) → re-consulta server-side y vuelve UNA página. Solo el
  // texto de búsqueda es estado local (responsivo) y navega con debounce.
  const { tab, region, pubs, sort, completed, genres, gmode, demographics, page } = initial;
  const [q, setQ] = useState(initial.q);
  const [filtersOpen, setFiltersOpen] = useState(false);

  function urlFor(next: BrowseState): string {
    const params = new URLSearchParams();
    if (next.tab !== "az") params.set("tab", next.tab);
    if (next.region !== "all") params.set("region", next.region);
    if (next.pubs.length) params.set("pubs", next.pubs.join(","));
    if (next.sort !== "none") params.set("sort", next.sort);
    if (next.completed) params.set("completed", "1");
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.genres.length) params.set("genres", next.genres.join(","));
    if (next.genres.length > 1 && next.gmode === "all") params.set("gmode", "all");
    if (next.demographics.length) params.set("demo", next.demographics.join(","));
    if (next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  }

  const activeTab: Tab = tab;
  // Próximo tomo/reedición/preventa salen de Ivrea → señales NACIONALES. En INT no
  // aplican todavía (no hay próximos de VIZ): no se muestran.
  const nationalCtx = region !== "int";

  // Editoriales para los chips, scopeadas a la región (sin conteo: server-side).
  const pubOptions =
    region === "int"
      ? intlPublishers
      : region === "ar"
        ? nationalPublishers
        : [...nationalPublishers, ...intlPublishers];

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const cur = Math.min(Math.max(1, page), pageCount);

  // Aplica un patch y NAVEGA (server re-consulta). Resetea a página 1 salvo que sea
  // paginación (keepPage). El texto `q` vivo se preserva en la base.
  function update(patch: Partial<BrowseState>, keepPage = false) {
    const base: BrowseState = { q, tab, region, pubs, sort, completed, genres, gmode, demographics, page };
    const next: BrowseState = { ...base, ...(keepPage ? {} : { page: 1 }), ...patch };
    startNav(() => router.push(urlFor(next), { scroll: false }));
  }

  // Búsqueda: debounce → navega 350ms después de dejar de tipear. El guard evita
  // re-navegar cuando el texto ya coincide con el del server (post-navegación).
  useEffect(() => {
    if (q === initial.q) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, initial.q]);

  // Cambiar de región: resetea las editoriales (pueden no existir en la otra).
  function setRegionTo(r: Region) {
    update({ region: r, pubs: [] });
  }
  function togglePub(p: string) {
    update({ pubs: pubs.includes(p) ? pubs.filter((x) => x !== p) : [...pubs, p] });
  }
  function goPage(p: number) {
    update({ page: p }, true);
    window.scrollTo({ top: 0 });
  }

  // El panel de Filtros agrupa Editorial (siempre en el catálogo) + Orden, y
  // Demografía/Género detrás de la flag. Editorial es multi-select y se scopea a
  // la región, así no existe el cruce raro (ej. "Nacional + VIZ").
  const showEditorial = showTabs && pubOptions.length > 1;
  const showFilters = showEditorial || showTabs || showGenreFilters;
  const activeFilterCount =
    pubs.length +
    (completed ? 1 : 0) +
    (showGenreFilters ? genres.length + demographics.length : 0);

  return (
    <>
      {showSearch && (
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar obra o autor…"
        autoComplete="off"
        className="mb-3 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />
      )}

      {showTabs && (
        <>
          {/* Región: split primario (Todo / Nacional / Internacional). */}
          <div className="mb-2 inline-flex rounded-xl border border-border bg-surface-2 p-1 text-sm">
            {REGIONS.map(({ r, label }) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegionTo(r)}
                className={`rounded-lg px-3 py-1 font-medium transition ${
                  region === r ? "bg-accent text-white" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Lentes: misma barra segmentada que Región (Todo / Series / Próximos). */}
          <div className="mb-2 inline-flex rounded-xl border border-border bg-surface-2 p-1 text-sm">
            {TABS.map(({ t, label }) => (
              <button
                key={t}
                type="button"
                onClick={() => update({ tab: t })}
                className={`rounded-lg px-3 py-1 font-medium transition ${
                  activeTab === t ? "bg-accent text-white" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Orden: dos botones que CICLAN (fuera del dropdown). A-Z: A-Z→Z-A→off.
              Tomos: ↑ (más)→↓ (menos)→off. Solo uno activo a la vez. */}
          {activeTab !== "series" && (
            <div className="mb-2 flex flex-wrap gap-1.5 text-sm">
              <button
                type="button"
                onClick={() =>
                  update({ sort: sort === "az" ? "za" : sort === "za" ? "none" : "az" })
                }
                className={chipCls(sort === "az" || sort === "za")}
              >
                {sort === "za" ? "Z-A" : "A-Z"}
              </button>
              {/* Sort por tomos: diferido (necesita denormalizar maxVolumes). */}
            </div>
          )}
        </>
      )}

      {/* Filtros: panel colapsable. Editorial + Orden (catálogo) y Demografía/
          Género (detrás de la flag `genre-filters`). */}
      {showFilters && (
      <div className="mb-2 flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="rounded-full border border-border bg-surface-2 px-3 py-1 transition hover:text-foreground"
        >
          Filtros
          {activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}{" "}
          {filtersOpen ? "▲" : "▾"}
        </button>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() =>
              update({ pubs: [], completed: false, genres: [], demographics: [] })
            }
            className="text-xs text-muted hover:text-foreground"
          >
            limpiar
          </button>
        )}
      </div>
      )}

      {showFilters && filtersOpen && (
        <div className="mb-3 max-h-[60vh] space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-4">
          {showEditorial && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                Editorial
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pubOptions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePub(p)}
                    className={chipCls(pubs.includes(p))}
                  >
                    {pubLabel(p)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showTabs && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                Estado
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => update({ completed: !completed })}
                  className={chipCls(completed)}
                >
                  Completas
                </button>
              </div>
            </div>
          )}

          {showGenreFilters && (
            <>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Demografía
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEMOGRAPHICS.map((d) => {
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
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

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
              {GENRE_CATEGORIES.map((cat) => (
                <div key={cat.category}>
                  <p className="mb-1 text-[11px] text-muted">{cat.category}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.genres.map((g) => {
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
                          {g}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {/* Chips activos (siempre visibles, aun con el panel cerrado). */}
      {(pubs.length > 0 ||
        completed ||
        (showGenreFilters && (genres.length > 0 || demographics.length > 0))) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {pubs.map((p) => (
            <button
              key={`p-${p}`}
              type="button"
              onClick={() => togglePub(p)}
              className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/25"
            >
              {pubLabel(p)} ✕
            </button>
          ))}
          {completed && (
            <button
              type="button"
              onClick={() => update({ completed: false })}
              className="rounded-full bg-teal-500/15 px-3 py-1 text-xs font-medium text-teal-300 transition hover:bg-teal-500/25"
            >
              Completas ✕
            </button>
          )}
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

      {cards.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No hay series para esa búsqueda.
        </p>
      ) : (
        <div
          className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 ${
            isPending ? "opacity-50" : ""
          }`}
        >
          {cards.map((w) => {
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
                    {nationalCtx && (w.next || w.reissue || (!owned && w.upcoming)) && (
                      <div className="absolute bottom-1 left-1 right-1 flex flex-col gap-0.5">
                        {/* En "Todo" (mixto) marcamos la región del evento. Hoy todos
                            los próximos son nacionales (Ivrea) → 🇦🇷; cuando exista
                            data de próximos de VIZ, será data-driven (ver viz-proximos). */}
                        {w.next && (
                          <span className="inline-flex items-center justify-center gap-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {region === "all" && (
                              <ArgentinaFlag className="h-2.5 w-3.5 shrink-0 rounded-[1px]" />
                            )}
                            📅 {w.next.volume ? `#${w.next.volume} · ` : ""}
                            {formatProximaDate(w.next.date)}
                          </span>
                        )}
                        {w.reissue && (
                          <span className="inline-flex items-center justify-center gap-1 rounded bg-violet-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {region === "all" && (
                              <ArgentinaFlag className="h-2.5 w-3.5 shrink-0 rounded-[1px]" />
                            )}
                            ♻️ {w.reissue.volume ? `#${w.reissue.volume} · ` : ""}
                            {formatProximaDate(w.reissue.date)}
                          </span>
                        )}
                        {!w.next && !w.reissue && !owned && w.upcoming && (
                          <span className="inline-flex items-center justify-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {region === "all" && (
                              <ArgentinaFlag className="h-2.5 w-3.5 shrink-0 rounded-[1px]" />
                            )}
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
      <p className="mt-2 text-center text-xs text-muted">{total} obras</p>

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
