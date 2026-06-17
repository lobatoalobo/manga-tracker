/**
 * Géneros curados a mano para las obras que no matchean en MangaUpdates/MangaDex
 * (cómics occidentales, spin-offs, romanizaciones raras, debuts sin ficha). No
 * varían, así que van hardcodeados. Solo setea si la obra todavía no tiene
 * géneros (no pisa lo enriquecido ni lo editado a mano). Match por título exacto.
 *
 *   node scripts/with-staging.mjs npx tsx scripts/curate-genres.ts [--dry]
 */
import { prisma } from "../lib/prisma";

const GENRES: Record<string, string[]> = {
  "Agencia Del Amor": ["Romance", "Comedy"],
  Bestiarius: ["Action", "Historical", "Drama", "Seinen", "Gore"],
  "DRAGON BALL- ENCICLOPEDIA DEFINITIVA": ["Shounen", "Action", "Adventure"],
  "EL TEATRO DE RUMIKO TAKAHASHI": ["Comedy", "Drama", "Slice of Life", "Supernatural"],
  "El Negro Blanco": ["Crime", "Drama", "Action"],
  "Sick Bird": ["Crime", "Drama", "Comedy"],
  "Fear Agent": ["Sci-Fi", "Action", "Horror", "Adventure"],
  Gachiakuta: ["Action", "Fantasy", "Shounen", "Dark Fantasy"],
  "Gokushufudo: Yakuza Amo De Casa": ["Comedy", "Slice of Life", "Seinen"],
  "Haruhi Suzumiya Novela": ["Sci-Fi", "Comedy", "Mystery", "School Life"],
  Higehiro: ["Romance", "Drama", "Slice of Life", "Comedy"],
  "Junjo Romantica": ["Romance", "Boys' Love", "Drama", "Comedy"],
  "Kaiju Nº 8: Side B": ["Action", "Sci-Fi", "Shounen", "Comedy"],
  "Last Hero Inuyashiki": ["Sci-Fi", "Drama", "Action", "Seinen", "Psychological"],
  "Lilim Kiss": ["Romance", "Comedy", "Supernatural", "Ecchi", "Shounen"],
  "Magic Knight Rayearth": ["Fantasy", "Adventure", "Mecha", "Magical Girl", "Shoujo"],
  "Metal Gear Solid": ["Action", "Military", "Sci-Fi", "Thriller"],
  "Metal Gear Solid: Sons of Liberty": ["Action", "Military", "Sci-Fi", "Thriller"],
  "Phantom Busters": ["Action", "Supernatural", "Comedy", "Shounen"],
  "SUS OJOS ME PERSIGUEN": ["Horror", "Psychological", "Mystery"],
  "Sailor Moon: Short Stories": ["Shoujo", "Magical Girl", "Romance", "Fantasy"],
  "Sin City": ["Crime", "Noir", "Thriller", "Action"],
  "Summertime Rendering": ["Mystery", "Thriller", "Supernatural", "Sci-Fi"],
  Sunstone: ["Romance", "Drama", "LGBTQ+", "Mature"],
  "Tenjho Tenge": ["Action", "Martial Arts", "Ecchi", "Supernatural", "Seinen"],
  "The Maxx": ["Superhero", "Fantasy", "Psychological", "Surreal"],
};

async function main() {
  const dry = process.argv.includes("--dry");
  let set = 0;
  const missing: string[] = [];
  for (const [title, genres] of Object.entries(GENRES)) {
    const w = await prisma.work.findFirst({
      where: { title },
      select: { id: true, genres: true },
    });
    if (!w) {
      missing.push(title);
      continue;
    }
    if (w.genres.length > 0) continue; // no pisar
    set++;
    console.log(`  ${title} → ${genres.join(", ")}`);
    if (!dry)
      await prisma.work.update({
        where: { id: w.id },
        data: { genres, enrichedAt: new Date() },
      });
  }
  if (missing.length) console.log(`\nNo encontrados (revisar título): ${missing.join(" | ")}`);
  console.log(`\n${dry ? "[DRY] " : ""}Seteados: ${set}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
