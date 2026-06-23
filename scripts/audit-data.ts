/**
 * Auditoría de datos (Fase 0 del rediseño — ver docs/analisis-sistema-datos.md).
 * Read-only, sin red. Reporta, sobre los Works CON edición, la cobertura de
 * campos, la matchabilidad (identidad externa) y los focos de problema (autores
 * perdidos, ediciones multi-idioma que se pisan). Sirve para dimensionar Fase 1.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/audit-data.ts
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";

const pct = (n: number, total: number) => `${n} (${total ? Math.round((n / total) * 100) : 0}%)`;

async function main() {
  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: { editions: { some: {} } },
      select: {
        id: true,
        title: true,
        originalTitle: true, // romaji
        titleEn: true,
        titleNative: true,
        mdId: true,
        author: true,
        anilistId: true,
        genres: true,
        synopsis: true,
        coverImage: true,
        editions: { select: { publisher: true, language: true, volumes: true } },
      },
    }),
  );
  const N = works.length;
  const has = (f: (w: (typeof works)[number]) => boolean) => works.filter(f).length;

  const romaji = has((w) => !!w.originalTitle);
  const titleEn = has((w) => !!w.titleEn);
  const titleNative = has((w) => !!w.titleNative);
  const mdId = has((w) => !!w.mdId);
  const author = has((w) => !!w.author && w.author.trim() !== "");
  const anilist = has((w) => w.anilistId != null);
  const genres = has((w) => w.genres.length > 0);
  const synopsis = has((w) => !!w.synopsis);
  const cover = has((w) => !!w.coverImage);

  console.log(`\n===== AUDITORÍA DE DATOS (Fase 0) =====`);
  console.log(`Works con edición: ${N}\n`);

  console.log(`COBERTURA DE CAMPOS:`);
  console.log(`  título (display):  ${pct(N, N)}`);
  console.log(`  romaji (originalTitle): ${pct(romaji, N)}`);
  console.log(`  título inglés (titleEn): ${pct(titleEn, N)}`);
  console.log(`  título nativo JA (titleNative): ${pct(titleNative, N)}`);
  console.log(`  autor:             ${pct(author, N)}`);
  console.log(`  géneros:           ${pct(genres, N)}`);
  console.log(`  sinopsis:          ${pct(synopsis, N)}`);
  console.log(`  portada:           ${pct(cover, N)}\n`);

  console.log(`IDENTIDAD EXTERNA PERSISTIDA:`);
  console.log(`  anilistId: ${pct(anilist, N)}  ·  mdId: ${pct(mdId, N)}\n`);

  // Matchabilidad: ¿podemos resolver identidad externa?
  const withAnilist = anilist;
  const noAniWithRomaji = has((w) => w.anilistId == null && !!w.originalTitle);
  const noAniNoRomaji = has((w) => w.anilistId == null && !w.originalTitle);
  const noAniNoRomajiWithAuthor = has(
    (w) => w.anilistId == null && !w.originalTitle && !!w.author?.trim(),
  );
  console.log(`IDENTIDAD EXTERNA (matchabilidad):`);
  console.log(`  con anilistId:                 ${withAnilist}`);
  console.log(`  sin anilistId, con romaji:     ${noAniWithRomaji}  ← resolubles a MU/MD por romaji`);
  console.log(`  sin anilistId, sin romaji:     ${noAniNoRomaji}  ← hay que buscar el nombre afuera`);
  console.log(`     de esas, con autor:         ${noAniNoRomajiWithAuthor}  (el autor ayuda a desambiguar)`);
  console.log(`     de esas, sin autor:         ${noAniNoRomaji - noAniNoRomajiWithAuthor}  ← las más difíciles\n`);

  // Ediciones por work + multi-idioma (la clase "Rai Rai Rai").
  const multiEd = works.filter((w) => new Set(w.editions.map((e) => e.publisher)).size > 1);
  const multiLang = works.filter((w) => new Set(w.editions.map((e) => e.language)).size > 1);
  console.log(`EDICIONES:`);
  console.log(`  works con 1 editorial:   ${N - multiEd.length}`);
  console.log(`  works con 2+ editoriales: ${multiEd.length}`);
  console.log(`  works con ediciones multi-IDIOMA (es+en/ja): ${multiLang.length}  ← riesgo de datos pisados`);
  for (const w of multiLang.slice(0, 12)) {
    const eds = w.editions.map((e) => `${e.publisher}:${e.language}:${e.volumes}t`).join(" | ");
    console.log(`     /serie/${w.id} ${w.title.slice(0, 40)} → ${eds}`);
  }
  console.log("");

  // Autor perdido (clase 300/Frank Miller): sin autor pero con edición que suele traerlo.
  const NATIONAL = new Set(["Ivrea Argentina", "Panini Argentina", "Ovni Press"]);
  const lostAuthor = works.filter(
    (w) =>
      !w.author?.trim() && w.editions.some((e) => NATIONAL.has(e.publisher)),
  );
  console.log(`AUTOR (clase 300/Frank Miller):`);
  console.log(`  sin autor, con edición nacional (debería tener): ${lostAuthor.length}\n`);

  // Romaji faltante por editorial (dónde está el grueso del problema de match).
  const byPub: Record<string, { total: number; noRomaji: number }> = {};
  for (const w of works) {
    for (const p of new Set(w.editions.map((e) => e.publisher))) {
      byPub[p] ??= { total: 0, noRomaji: 0 };
      byPub[p].total++;
      if (!w.originalTitle) byPub[p].noRomaji++;
    }
  }
  console.log(`ROMAJI FALTANTE POR EDITORIAL (works):`);
  for (const [p, c] of Object.entries(byPub).sort((a, b) => b[1].noRomaji - a[1].noRomaji))
    console.log(`  ${p.padEnd(20)} sin romaji ${c.noRomaji}/${c.total}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
