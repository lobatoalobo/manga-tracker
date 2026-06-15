/**
 * Dedup cruzado crawl↔Whakoom: misma serie cargada dos veces por fuentes
 * distintas. Patrón: una edición MAPEADA (anilistId, viene del crawl, sin
 * whakoomId) + una SIN MAPEAR de Whakoom (whakoomId, anilistId null), misma
 * editorial y mismos tomos, con título equivalente (difieren por espacios/guiones
 * o porque Whakoom usa el título largo). Deja la mapeada (linkea a /manga) y borra
 * la duplicada (la que caía en /nacional y "no sirve").
 *
 *   npx tsx scripts/dedup-sources.ts            # dry-run
 *   npx tsx scripts/dedup-sources.ts --apply
 *
 * Conservador: exige mismos tomos + título equivalente (squash igual, o el corto
 * es prefijo-de-palabra del largo). Si hay >1 candidata, no toca (ambiguo).
 */
import { prisma } from "../lib/prisma";

const squash = (n: string) => n.replace(/\s+/g, "");

type Match = "exact" | "prefix" | null;

/**
 * Relación entre dos títulos:
 *  - "exact": iguales salvo espacios/puntuación → MISMO, seguro auto-borrar.
 *  - "prefix": uno es prefijo-de-palabra del otro → puede ser subtítulo (mismo)
 *    o secuela/arco (DISTINTO, ej. Rayearth vs Rayearth II) → solo marcar.
 */
function relate(an: string, bn: string): Match {
  if (squash(an) === squash(bn)) return "exact";
  const [s, l] = an.length <= bn.length ? [an, bn] : [bn, an];
  if (s.length >= 5 && l.startsWith(s + " ")) return "prefix";
  return null;
}

interface Row {
  id: number;
  publisher: string;
  title: string;
  normTitle: string;
  volumes: number;
  anilistId: number | null;
  whakoomId: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.some((a) => a === "--apply" || a === "apply");
  // Borrado quirúrgico de ids ya revisados (los de "prefijo" que confirmé dups).
  const delArg = args[args.indexOf("--delete") + 1];
  const explicitIds =
    args.includes("--delete") && delArg
      ? delArg.split(",").map(Number).filter((n) => Number.isFinite(n))
      : [];

  if (explicitIds.length) {
    const r = await prisma.publisherEdition.deleteMany({ where: { id: { in: explicitIds } } });
    const orphans = await prisma.work.deleteMany({ where: { editions: { none: {} } } });
    console.log(`Borradas ${r.count} ediciones (por id) + ${orphans.count} works huérfanos.`);
    await prisma.$disconnect();
    return;
  }

  const rows: Row[] = await prisma.publisherEdition.findMany({
    select: {
      id: true, publisher: true, title: true, normTitle: true,
      volumes: true, anilistId: true, whakoomId: true,
    },
  });

  const byPub = new Map<string, Row[]>();
  for (const r of rows) (byPub.get(r.publisher) ?? byPub.set(r.publisher, []).get(r.publisher)!).push(r);

  const toDelete: number[] = []; // exactos: seguros
  const review: string[] = []; // prefijo: a curar a mano

  for (const [, list] of byPub) {
    const mapped = list.filter((r) => r.anilistId != null);
    const unmapped = list.filter((r) => r.anilistId == null && r.whakoomId != null);
    for (const u of unmapped) {
      const exact = mapped.filter((m) => m.volumes === u.volumes && relate(m.normTitle, u.normTitle) === "exact");
      const pref = mapped.filter((m) => m.volumes === u.volumes && relate(m.normTitle, u.normTitle) === "prefix");
      if (exact.length === 1) {
        toDelete.push(u.id);
        console.log(`· borra #${u.id} "${u.title}" → queda #${exact[0].id} "${exact[0].title}" [${u.publisher}, ${u.volumes}t]`);
      } else if (pref.length >= 1) {
        review.push(`#${u.id} "${u.title}" (Whakoom) ~ #${pref[0].id} "${pref[0].title}" (mapeada) [${u.publisher}, ${u.volumes}t]`);
      }
    }
  }

  if (review.length) {
    console.log(`\n--- A REVISAR (prefijo: subtítulo vs secuela) — borrá los confirmados con --delete <ids> ---`);
    for (const r of review) console.log("  " + r);
  }

  console.log(`\n${toDelete.length} exactas a borrar (seguras); ${review.length} a revisar.`);

  if (!apply) {
    console.log("DRY-RUN: no se borró nada. Corré con --apply (borra solo las exactas).");
  } else if (toDelete.length) {
    const r = await prisma.publisherEdition.deleteMany({ where: { id: { in: toDelete } } });
    const orphans = await prisma.work.deleteMany({ where: { editions: { none: {} } } });
    console.log(`Borradas ${r.count} ediciones + ${orphans.count} works huérfanos.`);
  }

  await prisma.$disconnect();
}

main();
