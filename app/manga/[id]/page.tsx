import { getMangaFromCollection } from "@/lib/collection";
import { getMangaDetails } from "@/lib/getMangaDetails";
import AddEditionButton from "@/components/AddEditionButton";
import MangaCollectionSection from "@/components/MangaCollectionSection";
import ReportButton from "@/components/ReportButton";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mangaId = Number(id);

  const inCollection = await getMangaFromCollection(mangaId);

  const details = await getMangaDetails(mangaId, inCollection?.editionSlug);
  const { anilist, editions, muVolumes } = details;

  const japanVolumes = editions.find((e) => e.region === "JP")?.volumes ?? null;

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

      {/* Ediciones disponibles */}
      <section className="mt-6">
        <h2 className="mb-1 text-lg font-semibold">Ediciones</h2>
        {!inCollection && editions.length > 0 && (
          <p className="mb-3 text-sm text-muted">
            Elegí qué edición coleccionás para trackearla.
          </p>
        )}
        {editions.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {editions.map((ed) => {
              const isTracked =
                !!inCollection &&
                (ed.publisher ?? ed.source) === inCollection.publisher;

              return (
              <div
                key={ed.id}
                className={`flex flex-col rounded-xl border bg-surface p-4 ${
                  isTracked ? "border-accent" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{ed.source}</span>
                  <div className="flex items-center gap-2">
                    {isTracked && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">
                        ✓ Trackeando
                      </span>
                    )}
                    <RegionBadge region={ed.region} />
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <Field label="Tomos" value={ed.volumes || "—"} />
                  <Field label="Estado" value={ed.status} />
                  {ed.nextVolume ? (
                    <Field label="Próximo tomo" value={`#${ed.nextVolume}`} />
                  ) : null}
                </dl>
                {ed.note && (
                  <p className="mt-2 text-xs text-muted">{ed.note}</p>
                )}
                {ed.url && (
                  <a
                    href={ed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block text-xs text-accent hover:underline"
                  >
                    Ver en {ed.publisher} ↗
                  </a>
                )}
                {!inCollection && (
                  <div className="mt-auto">
                    <AddEditionButton
                      manga={anilist}
                      edition={ed}
                      muVolumes={muVolumes}
                      japanVolumes={japanVolumes}
                    />
                  </div>
                )}
              </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No encontramos ediciones para esta serie.
          </p>
        )}
      </section>

      {anilist.description && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {anilist.description}
        </p>
      )}

      {inCollection && <MangaCollectionSection manga={inCollection} />}

      <ReportButton mangaId={mangaId} mangaTitle={anilist.title.romaji} />
    </main>
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

function RegionBadge({ region }: { region: "AR" | "JP" | "INT" }) {
  const map: Record<string, { label: string; className: string }> = {
    AR: { label: "🇦🇷 Argentina", className: "bg-sky-500/15 text-sky-300" },
    JP: { label: "🇯🇵 Japón", className: "bg-rose-500/15 text-rose-300" },
    INT: { label: "🌎 Internacional", className: "bg-emerald-500/15 text-emerald-300" },
  };
  const { label, className } = map[region] ?? map.INT;

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
