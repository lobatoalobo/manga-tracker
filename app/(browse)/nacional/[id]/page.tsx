import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getSeries } from "@/lib/collection";
import { getIvreaDataBySlug } from "@/lib/providers/ivrea";
import AddEditionButton from "@/components/AddEditionButton";
import AdminNacionalEdit from "@/components/AdminNacionalEdit";
import TrackingPanel from "@/components/TrackingPanel";
import WishButton from "@/components/WishButton";
import { SignIn } from "@/components/AuthButtons";
import { isWished } from "@/lib/wishlist";
import { crumbSearch } from "@/lib/crumb";
import { formatReleaseLabel } from "@/lib/releaseDate";
import { getCrumbQuery } from "@/lib/storeLinks";
import type { Edition } from "@/lib/editions";

export const metadata = { title: "Edición nacional · Nakama" };

/**
 * Página de una obra del catálogo nacional (Ivrea) que NO está en AniList
 * (cómics occidentales, novelas, etc.). Usa un anilistId **negativo** (el id de
 * la edición en negativo) para poder trackearla en la colección igual que el
 * resto. Se arma con la info de la ficha de la editorial.
 */
export default async function NacionalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const editionId = Number(id);

  const row = await prisma.publisherEdition.findUnique({
    where: { id: editionId },
    include: { work: true },
  });
  if (!row) notFound();
  if (row.anilistId) redirect(`/manga/${row.anilistId}`);

  // Datos LOCALES (catálogo/Work) primero. La ficha de Ivrea en vivo es solo un
  // FALLBACK transitorio: si al Work YA le copiamos autor/sinopsis/portada (el
  // crawl lo hace), no la pedimos → no dependemos del fetch externo.
  const ivreaSlug =
    row.url.match(/ivrea\.com\.ar\/titulo\/([^/?#]+)/i)?.[1] ?? row.slug;
  const needsIvrea =
    row.publisher === "Ivrea Argentina" &&
    (!row.work?.author || !row.work?.synopsis || !row.work?.coverImage);
  const ficha = needsIvrea
    ? await getIvreaDataBySlug(ivreaSlug).catch(() => null)
    : null;

  // Display: lo editado en el Work manda; la ficha de Ivrea es solo semilla.
  const title = row.work?.title || ficha?.title || row.title;
  const cover = row.work?.coverImage ?? ficha?.coverImage ?? null;
  const author = row.work?.author ?? ficha?.author ?? null;
  const synopsis = row.work?.synopsis ?? ficha?.synopsis ?? null;
  const volumes = row.volumes || ficha?.argentinaVolumes || 0;
  const status = row.status || ficha?.argentinaStatus || null;

  // Id propio (negativo) para la colección, sin chocar con ids de AniList.
  const pseudoId = -editionId;
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const admin = isAdmin(session?.user?.email);
  const series = userId ? await getSeries(userId, pseudoId) : null;
  const wished = userId ? await isWished(userId, pseudoId) : false;
  // Override del término de búsqueda de Crumb (admin), keyeado por el id local.
  const crumbInitial = (await getCrumbQuery(pseudoId)) ?? title;
  const trackedKeys = series?.editions.map((e) => e.key) ?? [];

  const anilist = {
    id: pseudoId,
    title: { romaji: title, english: null, native: null },
    coverImage: cover ?? "",
    volumes,
  };
  const edition: Edition = {
    id: "ivrea",
    source: row.publisher,
    region: "AR",
    publisher: row.publisher,
    slug: row.slug,
    status: status || "EN CATÁLOGO",
    volumes,
    nextVolume: null,
    url: row.url,
  };

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
            {row.work?.upcoming && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                🔜 Próximo a salir
                {formatReleaseLabel(row.work.releaseLabel) &&
                  ` · ${formatReleaseLabel(row.work.releaseLabel)}`}
              </span>
            )}
          </div>

          {(row.work?.genres?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {row.work!.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Field label="Editorial" value={row.publisher} />
            <Field label="Autor" value={author || "—"} />
            <Field label="Tomos" value={volumes || "—"} />
            <Field label="Estado" value={status || "—"} />
          </dl>

          <div className="mt-4 flex max-w-md flex-wrap items-center gap-3">
            {userId ? (
              <>
                <AddEditionButton
                  anilist={anilist}
                  edition={edition}
                  isTracked={trackedKeys.includes("ivrea")}
                />
                <WishButton
                  anilistId={pseudoId}
                  title={title}
                  coverImage={cover ?? ""}
                  initialWished={wished}
                />
              </>
            ) : (
              <SignIn className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90" />
            )}
            <a
              href={crumbSearch(crumbInitial)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
            >
              🛒 Comprar en Crumb
            </a>
          </div>

          {/* Sin link de redirección a la editorial (rompen / aportan ≤ lo
              nuestro). "Dónde comprar" va por Crumb. La url queda interna. */}

          {admin && (
            <AdminNacionalEdit
              editionId={row.id}
              workId={row.workId}
              pseudoId={pseudoId}
              title={title}
              author={author ?? ""}
              synopsis={synopsis ?? ""}
              coverImage={cover ?? ""}
              genres={row.work?.genres ?? []}
              upcoming={row.work?.upcoming ?? false}
              releaseLabel={row.work?.releaseLabel ?? ""}
              volumes={row.volumes}
              url={row.url}
              crumbInitial={crumbInitial}
            />
          )}
        </div>
      </div>

      {synopsis && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-muted">
          {synopsis}
        </p>
      )}

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
