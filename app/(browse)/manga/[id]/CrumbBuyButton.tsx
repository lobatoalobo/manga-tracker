import { crumbSearch } from "@/lib/crumb";
import { getCrumbQuery, crumbDefaultTitle } from "@/lib/storeLinks";
import { resolveEditions, titlesOf } from "@/lib/getMangaDetails";

/**
 * Botón "Comprar en Crumb": solo se muestra si la serie tiene edición nacional.
 * Crumb lista cada edición con el nombre que usa su editorial (en español/
 * romaji, NUNCA el inglés de AniList). Usamos, en orden: el override manual del
 * admin, el título de la edición nacional mapeada, o el romaji como último
 * recurso.
 */
export default async function CrumbBuyButton({ anilist }: { anilist: any }) {
  const override = await getCrumbQuery(anilist.id);
  let title = override ?? (await crumbDefaultTitle(anilist.id));

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
