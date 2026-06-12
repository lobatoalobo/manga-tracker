import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getIvreaDataBySlug } from "@/lib/providers/ivrea";

export const metadata = { title: "Edición nacional · Nakama" };

/**
 * Página de una obra que existe en el catálogo nacional (Ivrea) pero NO en
 * AniList (cómics occidentales, novelas, etc.). Se arma con la info de la ficha
 * de la editorial. Si la edición ya tiene anilistId, redirige a la ficha normal.
 */
export default async function NacionalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await prisma.publisherEdition.findUnique({
    where: { id: Number(id) },
  });
  if (!row) notFound();
  if (row.anilistId) redirect(`/manga/${row.anilistId}`);

  const ficha =
    row.publisher === "Ivrea Argentina"
      ? await getIvreaDataBySlug(row.slug).catch(() => null)
      : null;

  const title = ficha?.title || row.title;
  const cover = ficha?.coverImage ?? null;
  const author = ficha?.author ?? null;
  const synopsis = ficha?.synopsis ?? null;
  const volumes = ficha?.argentinaVolumes || row.volumes;
  const status = ficha?.argentinaStatus || null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={title}
            className="h-72 w-48 shrink-0 self-start rounded-xl object-cover"
          />
        )}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300">
              🇦🇷 Edición nacional
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Field label="Editorial" value={row.publisher} />
            <Field label="Autor" value={author || "—"} />
            <Field label="Tomos" value={volumes || "—"} />
            <Field label="Estado" value={status || "—"} />
          </dl>

          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
          >
            Ver en {row.publisher} ↗
          </a>
        </div>
      </div>

      {synopsis && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {synopsis}
        </p>
      )}

      <p className="mt-8 text-xs text-muted">
        Esta obra no figura en AniList; la información proviene del catálogo de{" "}
        {row.publisher}.
      </p>
    </main>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
