import { getLocalAuthors } from "@/lib/catalog";
import AuthorsList from "@/components/AuthorsList";

export const metadata = { title: "Autores · Nakama" };

/**
 * Índice de autores del catálogo LOCAL, derivado de `Work.author` (sin AniList).
 */
export default async function AutoresPage() {
  const authors = await getLocalAuthors();
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-4 text-2xl font-bold">Autores</h1>
      <AuthorsList authors={authors} />
    </main>
  );
}
