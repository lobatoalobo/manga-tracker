import { resolveEditions, titlesOf } from "@/lib/getMangaDetails";
import { crumbSearch } from "@/lib/crumb";

/**
 * Botón "Comprar en Crumb": solo se muestra si la serie tiene edición
 * nacional (región AR). Resuelve ediciones reusando la caché por request.
 */
export default async function CrumbBuyButton({ anilist }: { anilist: any }) {
  const { editions } = await resolveEditions(anilist, titlesOf(anilist));
  const hasNational = editions.some((e) => e.region === "AR");
  if (!hasNational) return null;

  return (
    <a
      href={crumbSearch(anilist.title.romaji)}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
    >
      🛒 Comprar en Crumb
    </a>
  );
}
