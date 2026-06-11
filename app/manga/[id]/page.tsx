import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { getSeries } from "@/lib/collection";
import { getMangaCore } from "@/lib/getMangaDetails";
import { isWished } from "@/lib/wishlist";
import { getNote, getSeriesNotes } from "@/lib/notes";
import type { ReadingLink } from "@/lib/normalizeAnilist";
import TrackingPanel from "@/components/TrackingPanel";
import ReportButton from "@/components/ReportButton";
import WishButton from "@/components/WishButton";
import NoteEditor from "@/components/NoteEditor";
import { SignIn } from "@/components/AuthButtons";
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

  const [anilist, series, wished, note, reviews] = await Promise.all([
    getMangaCore(mangaId),
    userId ? getSeries(userId, mangaId) : Promise.resolve(null),
    userId ? isWished(userId, mangaId) : Promise.resolve(false),
    userId ? getNote(userId, mangaId) : Promise.resolve(null),
    getSeriesNotes(mangaId),
  ]);

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
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{anilist.title.romaji}</h1>
            {anilist.status === "HIATUS" && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                ⏸ En pausa
              </span>
            )}
          </div>
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
            <Field label="Estado" value={translateStatus(anilist.status)} />
            <Field label="Popularidad" value={anilist.popularity ?? "—"} />
          </dl>

          {canTrack && (
            <WishButton
              anilistId={mangaId}
              title={anilist.title.romaji}
              coverImage={anilist.coverImage}
              initialWished={wished}
            />
          )}
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
