import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatReleaseLabel, formatProximaDate } from "@/lib/releaseDate";

export const metadata = { title: "Serie · Nakama" };

/**
 * Detalle de una obra del catálogo LOCAL (`Work`), sin AniList. Generaliza el
 * patrón de `/nacional/[id]` (que es per-edición) a una vista per-Work que
 * muestra TODAS sus ediciones. Es la base del read-path local: en runtime lee
 * solo de nuestra DB.
 *
 * (La colección/tracking por `workId` y el browse local llegan en pasos
 * siguientes del rebuild; ver docs/plan-catalogo-local.md.)
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
  if (!work) notFound();

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
            {work.upcoming && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                🔜 Próximo a salir
                {formatReleaseLabel(work.releaseLabel) &&
                  ` · ${formatReleaseLabel(work.releaseLabel)}`}
              </span>
            )}
          </div>

          {author && <p className="mt-1 text-sm text-muted">{author}</p>}

          {genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Ediciones de la obra (todas las editoriales). */}
          <div className="mt-5 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Ediciones
            </h2>
            {work.editions.length === 0 && (
              <p className="text-sm text-muted">Sin ediciones cargadas.</p>
            )}
            {work.editions.map((e) => {
              const next = nextByEdition.get(e.id);
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
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {synopsis && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {synopsis}
        </p>
      )}
    </main>
  );
}
