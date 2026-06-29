import { prisma } from "@/lib/prisma";
import { getMangaUpdatesEnrich } from "@/lib/providers/mangaupdates";
import { getMangaDex } from "@/lib/providers/mangadex";
import { getIvreaDataBySlug } from "@/lib/providers/ivrea";
import { normalizeGenres } from "@/lib/genres";
import { proxiedCover } from "@/lib/coverProxy";
import { storeCover } from "@/lib/coverStore";
import { dbRetry } from "@/lib/dbRetry";
import { mergeWorks } from "@/lib/mergeWorks";
import { titlesAgree } from "@/lib/domain/work/merge";

export interface EnrichResult {
  scanned: number;
  enriched: number; // works con al menos un dato nuevo (géneros/portada/sinopsis)
  matchedMU: number;
  matchedMD: number;
  merged: number; // works fusionados por colisión de id externo (dedup id-first)
  samples: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Variantes de título para matchear contra MU/MD. Además del original (romaji) y
 * el título, prueba el prefijo antes del subtítulo:
 *  - guion: "JIGOKURAKU -HELL'S PARADISE-" → "JIGOKURAKU"
 *  - dos puntos: "Umimachi Diary: Diario de una Ciudad Costera" → "Umimachi Diary"
 *    (Whakoom guarda los títulos AR como "Romaji: Traducción"; el romaji es lo
 *    buscable en MU/MD). Exigimos espacio tras los ":" para no cortar "Re:Zero".
 * Y una versión sin espacios ("GACHI AKUTA" → "GACHIAKUTA").
 */
export function buildTargets(originalTitle: string | null, title: string): string[] {
  const base = [originalTitle, title].filter(Boolean) as string[];
  const extra: string[] = [];
  for (const t of base) {
    for (const re of [/\s+[-–—]\s*/, /:\s+/]) {
      const prefix = t.split(re)[0].trim();
      if (prefix && prefix !== t && prefix.length >= 3) extra.push(prefix);
    }
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
  onlyMissingCover?: boolean; // solo Works sin portada (recovery de portadas)
  onlyMissingGenres?: boolean; // solo Works sin géneros (re-match con la mejora)
  onlyMissingIdentity?: boolean; // solo Works sin mdId (backfill identidad + nombres)
  publisher?: string; // acotar a works con una edición de esta editorial (ej. Panini)
  dryRun?: boolean;
} = {}): Promise<EnrichResult> {
  const limit = opts.limit ?? 50;
  const base = opts.onlyMissingCover
    ? { coverImage: null }
    : opts.onlyMissingGenres
      ? { editions: { some: {} }, genres: { isEmpty: true } }
      : opts.onlyMissingIdentity
        ? { editions: { some: {} }, OR: [{ mdId: null }, { muId: null }] }
        : opts.force
          ? {}
          : { enrichedAt: null };
  // NUNCA enriquecer cómics: MU/MD son bases de manga (matchean mal los Marvel/DC
  // y contaminan/fusionan). Ver memoria panini-classify. + filtro opcional por
  // editorial (contains, robusto a "Panini" vs "Panini Argentina").
  const and: object[] = [base, { type: { not: "COMIC" } }];
  if (opts.publisher) and.push({ editions: { some: { publisher: { contains: opts.publisher } } } });
  const where = { AND: and };
  const works = await dbRetry(() => prisma.work.findMany({
    where,
    take: limit,
    orderBy: { id: "asc" },
    select: {
      id: true,
      title: true,
      originalTitle: true,
      titleEn: true,
      titleNative: true,
      mdId: true,
      muId: true,
      author: true,
      curated: true,
      coverImage: true,
      synopsisEn: true,
      genres: true,
      rawGenres: true,
      demographic: true,
      editions: { select: { publisher: true, slug: true, language: true } },
    },
  }));

  let enriched = 0;
  let matchedMU = 0;
  let matchedMD = 0;
  let merged = 0; // works fusionados por colisión de id externo (dedup id-first)
  const samples: string[] = [];

  for (const w of works) {
    const ivreaSlug = w.editions.find((e) => e.publisher === "Ivrea Argentina")?.slug;
    // Backfill del título original (romaji) desde la ficha de Ivrea si falta.
    let originalTitle = w.originalTitle;
    if (!originalTitle && ivreaSlug) {
      const ficha = await getIvreaDataBySlug(ivreaSlug).catch(() => null);
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

    // Crudo (MU ∪ MD, inglés) → canónico (es) + demografía (eje aparte).
    const raw = mergeGenres(mu?.genres ?? [], md?.genres ?? []);
    const { genres, demographic } = normalizeGenres(raw);
    const patch: {
      originalTitle?: string;
      titleEn?: string;
      titleNative?: string;
      author?: string;
      genres?: string[];
      rawGenres?: string[];
      demographic?: string;
      coverImage?: string;
      synopsisEn?: string;
      enrichedAt: Date;
    } = { enrichedAt: new Date() };

    // Identidad externa (mdId/muId): se escribe APARTE del patch principal, porque
    // es @unique y un choque (dos works → misma serie) NO debe tumbar el resto del
    // update (autor/géneros/nombres). Rediseño Fase 2/3.
    const newMdId = md?.id && !w.mdId ? md.id : null;
    const newMuId = mu?.seriesId && !w.muId ? String(mu.seriesId) : null;
    // Autor desde MU (fuente confiable). Solo si falta y no está curado a mano.
    if (mu?.author && !w.author?.trim() && !w.curated.includes("author"))
      patch.author = mu.author;
    if (md?.titleEn && !w.titleEn) patch.titleEn = md.titleEn;
    if (md?.titleNative && !w.titleNative) patch.titleNative = md.titleNative;
    // Romaji (originalTitle): ficha de Ivrea primero (ya intentado), luego MD ja-ro.
    if (!originalTitle && md?.titleRomaji) originalTitle = md.titleRomaji;
    if (originalTitle && originalTitle !== w.originalTitle)
      patch.originalTitle = originalTitle;
    if (raw.length && w.rawGenres.length === 0) patch.rawGenres = raw;
    if (genres.length && w.genres.length === 0) patch.genres = genres;
    if (demographic && !w.demographic) patch.demographic = demographic;
    // Portada: Ivrea manda; respaldo MD/MU. La guardamos en R2 (propia); si R2 no
    // está o falla, caemos al proxy (MD bloquea hotlink) / hotlink (MU).
    if (!w.coverImage && (md?.coverImage || mu?.coverImage)) {
      const src = (md?.coverImage || mu?.coverImage) as string;
      const c = (await storeCover(src)) ?? proxiedCover(src);
      if (c) patch.coverImage = c;
    }
    // Sinopsis del Work: la de la editorial (español) manda. El respaldo inglés
    // (MU/MD) SOLO si la obra no tiene edición ES (si la tiene, la inglesa iría a
    // la edición VIZ, no al Work). Evita el "Source: VIZ Media" en obras de Ivrea.
    // Respaldo EN (MU/MD) → synopsisEn (convive con la ES en synopsisEs; los tabs
    // muestran cada una). Solo si falta, no pisa.
    if (!w.synopsisEn && (mu?.description || md?.description))
      patch.synopsisEn = (mu?.description || md?.description) as string;

    const gotData =
      !!patch.genres ||
      !!patch.coverImage ||
      !!patch.synopsisEn ||
      !!newMdId ||
      !!newMuId ||
      !!patch.author ||
      !!patch.titleEn ||
      !!patch.titleNative;
    if (gotData) enriched++;
    if (gotData && samples.length < 25)
      samples.push(
        `${w.title} → ${patch.genres ? `[${patch.genres.slice(0, 4).join(", ")}]` : "sin géneros"}${newMdId ? " +mdId" : ""}${newMuId ? " +muId" : ""}${patch.author ? ` +autor(${patch.author})` : ""}${patch.titleEn ? " +en" : ""}${patch.titleNative ? " +ja" : ""}`,
      );

    if (!opts.dryRun) {
      // DEDUP ID-FIRST: si OTRA obra ya tiene este id externo, son la misma serie
      // (duplicado creado por título) → fusionamos ESTA en aquella y saltamos.
      let mergedAway = false;
      for (const [field, val] of [
        ["mdId", newMdId],
        ["muId", newMuId],
      ] as const) {
        if (!val) continue;
        const other = await dbRetry(() =>
          prisma.work.findFirst({
            where: { [field]: val, id: { not: w.id } },
            select: { id: true, title: true, originalTitle: true },
          }),
        ).catch(() => null);
        if (other) {
          // GUARDA anti-over-merge: aunque compartan el id externo, solo fusionamos
          // si coinciden por título/romaji. Si el subtítulo difiere ("Attack on
          // Titan" vs "…: Sin Remordimientos"), el matcher asignó el id de la serie
          // base al spin-off por error → NO fusionar (queda sin ese id). Acá NO se
          // confía en el id (es el que está en disputa), por eso `titlesAgree` y no
          // `sameSeries`. Permite el dedup cross-idioma (Alley/El Callejón, romaji).
          const agree = titlesAgree(
            { title: w.title, originalTitle },
            { title: other.title, originalTitle: other.originalTitle },
          );
          if (agree) {
            await mergeWorks(w.id, other.id).catch(() => {});
            mergedAway = true;
            merged++;
            break;
          }
          // No es la misma serie: no asignamos este id (colisión @unique) y
          // seguimos sin fusionar.
          continue;
        }
      }
      if (mergedAway) {
        await sleep(350);
        continue;
      }

      await dbRetry(() => prisma.work.update({ where: { id: w.id }, data: patch })).catch(() => {});
      // Ids externos, cada uno aislado: un choque @unique o un id raro no se lleva
      // puesto el update principal (era el bug del overflow de muId Int).
      if (newMdId)
        await prisma.work.update({ where: { id: w.id }, data: { mdId: newMdId } }).catch(() => {});
      if (newMuId)
        await prisma.work.update({ where: { id: w.id }, data: { muId: newMuId } }).catch(() => {});
    }
    await sleep(350);
  }

  return { scanned: works.length, enriched, matchedMU, matchedMD, merged, samples };
}
