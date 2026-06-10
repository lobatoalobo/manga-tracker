import { Suspense } from "react";
import { auth } from "@/auth";
import { getSeries } from "@/lib/collection";
import { getMangaCore } from "@/lib/getMangaDetails";
import type { ReadingLink } from "@/lib/normalizeAnilist";
import TrackingPanel from "@/components/TrackingPanel";
import ReportButton from "@/components/ReportButton";
import EditionsSection from "./EditionsSection";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const { id } = await params;
  const mangaId = Number(id);

  const [anilist, series] = await Promise.all([
    getMangaCore(mangaId),
    userId ? getSeries(userId, mangaId) : Promise.resolve(null),
  ]);

  const canTrack = !!userId;
  const trackedKeys = series?.editions.map((e) => e.key) ?? [];
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

      {anilist.description && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {anilist.description}
        </p>
      )}

      {/* Ediciones (arriba): elegí cuáles trackear. Se streamean con Suspense. */}
      <section className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Ediciones</h2>
        <p className="mb-3 text-sm text-muted">
          Trackeá una o varias ediciones; abajo marcás los tomos de cada una.
        </p>
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
          className="h-40 animate-pulse rounded-xl border border-border bg-surface"
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
