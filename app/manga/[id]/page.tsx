import { Suspense } from "react";
import { getMangaFromCollection } from "@/lib/collection";
import { getMangaCore } from "@/lib/getMangaDetails";
import MangaCollectionSection from "@/components/MangaCollectionSection";
import ReportButton from "@/components/ReportButton";
import EditionsSection from "./EditionsSection";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mangaId = Number(id);

  // Camino rápido: AniList (1 request) + colección (DB). Las editoriales (lento)
  // se resuelven en <Suspense> y se streamean, sin bloquear el render inicial.
  const [anilist, inCollection] = await Promise.all([
    getMangaCore(mangaId),
    getMangaFromCollection(mangaId),
  ]);

  const authors = anilist.staff.map((a: { name: string }) => a.name).join(", ");

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={anilist.coverImage}
          alt={anilist.title.romaji}
          className="h-72 w-48 shrink-0 self-start rounded-xl object-cover"
        />

        <div className="flex-1">
          <h1 className="text-2xl font-bold">{anilist.title.romaji}</h1>
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
            <Field label="Autor" value={authors || "Sin datos"} />
            <Field label="Score" value={anilist.averageScore ? `${anilist.averageScore}/100` : "—"} />
            <Field label="Estado" value={anilist.status} />
            <Field label="Popularidad" value={anilist.popularity ?? "—"} />
          </dl>
        </div>
      </div>

      {/* Si ya está en la colección, la grilla de tomos se muestra al instante
          (desde la DB), sin esperar a las editoriales. */}
      {inCollection && <MangaCollectionSection manga={inCollection} />}

      {/* Ediciones (lento): se streamean con Suspense. */}
      <section className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Ediciones</h2>
        {!inCollection && (
          <p className="mb-3 text-sm text-muted">
            Elegí qué edición coleccionás para trackearla.
          </p>
        )}
        <Suspense fallback={<EditionsSkeleton />}>
          <EditionsSection
            anilist={anilist}
            knownSlug={inCollection?.editionSlug}
            trackedPublisher={inCollection?.publisher ?? null}
            inCollection={!!inCollection}
          />
        </Suspense>
      </section>

      {anilist.description && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {anilist.description}
        </p>
      )}

      <ReportButton mangaId={mangaId} mangaTitle={anilist.title.romaji} />
    </main>
  );
}

function EditionsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-xl border border-border bg-surface"
        />
      ))}
    </div>
  );
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
