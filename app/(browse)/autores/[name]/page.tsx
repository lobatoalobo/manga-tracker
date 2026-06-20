import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorksByAuthor } from "@/lib/catalog";
import SeriesTile from "@/components/SeriesTile";

export const metadata = { title: "Autor · Nakama" };

/** Obras de un autor del catálogo LOCAL (match por `Work.author`). */
export default async function AutorPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const author = decodeURIComponent(name);
  const works = await getWorksByAuthor(author);
  if (works.length === 0) notFound();

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <Link href="/autores" className="text-sm text-muted hover:text-foreground">
        ← Autores
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">{author}</h1>
      <p className="mb-5 text-sm text-muted">
        {works.length} {works.length === 1 ? "obra" : "obras"}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {works.map((w) => (
          <SeriesTile
            key={w.id}
            data={{
              href: `/serie/${w.id}`,
              title: w.title,
              coverImage: w.coverImage,
              national: w.national,
              intl: w.intl,
              publishers: w.publishers,
            }}
          />
        ))}
      </div>
    </main>
  );
}
