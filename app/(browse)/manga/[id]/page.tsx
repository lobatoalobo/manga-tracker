import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getSeries } from "@/lib/collection";
import { getMangaCore } from "@/lib/getMangaDetails";
import { workMetaByAnilist } from "@/lib/catalog";
import { isWished } from "@/lib/wishlist";
import { getNote, getSeriesNotes } from "@/lib/notes";
import { displayTitle } from "@/lib/title";
import { isAdmin } from "@/lib/admin";
import {
  getCrumbQuery,
  crumbDefaultTitle,
  getEditionsForSeries,
  getExcludedPublishers,
} from "@/lib/storeLinks";
import type { ReadingLink } from "@/lib/normalizeAnilist";
import AdminStoreLinks from "@/components/AdminStoreLinks";
import TrackingPanel from "@/components/TrackingPanel";
import ReportButton from "@/components/ReportButton";
import WishButton from "@/components/WishButton";
import NoteEditor from "@/components/NoteEditor";
import { SignIn } from "@/components/AuthButtons";
import EditionsSection from "./EditionsSection";
import CrumbBuyButton from "./CrumbBuyButton";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const { id } = await params;
  const mangaId = Number(id);

  // Si el id no existe en AniList (mapeo viejo/roto), 404 en vez de 500.
  const anilist = await getMangaCore(mangaId).catch(() => null);
  if (!anilist) notFound();

  const [series, wished, note, reviews, workMeta] = await Promise.all([
    userId ? getSeries(userId, mangaId) : Promise.resolve(null),
    userId ? isWished(userId, mangaId) : Promise.resolve(false),
    userId ? getNote(userId, mangaId) : Promise.resolve(null),
    getSeriesNotes(mangaId),
    workMetaByAnilist(mangaId).catch(() => null),
  ]);

  // Para coleccionistas locales: si tenemos la portada de la edición nacional
  // (del catálogo), la preferimos a la japonesa de AniList.
  const cover = workMeta?.coverImage ?? anilist.coverImage;
  // Sinopsis local-first: preferimos la nuestra (Whakoom/Ivrea, en español) y
  // caemos a la de AniList solo si todavía no la tenemos. AniList se usa para
  // los extras (géneros, personajes, relaciones, score).
  const synopsis = workMeta?.synopsis ?? anilist.description;
  // "Próximo a salir": flag manual (preventa AR) o estado global no-publicado.
  const upcoming = workMeta?.upcoming || anilist.status === "NOT_YET_RELEASED";

  // Contenido +18 solo para usuarios logueados.
  if (anilist.isAdult && !userId) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center">
        <h1 className="text-2xl font-bold">Contenido +18</h1>
        <p className="mt-3 text-muted">
          Esta serie tiene contenido adulto. Iniciá sesión para verla.
        </p>
        <div className="mt-6">
          <SignIn />
        </div>
      </main>
    );
  }

  const canTrack = !!userId;
  const trackedKeys = series?.editions.map((e) => e.key) ?? [];
  const title = displayTitle(anilist.title);

  // Panel admin para tunear los links de tienda (Crumb / OvniPress).
  const admin = isAdmin(session?.user?.email);
  const adminStore = admin
    ? await (async () => {
        const [override, def, editions, excluded] = await Promise.all([
          getCrumbQuery(mangaId),
          crumbDefaultTitle(mangaId),
          getEditionsForSeries(mangaId),
          getExcludedPublishers(mangaId),
        ]);
        return { crumbInitial: override ?? def ?? "", editions, excluded };
      })()
    : null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover}
          alt={title}
          className="h-72 w-48 shrink-0 self-start rounded-xl object-cover"
        />

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            {upcoming && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                🔜 Próximo a salir
              </span>
            )}
          </div>
          {anilist.title.romaji && anilist.title.romaji !== title && (
            <p className="text-sm text-muted">{anilist.title.romaji}</p>
          )}
          {anilist.title.native && (
            <p className="text-muted">{anilist.title.native}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {anilist.genres?.map((g: string) => (
              <span
                key={g}
                className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted"
              >
                {g}
              </span>
            ))}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Autor</dt>
              <dd className="font-medium">
                {anilist.staff.length > 0
                  ? dedupeStaff(anilist.staff).map(
                      (s: { id: number; name: string }, i: number) => (
                        <span key={s.id}>
                          {i > 0 && ", "}
                          <Link
                            href={`/autor/${s.id}`}
                            className="hover:text-accent hover:underline"
                          >
                            {s.name}
                          </Link>
                        </span>
                      ),
                    )
                  : "Sin datos"}
              </dd>
            </div>
            <Field label="Score" value={anilist.averageScore ? `${anilist.averageScore}/100` : "—"} />
            <Field
              label="Estado"
              value={translateStatus(anilist.status)}
            />
            <Field label="Popularidad" value={anilist.popularity ?? "—"} />
          </dl>

          {anilist.assistants?.length > 0 && (
            <div className="mt-2 text-sm">
              <dt className="text-xs text-muted">Asistentes</dt>
              <dd className="font-medium">
                {dedupeStaff(anilist.assistants).map(
                  (s: { id: number; name: string }, i: number) => (
                    <span key={s.id}>
                      {i > 0 && ", "}
                      <Link
                        href={`/autor/${s.id}`}
                        className="hover:text-accent hover:underline"
                      >
                        {s.name}
                      </Link>
                    </span>
                  ),
                )}
              </dd>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canTrack && (
              <WishButton
                anilistId={mangaId}
                title={title}
                coverImage={cover}
                initialWished={wished}
              />
            )}
            <Suspense fallback={null}>
              <CrumbBuyButton anilist={anilist} />
            </Suspense>
          </div>

          {adminStore && (
            <div className="mt-3">
              <AdminStoreLinks
                anilistId={mangaId}
                seriesTitle={title}
                crumbInitial={adminStore.crumbInitial}
                editions={adminStore.editions}
                excludedPublishers={adminStore.excluded}
                defaultVolumes={anilist.volumes ?? 0}
                upcoming={workMeta?.upcoming ?? false}
              />
            </div>
          )}
        </div>
      </div>

      {synopsis && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {synopsis}
        </p>
      )}

      {/* Ediciones (arriba): elegí cuáles trackear. Se streamean con Suspense. */}
      <section className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Ediciones</h2>
        {canTrack && (
          <p className="mb-3 text-sm text-muted">
            Trackeá una o varias ediciones; abajo marcás los tomos de cada una.
          </p>
        )}
        <Suspense fallback={<EditionsSkeleton />}>
          <EditionsSection
            anilist={anilist}
            trackedKeys={trackedKeys}
            canTrack={canTrack}
          />
        </Suspense>
      </section>

      {/* Panel de tomos de la edición seleccionada (remonta si cambian las ediciones). */}
      {series && series.editions.length > 0 && (
        <TrackingPanel
          key={trackedKeys.slice().sort().join("|")}
          anilistId={mangaId}
          title={title}
          editions={series.editions}
        />
      )}

      {anilist.readingLinks.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-1 text-lg font-semibold">Leer online</h2>
          <p className="mb-3 text-sm text-muted">
            Lectores oficiales de las editoriales/plataformas.
          </p>
          <div className="flex flex-wrap gap-2">
            {anilist.readingLinks.map((l: ReadingLink, i: number) => (
              <a
                key={`${l.site}-${i}`}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition hover:border-accent"
              >
                {l.site}
                {l.language && (
                  <span className="ml-1 text-xs text-muted">· {l.language}</span>
                )}{" "}
                ↗
              </a>
            ))}
          </div>
        </section>
      )}

      {anilist.relations?.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Relacionados</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[...anilist.relations]
              // Mangas primero (son los navegables dentro de la app), después anime.
              .sort(
                (a: SeriesRelation, b: SeriesRelation) =>
                  (a.mediaType === "MANGA" ? 0 : 1) -
                  (b.mediaType === "MANGA" ? 0 : 1),
              )
              .slice(0, 12)
              .map((r: SeriesRelation) => {
              const rTitle = displayTitle(r.title);
              const card = (
                <>
                  <div className="aspect-2/3 w-full overflow-hidden rounded-lg bg-surface-2">
                    {r.coverImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.coverImage}
                        alt={rTitle}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    )}
                  </div>
                  <span className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-accent">
                    {relationLabel(r.relationType)}
                    {r.mediaType === "ANIME" ? " · Anime" : ""}
                  </span>
                  <p className="truncate text-xs font-medium" title={rTitle}>
                    {rTitle}
                  </p>
                </>
              );
              // El manga relacionado linkea a su ficha nuestra; el anime queda
              // como card informativa SIN link (no mandamos a AniList y no
              // tenemos páginas de anime).
              return r.mediaType === "MANGA" ? (
                <Link
                  key={`${r.mediaType}-${r.id}`}
                  href={`/manga/${r.id}`}
                  className="group block"
                >
                  {card}
                </Link>
              ) : (
                <div key={`${r.mediaType}-${r.id}`} className="group block">
                  {card}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {anilist.characters?.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Personajes</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {anilist.characters
              .slice(0, 12)
              .map((c: { name: string; image: string; role: string }, i: number) => (
                <div key={i} className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.image}
                    alt={c.name}
                    className="aspect-square w-full rounded-lg bg-surface-2 object-cover"
                  />
                  <p className="mt-1 truncate text-xs font-medium" title={c.name}>
                    {c.name}
                  </p>
                  <p className="text-[10px] text-muted">{characterRole(c.role)}</p>
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">
          Opiniones {reviews.length > 0 && `(${reviews.length})`}
        </h2>

        {canTrack && (
          <NoteEditor
            anilistId={mangaId}
            initialRating={note?.rating ?? null}
            initialNote={note?.note ?? null}
          />
        )}

        {reviews.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Todavía no hay opiniones de esta serie.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reviews.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-center gap-2">
                  {r.userImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.userImage}
                      alt={r.userName}
                      className="h-6 w-6 rounded-full"
                    />
                  )}
                  <span className="text-sm font-medium">{r.userName}</span>
                  {r.rating ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                      ★ {r.rating}/10
                    </span>
                  ) : null}
                </div>
                {r.note && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                    {r.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReportButton mangaId={mangaId} mangaTitle={title} />
    </main>
  );
}

function EditionsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-xl border border-border bg-surface"
        />
      ))}
    </div>
  );
}

interface SeriesRelation {
  relationType: string;
  id: number;
  mediaType: string;
  format: string | null;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  coverImage: string | null;
}

const RELATION_LABELS: Record<string, string> = {
  SEQUEL: "Secuela",
  PREQUEL: "Precuela",
  SIDE_STORY: "Historia paralela",
  SPIN_OFF: "Spin-off",
  PARENT: "Obra principal",
  ADAPTATION: "Adaptación",
  ALTERNATIVE: "Versión alternativa",
  CHARACTER: "Personajes en común",
  SUMMARY: "Resumen",
  CONTAINS: "Incluye",
  OTHER: "Relacionado",
};

function relationLabel(type: string): string {
  return RELATION_LABELS[type] ?? "Relacionado";
}

function characterRole(role: string): string {
  switch (role) {
    case "MAIN":
      return "Protagonista";
    case "SUPPORTING":
      return "Secundario";
    case "BACKGROUND":
      return "Secundario";
    default:
      return "";
  }
}

function dedupeStaff(staff: { id: number; name: string }[]) {
  const seen = new Set<number>();
  return staff.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

function translateStatus(status?: string | null): string {
  switch (status) {
    case "RELEASING":
      return "En curso";
    case "FINISHED":
      return "Finalizado";
    case "HIATUS":
      return "En pausa";
    case "CANCELLED":
      return "Cancelado";
    case "NOT_YET_RELEASED":
      return "No publicado";
    default:
      return status ?? "—";
  }
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium">{value ?? "—"}</dd>
    </div>
  );
}
