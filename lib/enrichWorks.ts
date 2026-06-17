import { prisma } from "@/lib/prisma";
import { getMangaUpdatesEnrich } from "@/lib/providers/mangaupdates";
import { getMangaDex } from "@/lib/providers/mangadex";
import { getIvreaDataBySlug } from "@/lib/providers/ivrea";

export interface EnrichResult {
  scanned: number;
  enriched: number; // works con al menos un dato nuevo (géneros/portada/sinopsis)
  matchedMU: number;
  matchedMD: number;
  samples: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Variantes de título para matchear: original (romaji) + título, más el título
 * sin subtítulo ("JIGOKURAKU -HELL'S PARADISE-" → "JIGOKURAKU") y una versión
 * sin espacios ("GACHI AKUTA" → "GACHIAKUTA", que matchea "Gachiakuta").
 */
function buildTargets(originalTitle: string | null, title: string): string[] {
  const base = [originalTitle, title].filter(Boolean) as string[];
  const extra: string[] = [];
  for (const t of base) {
    const stripped = t.split(/\s+[-–—]\s*/)[0].trim();
    if (stripped && stripped !== t && stripped.length >= 3) extra.push(stripped);
    const noSpace = t.replace(/\s+/g, "");
    if (noSpace !== t) extra.push(noSpace);
  }
  return [...new Set([...base, ...extra])];
}

/** Mezcla y limpia géneros de varias fuentes (dedup case-insensitive). */
function mergeGenres(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const g of lists.flat()) {
    const k = g.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, g.trim());
  }
  return [...seen.values()];
}

/**
 * Enriquece Works del catálogo local desde MangaUpdates + MangaDex, matcheando
 * por el título ORIGINAL (romaji) de la ficha de la editorial. Trae géneros (MU
 * ∪ MD) y, como RESPALDO si faltan, portada (MD/MU) y sinopsis (MU/MD). NO pisa
 * la portada/sinopsis de la editorial (Ivrea manda). Idempotente vía `enrichedAt`.
 *
 * Whakoom no entra acá. MU/MD no bloquean datacenter → puede correr en Vercel,
 * pero por volumen conviene batch local.
 */
export async function enrichWorks(opts: {
  limit?: number;
  force?: boolean; // re-enriquecer aunque ya tengan enrichedAt
  dryRun?: boolean;
} = {}): Promise<EnrichResult> {
  const limit = opts.limit ?? 50;
  const works = await prisma.work.findMany({
    where: opts.force ? {} : { enrichedAt: null },
    take: limit,
    orderBy: { id: "asc" },
    select: {
      id: true,
      title: true,
      originalTitle: true,
      coverImage: true,
      synopsis: true,
      genres: true,
      editions: {
        where: { publisher: "Ivrea Argentina" },
        select: { slug: true },
        take: 1,
      },
    },
  });

  let enriched = 0;
  let matchedMU = 0;
  let matchedMD = 0;
  const samples: string[] = [];

  for (const w of works) {
    // Backfill del título original (romaji) desde la ficha de Ivrea si falta.
    let originalTitle = w.originalTitle;
    if (!originalTitle && w.editions[0]?.slug) {
      const ficha = await getIvreaDataBySlug(w.editions[0].slug).catch(() => null);
      if (ficha?.originalTitle) originalTitle = ficha.originalTitle;
      await sleep(300);
    }
    const targets = buildTargets(originalTitle, w.title);

    const [muRaw, mdRaw] = await Promise.all([
      getMangaUpdatesEnrich(targets).catch(() => null),
      getMangaDex(targets).catch(() => null),
    ]);
    // Guard anti-hentai/doujinshi: títulos cortos (ej. "Anohana") pueden matchear
    // un doujin porno homónimo. Si el match trae esos géneros, lo descartamos.
    // OJO: NO bloqueamos "Smut"/"Adult" — los usan josei/ecchi legítimos que
    // Ivrea SÍ publica (Yakuza Lover, Love Celeb, Highschool DxD).
    const BLOCK = /hentai|lolicon|shotacon|doujinshi|pornographic/i;
    const mu = muRaw && !muRaw.genres.some((g) => BLOCK.test(g)) ? muRaw : null;
    const md = mdRaw && !mdRaw.genres.some((g) => BLOCK.test(g)) ? mdRaw : null;
    if (mu) matchedMU++;
    if (md) matchedMD++;

    const genres = mergeGenres(mu?.genres ?? [], md?.genres ?? []);
    const patch: {
      originalTitle?: string;
      genres?: string[];
      coverImage?: string;
      synopsis?: string;
      enrichedAt: Date;
    } = { enrichedAt: new Date() };

    if (originalTitle && originalTitle !== w.originalTitle)
      patch.originalTitle = originalTitle;
    if (genres.length && w.genres.length === 0) patch.genres = genres;
    // Portada: Ivrea manda; respaldo MD (original) y luego MU.
    if (!w.coverImage && (md?.coverImage || mu?.coverImage))
      patch.coverImage = (md?.coverImage || mu?.coverImage) as string;
    // Sinopsis: la de la editorial (español) manda; respaldo MU/MD (inglés).
    if (!w.synopsis && (mu?.description || md?.description))
      patch.synopsis = (mu?.description || md?.description) as string;

    const gotData =
      !!patch.genres || !!patch.coverImage || !!patch.synopsis;
    if (gotData) enriched++;
    if (gotData && samples.length < 25)
      samples.push(
        `${w.title} → ${patch.genres ? `[${patch.genres.slice(0, 4).join(", ")}]` : "sin géneros"}${patch.coverImage ? " +cover" : ""}${patch.synopsis ? " +syn" : ""}`,
      );

    if (!opts.dryRun)
      await prisma.work.update({ where: { id: w.id }, data: patch }).catch(() => {});
    await sleep(350);
  }

  return { scanned: works.length, enriched, matchedMU, matchedMD, samples };
}
