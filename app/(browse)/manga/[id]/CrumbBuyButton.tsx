import { prisma } from "@/lib/prisma";
import { crumbSearch } from "@/lib/crumb";
import { resolveEditions, titlesOf } from "@/lib/getMangaDetails";

/**
 * Botón "Comprar en Crumb": solo se muestra si la serie tiene edición nacional.
 * Crumb lista cada edición con el nombre que usa su editorial (Ivrea→título
 * Ivrea, Ovni→título Ovni; en español/romaji, NUNCA el inglés de AniList).
 * Usamos el título de la edición nacional mapeada; si no está mapeada pero hay
 * edición en vivo, caemos al romaji (más cercano que el inglés).
 */
export default async function CrumbBuyButton({ anilist }: { anilist: any }) {
  const mapped = await prisma.publisherEdition.findFirst({
    where: { anilistId: anilist.id },
    select: { title: true },
    orderBy: { volumes: "desc" },
  });

  let title = mapped?.title ?? null;
  if (!title) {
    const { editions } = await resolveEditions(anilist, titlesOf(anilist));
    if (!editions.some((e) => e.region === "AR")) return null;
    title = anilist.title.romaji || null;
  }
  if (!title) return null;

  return (
    <a
      href={crumbSearch(title)}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
    >
      🛒 Comprar en Crumb
    </a>
  );
}
