import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorksByAuthor } from "@/lib/catalog";

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
          <Link
            key={w.id}
            href={`/serie/${w.id}`}
            className="group rounded-xl border border-border bg-surface p-2 transition hover:border-accent"
          >
            <div className="aspect-2/3 overflow-hidden rounded-lg bg-surface-2">
              {w.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.coverImage} alt={w.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">
                  {w.title}
                </div>
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm font-medium">{w.title}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
