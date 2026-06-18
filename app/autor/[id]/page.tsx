import { notFound } from "next/navigation";
import Link from "next/link";
import { getStaffWorks } from "@/lib/anilist";
import { ANILIST_OFF } from "@/lib/flags";
import { displayTitle } from "@/lib/title";

export const metadata = { title: "Autor · Nakama" };

export default async function AutorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Página legacy basada en el staff de AniList. En el modelo local el índice de
  // autores vive en /autores/[name]; con AniList apagado esta ruta no aplica.
  if (ANILIST_OFF) notFound();
  const data = await getStaffWorks(Number(id));
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">{data.name}</h1>
      <p className="mb-6 text-sm text-muted">
        {data.works.length} obras (manga)
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {data.works.map((m: any) => (
          <Link
            key={m.id}
            href={`/manga/${m.id}`}
            className="group overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent"
          >
            <div className="aspect-2/3 w-full overflow-hidden bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.coverImage.large}
                alt={displayTitle(m.title)}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            </div>
            <div className="p-3">
              <h3
                className="truncate text-sm font-semibold"
                title={displayTitle(m.title)}
              >
                {displayTitle(m.title)}
              </h3>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
