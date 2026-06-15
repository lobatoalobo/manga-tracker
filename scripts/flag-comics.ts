/**
 * Marca (y opcionalmente borra) ediciones que parecen CÓMIC occidental (Marvel/
 * DC/Image), no manga. Ovni y Panini publican ambos y el seed los trae mezclados.
 *
 *   npx tsx scripts/flag-comics.ts            # dry-run: lista los sospechosos
 *   npx tsx scripts/flag-comics.ts --apply    # borra los listados
 *
 * Heurística por TÍTULO (no infalible): revisá la lista del dry-run antes de
 * aplicar. Es una lista extensible; la afinamos cuando veamos los datos del seed.
 * No toca ediciones mapeadas a AniList (esas son manga casi seguro).
 */
import { prisma } from "../lib/prisma";

// Franquicias / sellos de cómic occidental frecuentes en AR.
const COMIC_TERMS = [
  "marvel", "dc comics", "spider-man", "spiderman", "spider man", "batman",
  "superman", "wonder woman", "mujer maravilla", "x-men", "x men", "wolverine",
  "deadpool", "avengers", "vengadores", "justice league", "liga de la justicia",
  "hulk", "thor", "iron man", "capitan america", "captain america", "the flash",
  "green lantern", "linterna verde", "aquaman", "daredevil", "punisher",
  "castigador", "venom", "carnage", "harley quinn", "teen titans",
  "jovenes titanes", "suicide squad", "escuadron suicida", "watchmen", "sandman",
  "hellboy", "walking dead", "star wars", "fantastic four", "4 fantasticos",
  "cuatro fantasticos", "guardians of the galaxy", "guardianes de la galaxia",
  "black panther", "pantera negra", "doctor strange", "ant-man", "black widow",
  "moon knight", "ghost rider", "silver surfer", "miles morales", "absolute batman",
  "dark knight", "gotham", "justice society", "green arrow", "shazam",
];

function looksLikeComic(title: string): string | null {
  const t = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  for (const term of COMIC_TERMS) if (t.includes(term)) return term;
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.publisherEdition.findMany({
    where: { anilistId: null }, // las mapeadas a AniList son manga casi seguro
    select: { id: true, publisher: true, title: true, volumes: true },
    orderBy: { publisher: "asc" },
  });

  const hits: { id: number; publisher: string; title: string; term: string }[] = [];
  for (const r of rows) {
    const term = looksLikeComic(r.title);
    if (term) hits.push({ id: r.id, publisher: r.publisher, title: r.title, term });
  }

  for (const h of hits)
    console.log(`· #${h.id} [${h.publisher}] "${h.title}"  (match: ${h.term})`);

  console.log(`\n${hits.length} ediciones parecen cómic (de ${rows.length} sin mapear).`);

  if (!apply) {
    console.log("DRY-RUN: no se borró nada. Revisá la lista y corré --apply.");
  } else if (hits.length) {
    const r = await prisma.publisherEdition.deleteMany({
      where: { id: { in: hits.map((h) => h.id) } },
    });
    console.log(`Borradas ${r.count} ediciones.`);
  }

  await prisma.$disconnect();
}

main();
