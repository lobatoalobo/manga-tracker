import { getMuLicensed } from "@/lib/providers/mangaupdates";
import { getMangaDex } from "@/lib/providers/mangadex";
import { googleBooksVizTitles } from "@/lib/providers/googleBooks";
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
  // --- Shonen Jump / Shueisha (vía VIZ) ---
  ["Naruto"],
  ["Boruto", "Boruto: Naruto Next Generations"],
  ["Bleach"],
  ["One Piece"],
  ["Dragon Ball"],
  ["Dragon Ball Super"],
  ["Dr. Slump"],
  ["Death Note"],
  ["Bakuman"],
  ["Hikaru no Go"],
  ["My Hero Academia", "Boku no Hero Academia"],
  ["My Hero Academia: Vigilantes", "Vigilante: Boku no Hero Academia Illegals"],
  ["Jujutsu Kaisen"],
  ["Chainsaw Man"],
  ["Demon Slayer", "Kimetsu no Yaiba"],
  ["Spy x Family"],
  ["Dr. Stone"],
  ["Tokyo Ghoul"],
  ["Tokyo Ghoul: re", "Tokyo Ghoul:re"],
  ["One-Punch Man", "One Punch-Man"],
  ["Hunter x Hunter"],
  ["JoJo's Bizarre Adventure Part 1", "JoJo's Bizarre Adventure"],
  ["Sakamoto Days"],
  ["Kaiju No. 8", "Kaijuu 8-gou"],
  ["Blue Box", "Ao no Hako"],
  ["Yu-Gi-Oh!"],
  ["Vagabond"],
  ["Yu Yu Hakusho", "Yuu Yuu Hakusho"],
  ["Slam Dunk"],
  ["Rurouni Kenshin", "Rurouni Kenshin: Meiji Kenkaku Romantan"],
  ["Black Clover"],
  ["The Promised Neverland", "Yakusoku no Neverland"],
  ["Haikyu!!", "Haikyuu!!"],
  ["Food Wars!: Shokugeki no Soma", "Shokugeki no Souma"],
  ["Nisekoi: False Love", "Nisekoi"],
  ["Toriko"],
  ["Blue Exorcist", "Ao no Exorcist"],
  ["Seraph of the End", "Owari no Seraph"],
  ["World Trigger"],
  ["Mob Psycho 100"],
  ["Undead Unluck"],
  ["Mission: Yozakura Family", "Yozakura-san Chi no Daisakusen"],
  ["Mashle", "Mashle: Magic and Muscles"],
  ["Me & Roboco", "Boku to Roboco"],
  ["Akane-banashi"],
  ["Beelzebub"],
  ["Gintama"],
  ["Magi: The Labyrinth of Magic", "Magi"],
  ["Nura: Rise of the Yokai Clan", "Nurarihyon no Mago"],
  ["Reborn!", "Katekyou Hitman Reborn!"],
  ["Shaman King"],
  ["D.Gray-man"],
  ["Eyeshield 21"],
  ["Claymore"],
  ["Bobobo-bo Bo-bobo"],
  ["Astra Lost in Space", "Kanata no Astra"],
  ["Tegami Bachi: Letter Bee", "Tegami Bachi"],
  ["Psyren"],
  ["Dragon Quest: The Adventure of Dai", "Dragon Quest: Dai no Daibouken"],
  ["Sand Land"],
  ["Pokémon Adventures", "Pocket Monsters Special"],
  ["Kagurabachi"],
  ["Two on Ice", "Mecha Ike: Mecha Mote Iinchou"],
  ["Cipher Academy", "Angou Gakuen no Iroha"],
  ["Witch Watch"],
  ["The Elusive Samurai", "Nige Jouzu no Wakagimi"],
  ["Ms. Marvel"], // por las dudas: el guard descarta si MU no marca VIZ
  // --- VIZ Signature / seinen ---
  ["20th Century Boys", "20 Seiki Shounen"],
  ["Monster"],
  ["Pluto"],
  ["Billy Bat"],
  ["Master Keaton"],
  ["Asadora!"],
  ["Sanctuary"],
  ["Goodnight Punpun", "Oyasumi Punpun"],
  ["Solanin"],
  ["A Girl on the Shore", "Umibe no Onnanoko"],
  ["Dead Dead Demon's Dededede Destruction", "Dead Dead Demon's Dededededestruction"],
  ["Children of the Sea", "Kaijuu no Kodomo"],
  ["Dorohedoro"],
  ["Ranma 1/2"],
  ["Inuyasha"],
  ["Urusei Yatsura"],
  ["Maison Ikkoku"],
  ["Rin-ne", "Kyoukai no Rinne"],
  ["Mao", "MAO"],
  ["Uzumaki"],
  ["Tomie"],
  ["Gyo"],
  ["No Longer Human", "Ningen Shikkaku"],
  ["The Drifting Classroom", "Hyouryuu Kyoushitsu"],
  ["Phoenix", "Hi no Tori"],
  ["Real"],
  ["Dogs: Bullets & Carnage"],
  ["Biomega"],
  // --- Shojo Beat / shojo (VIZ) ---
  ["Kimi ni Todoke: From Me to You", "Kimi ni Todoke"],
  ["Vampire Knight"],
  ["Skip Beat!"],
  ["Hana-Kimi", "Hanazakari no Kimitachi e"],
  ["Absolute Boyfriend", "Zettai Kareshi"],
  ["Honey and Clover", "Hachimitsu to Clover"],
  ["Nana"],
  ["Kamisama Kiss", "Kamisama Hajimemashita"],
  ["Yona of the Dawn", "Akatsuki no Yona"],
  ["Ao Haru Ride", "Aoharaido"],
  ["Daytime Shooting Star", "Hirunaka no Ryuusei"],
  ["Komi Can't Communicate", "Komi-san wa, Comyushou desu."],
  ["Snow White with the Red Hair", "Akagami no Shirayukihime"],
  ["Requiem of the Rose King", "Baraou no Souretsu"],
  ["Takane & Hana", "Takane to Hana"],
  ["Anonymous Noise", "Fukumenkei Noise"],
  ["A Devil and Her Love Song", "Akuma to Love Song"],
  ["Library Wars: Love & War", "Toshokan Sensou: Love & War"],
  ["Sleepy Princess in the Demon Castle", "Maoujou de Oyasumi"],
  ["Ouran High School Host Club", "Ouran Koukou Host Club"],
  ["Yurara", "Yurara no Tsuki"],
  ["Fushigi Yûgi", "Fushigi Yuugi"],
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

  // MD primero: con el título (a veces inglés) trae TODOS los nombres conocidos,
  // incluido el romaji. Eso es clave para que MU matchee series indexadas en
  // romaji (ej. GB da "My Hero Academia", MU la tiene como "Boku no Hero Academia").
  const md = await getMangaDex(aliases).catch(() => null);
  const muAliases = [...new Set([...aliases, ...(md?.aliases ?? [])])];

  const mu = await getMuLicensed(muAliases).catch(() => null);
  if (!mu) return { ok: false, reason: "sin match en MU" };
  if (!mu.englishPublishers.some((p) => /viz/i.test(p)))
    return {
      ok: false,
      reason: `MU no marca VIZ (en: ${mu.englishPublishers.join("/") || "—"})`,
    };
  if (mu.genres.some((g) => HENTAI.test(g)))
    return { ok: false, reason: "bloqueado (hentai/doujin)" };

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

export interface VizDiscoverResult {
  source: number; // títulos que devolvió Google Books
  candidates: number; // los que no teníamos aún
  imported: number; // confirmados VIZ por MU e importados
  skipped: number;
  noKey?: boolean;
}

/**
 * Descubrimiento (vía 2): enumera títulos de VIZ con Google Books, descarta los
 * que ya tenemos, y pasa el resto por `importVizSeries` (MU confirma VIZ). Crece
 * el catálogo más allá del seed manual. `limit` acota cuántos NUEVOS procesa por
 * corrida (MU tiene rate-limit). Requiere GOOGLE_BOOKS_API_KEY.
 */
export async function discoverVizFromGoogleBooks(opts: {
  limit?: number;
  pagesPerQuery?: number;
} = {}): Promise<VizDiscoverResult> {
  const titles = await googleBooksVizTitles(opts.pagesPerQuery ?? 5);
  if (titles === null)
    return { source: 0, candidates: 0, imported: 0, skipped: 0, noKey: true };

  // Descarta lo que ya tenemos como Work (por normTitle y por originalTitle/romaji)
  // para no re-pegarle a MU al pedo.
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const existing = await prisma.work.findMany({
    select: { normTitle: true, originalTitle: true },
  });
  const have = new Set<string>();
  for (const w of existing) {
    if (w.normTitle) have.add(w.normTitle);
    if (w.originalTitle) have.add(norm(w.originalTitle));
  }
  const candidates = titles.filter((t) => !have.has(norm(t)));

  const toProcess = opts.limit ? candidates.slice(0, opts.limit) : candidates;
  let imported = 0;
  let skipped = 0;
  for (const t of toProcess) {
    const r = await importVizSeries(t).catch(() => null);
    if (r?.ok) imported++;
    else skipped++;
    await new Promise((res) => setTimeout(res, 800)); // rate-limit MU/MD
  }
  return {
    source: titles.length,
    candidates: candidates.length,
    imported,
    skipped,
  };
}
