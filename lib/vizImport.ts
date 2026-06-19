import { getMuLicensed } from "@/lib/providers/mangaupdates";
import { getMangaDex } from "@/lib/providers/mangadex";
import {
  findOrCreateWork,
  upsertPublisherEdition,
  slugifyTitle,
} from "@/lib/catalog";
import { normalizeGenres } from "@/lib/genres";
import { prisma } from "@/lib/prisma";

const VIZ = "VIZ Media";
const HENTAI = /hentai|lolicon|shotacon|doujinshi|pornographic/i;

/**
 * Seed de series de VIZ (inglés). Best-effort: cada una se VERIFICA contra MU
 * (que confirme VIZ como editorial inglesa); las que no, se saltean. Crece a
 * mano / por admin. Enumeración completa = Google Books (fase 2, ver doc).
 */
// Cada entrada es uno o varios títulos (alias): el primero es el nombre a
// mostrar; el resto ayuda a matchear en MU, que suele indexar en romaji
// (p. ej. "My Hero Academia" → "Boku no Hero Academia").
export const VIZ_SEED: string[][] = [
  ["Naruto"],
  ["Bleach"],
  ["One Piece"],
  ["Dragon Ball"],
  ["Death Note"],
  ["My Hero Academia", "Boku no Hero Academia"],
  ["Jujutsu Kaisen"],
  ["Chainsaw Man"],
  ["Demon Slayer", "Kimetsu no Yaiba"],
  ["Spy x Family"],
  ["Dr. Stone"],
  ["Tokyo Ghoul"],
  ["One-Punch Man", "One Punch-Man"],
  ["Hunter x Hunter"],
  ["JoJo's Bizarre Adventure Part 1", "JoJo's Bizarre Adventure"],
  ["Sakamoto Days"],
  ["Kaiju No. 8", "Kaijuu 8-gou"],
  ["Blue Box", "Ao no Hako"],
  ["Yu-Gi-Oh!"],
  ["Vagabond"],
];

export interface VizResult {
  ok: boolean;
  title?: string;
  workId?: number;
  volumes?: number;
  reason?: string;
}

/**
 * Importa UNA serie de VIZ (por título): MU confirma VIZ + da conteo/géneros/
 * autor/romaji, MD da portada. Crea/asocia el `Work` (dedup por título/romaji,
 * así una serie que ya está por Ivrea suma la edición VIZ al MISMO Work) y la
 * edición `VIZ Media` (en/US). Idempotente (upsert por publisher+slug).
 */
export async function importVizSeries(
  seed: string | string[],
): Promise<VizResult> {
  const aliases = Array.isArray(seed) ? seed : [seed];
  const seedTitle = aliases[0];
  const mu = await getMuLicensed(aliases).catch(() => null);
  if (!mu) return { ok: false, reason: "sin match en MU" };
  if (!mu.englishPublishers.some((p) => /viz/i.test(p)))
    return {
      ok: false,
      reason: `MU no marca VIZ (en: ${mu.englishPublishers.join("/") || "—"})`,
    };
  if (mu.genres.some((g) => HENTAI.test(g)))
    return { ok: false, reason: "bloqueado (hentai/doujin)" };

  const md = await getMangaDex([mu.title, seedTitle]).catch(() => null);
  const cover = md?.coverImage ?? mu.coverImage ?? null;
  const rawGenres = [...mu.genres, ...(md?.genres ?? [])];
  const { genres, demographic } = normalizeGenres(rawGenres);

  // Catálogo inglés: mostramos el título en inglés (el del seed); guardamos el
  // principal de MU (suele ser romaji) como originalTitle para el dedup al Work.
  const displayTitle = seedTitle || mu.title;
  const workId = await findOrCreateWork({
    title: displayTitle,
    coverImage: cover,
    author: mu.author,
    synopsis: mu.description,
    originalTitle: mu.title,
  }).catch(() => null);
  if (!workId) return { ok: false, reason: "no se pudo crear Work" };

  // Completa géneros/demografía/raw si el Work no los tenía (no pisa lo editado).
  const w = await prisma.work.findUnique({
    where: { id: workId },
    select: { genres: true, demographic: true, rawGenres: true },
  });
  const patch: { genres?: string[]; demographic?: string; rawGenres?: string[] } = {};
  if (w && w.genres.length === 0 && genres.length) patch.genres = genres;
  if (w && !w.demographic && demographic) patch.demographic = demographic;
  if (w && w.rawGenres.length === 0 && rawGenres.length) patch.rawGenres = rawGenres;
  if (Object.keys(patch).length)
    await prisma.work.update({ where: { id: workId }, data: patch }).catch(() => {});

  const title = displayTitle;
  const slug = slugifyTitle(title);
  const volumes = mu.standardVolumes ?? 0;
  await upsertPublisherEdition({
    publisher: VIZ,
    slug,
    title,
    volumes,
    status: "EN CATÁLOGO",
    // viz.com no permite deep-link de catálogo (robots); link de búsqueda para el usuario.
    url: `https://www.viz.com/search?search=${encodeURIComponent(title)}`,
    language: "en",
    country: "US",
  });
  await prisma.publisherEdition
    .updateMany({ where: { publisher: VIZ, slug }, data: { workId } })
    .catch(() => {});

  return { ok: true, title, workId, volumes };
}

export interface VizRefreshResult {
  scanned: number;
  ok: number;
  failed: number;
  updated: { title: string; volumes: number }[];
}

/**
 * Mantenimiento: re-resuelve contra MU las obras que YA tienen edición VIZ para
 * actualizar el conteo de tomos (tomos nuevos). Idempotente. Re-matchea por el
 * `originalTitle` (romaji de MU que guardamos) + el título mostrado, así no se
 * pierde el match aunque mostremos el nombre en inglés. Para el cron de Vercel
 * (MU/MD no bloquean datacenter). `limit` acota por corrida si el catálogo crece.
 */
export async function refreshVizCatalog(
  limit?: number,
): Promise<VizRefreshResult> {
  const works = await prisma.work.findMany({
    where: { editions: { some: { publisher: VIZ } } },
    select: { id: true, title: true, originalTitle: true },
    orderBy: { id: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  let ok = 0;
  let failed = 0;
  const updated: { title: string; volumes: number }[] = [];
  for (const w of works) {
    const aliases = [...new Set([w.originalTitle, w.title].filter(Boolean))] as string[];
    const r = await importVizSeries(aliases).catch(() => null);
    if (r?.ok) {
      ok++;
      if (r.volumes) updated.push({ title: r.title ?? w.title, volumes: r.volumes });
    } else {
      failed++;
    }
    await new Promise((res) => setTimeout(res, 500)); // rate-limit MU/MD
  }
  return { scanned: works.length, ok, failed, updated };
}
