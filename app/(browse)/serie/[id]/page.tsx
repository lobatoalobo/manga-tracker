import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getSeries } from "@/lib/collection";
import AdminWorkEdit from "@/components/AdminWorkEdit";
import ExpandableText from "@/components/ExpandableText";
import { isWished } from "@/lib/wishlist";
import { crumbSearch } from "@/lib/crumb";
import { getCrumbQuery } from "@/lib/storeLinks";
import { formatReleaseLabel, formatProximaDate } from "@/lib/releaseDate";
import AddEditionButton from "@/components/AddEditionButton";
import WishButton from "@/components/WishButton";
import TrackingPanel from "@/components/TrackingPanel";
import { SignIn } from "@/components/AuthButtons";
import type { Edition } from "@/lib/editions";

export const metadata = { title: "Serie · Nakama" };

const PUB_KEY: Record<string, string> = {
  "Ivrea Argentina": "ivrea",
  "Panini Argentina": "panini",
  "Ovni Press": "ovni",
  "Kemuri Ediciones": "kemuri",
  "Utopía Editorial": "utopia",
  "Larp Editores": "larp",
  "Distrito Manga": "distrito",
  "Planeta Cómic": "planeta",
};

/**
 * Detalle de una obra del catálogo LOCAL (`Work`), sin AniList. Generaliza el
 * patrón de `/nacional/[id]` (per-edición) a una vista per-Work con TODAS sus
 * ediciones y la colección.
 *
 * Colección por `workId`: reusamos la maquinaria existente con un id sintético
 * `-workId` (mismo enfoque que /nacional con `-editionId`), sin tocar el esquema.
 * Ver docs/plan-catalogo-local.md.
 */
export default async function SeriePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workId = Number(id);
  if (!workId) notFound();

  const work = await prisma.work.findUnique({
    where: { id: workId },
    include: { editions: { orderBy: [{ publisher: "asc" }, { title: "asc" }] } },
  });
  if (!work) {
    // Compat transición: un id que no es work puede ser una edición vieja
    // (esquema -editionId de /nacional) → redirigir a su work.
    const ed = await prisma.publisherEdition.findUnique({
      where: { id: workId },
      select: { workId: true },
    });
    if (ed?.workId) redirect(`/serie/${ed.workId}`);
    notFound();
  }

  // Próxima salida (no reedición) por edición, desde el snapshot de Ivrea.
  const editionIds = work.editions.map((e) => e.id);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const releases = editionIds.length
    ? await prisma.ivreaRelease.findMany({
        where: {
          editionId: { in: editionIds },
          kind: { not: "reissue" },
          releaseDate: { gte: today },
        },
        orderBy: { releaseDate: "asc" },
        select: { editionId: true, volume: true, releaseDate: true },
      })
    : [];
  const nextByEdition = new Map<number, { volume: number | null; date: Date }>();
  for (const r of releases) {
    if (r.editionId == null || !r.releaseDate || nextByEdition.has(r.editionId))
      continue;
    nextByEdition.set(r.editionId, { volume: r.volume, date: r.releaseDate });
  }

  const { title, coverImage, author, synopsis, genres } = work;
  // Nacional = edición de editorial argentina (PUB_KEY) o debut/próxima de Ivrea
  // (sin edición cargada aún). A futuro, las internacionales no llevarán el chip.
  const national =
    work.upcoming || work.editions.some((e) => PUB_KEY[e.publisher] != null);

  // Colección: id sintético negativo por workId (no choca con ids de AniList).
  const pseudoId = -workId;
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const series = userId ? await getSeries(userId, pseudoId) : null;
  const wished = userId ? await isWished(userId, pseudoId) : false;
  const trackedKeys = series?.editions.map((e) => e.key) ?? [];
  const admin = isAdmin(session?.user?.email);
  // Override admin del término de búsqueda de Crumb (keyeado por el id local).
  const crumbQuery = (await getCrumbQuery(pseudoId)) ?? title;

  // Llave estable por edición (publisher; desambigua si se repite la editorial).
  const seenKeys = new Set<string>();
  const editionKey = (publisher: string, edId: number) => {
    const base = PUB_KEY[publisher] ?? `ed${edId}`;
    if (!seenKeys.has(base)) {
      seenKeys.add(base);
      return base;
    }
    return `${base}-${edId}`;
  };

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        {coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImage}
            alt={title}
            className="h-72 w-48 shrink-0 self-start rounded-xl object-cover"
          />
        )}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            {national && (
              <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                🇦🇷 Edición nacional
              </span>
            )}
            {work.upcoming && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                🔜 Próximo a salir
                {formatReleaseLabel(work.releaseLabel) &&
                  ` · ${formatReleaseLabel(work.releaseLabel)}`}
              </span>
            )}
          </div>

          {author && (
            <p className="mt-1 text-sm text-muted">
              {author
                .split(/,|&| y /i)
                .map((a) => a.trim())
                .filter(Boolean)
                .map((a, i) => (
                  <span key={a}>
                    {i > 0 && ", "}
                    <Link
                      href={`/autores/${encodeURIComponent(a)}`}
                      className="transition hover:text-accent hover:underline"
                    >
                      {a}
                    </Link>
                  </span>
                ))}
            </p>
          )}

          {genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {genres.map((g) => (
                <Link
                  key={g}
                  href={`/catalogo?genre=${encodeURIComponent(g)}`}
                  className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted transition hover:bg-accent/20 hover:text-accent"
                >
                  {g}
                </Link>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {userId ? (
              <WishButton
                anilistId={pseudoId}
                title={title}
                coverImage={coverImage ?? ""}
                initialWished={wished}
              />
            ) : (
              <SignIn className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90" />
            )}
            <a
              href={crumbSearch(crumbQuery)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
            >
              🛒 Comprar en Crumb
            </a>
          </div>

          {/* Ediciones de la obra (todas las editoriales). */}
          <div className="mt-5 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Ediciones
            </h2>
            {work.editions.length === 0 && (
              // Debut sin ficha aún: sabemos que es de Ivrea. Mostramos la card
              // con "Trackear" deshabilitado; se habilita al salir el 1er tomo.
              <div className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">Ivrea Argentina</span>
                  <span className="text-sm text-muted">
                    Próximamente
                    {formatReleaseLabel(work.releaseLabel)
                      ? ` · ${formatReleaseLabel(work.releaseLabel)}`
                      : ""}
                  </span>
                </div>
                <button
                  disabled
                  title="Se habilita cuando salga el primer tomo"
                  className="mt-3 w-full cursor-not-allowed rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted opacity-50"
                >
                  + Trackear (cuando salga)
                </button>
              </div>
            )}
            {work.editions.map((e) => {
              const next = nextByEdition.get(e.id);
              const key = editionKey(e.publisher, e.id);
              const edition: Edition = {
                id: key,
                source: e.publisher,
                region: "AR",
                publisher: e.publisher,
                slug: e.slug,
                status: e.status || "EN CATÁLOGO",
                volumes: e.volumes,
                nextVolume: next?.volume ?? null,
                url: e.url,
              };
              return (
                <div
                  key={e.id}
                  className="rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium">{e.publisher}</span>
                    <span className="text-sm text-muted">
                      {e.volumes > 0 ? `${e.volumes} tomos` : "Sin tomos aún"}
                      {e.status ? ` · ${e.status.toLowerCase()}` : ""}
                    </span>
                  </div>
                  {next && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      📅 Próximo tomo
                      {next.volume ? ` #${next.volume}` : ""} ·{" "}
                      {formatProximaDate(next.date)}
                    </p>
                  )}
                  {userId && (
                    <AddEditionButton
                      anilist={{
                        id: pseudoId,
                        title: { romaji: title, english: null, native: null },
                        coverImage: coverImage ?? "",
                        volumes: e.volumes,
                      }}
                      edition={edition}
                      isTracked={trackedKeys.includes(key)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {admin && (
            <AdminWorkEdit
              workId={work.id}
              pseudoId={pseudoId}
              title={title}
              author={author ?? ""}
              synopsis={synopsis ?? ""}
              coverImage={coverImage ?? ""}
              genres={genres}
              upcoming={work.upcoming}
              releaseLabel={work.releaseLabel ?? ""}
              crumbInitial={crumbQuery}
            />
          )}
        </div>
      </div>

      {synopsis ? (
        <ExpandableText text={synopsis} />
      ) : work.upcoming ? (
        <p className="mt-6 text-sm text-muted">
          📅 La sinopsis y los datos completos se cargan cuando sale la serie.
        </p>
      ) : null}

      {series && series.editions.length > 0 && (
        <TrackingPanel
          key={trackedKeys.slice().sort().join("|")}
          anilistId={pseudoId}
          title={title}
          editions={series.editions}
        />
      )}
    </main>
  );
}
