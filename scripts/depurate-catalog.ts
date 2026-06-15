/**
 * Depuración del catálogo: una sola edición por (obra, editorial) — la más
 * completa (la regular). Borra specials, variantes y duplicados, que tienen
 * menos tomos o son copias. Lo demás se re-agrega después (comunidad/manual).
 *
 *   npx tsx scripts/depurate-catalog.ts            # dry-run (no borra, solo muestra)
 *   npx tsx scripts/depurate-catalog.ts --apply    # ejecuta los borrados
 *
 * Criterio de "más completa": más tomos; a igualdad, la que tiene whakoomId
 * (más datos: portada + tomos), y a igualdad, el id más bajo (la más vieja).
 * Corre contra DATABASE_URL (.env). Borrar una edición no afecta el tracking de
 * usuarios (va por otra llave) y cascada borra sus Volume.
 */
import { prisma } from "../lib/prisma";

interface Row {
  id: number;
  workId: number | null;
  anilistId: number | null;
  publisher: string;
  title: string;
  volumes: number;
  whakoomId: string | null;
}

function rank(a: Row, b: Row): number {
  if (b.volumes !== a.volumes) return b.volumes - a.volumes; // más tomos primero
  const aw = a.whakoomId ? 1 : 0;
  const bw = b.whakoomId ? 1 : 0;
  if (bw !== aw) return bw - aw; // con whakoomId primero
  return a.id - b.id; // más vieja primero
}

// Normalización ESTRICTA: mantiene "+", números y letras, para NO fusionar
// homónimos tipo Citrus / Citrus+ (que normTitle sí fusiona al sacar el "+").
function tightNorm(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

// Palabras que marcan una edición NO-regular (special/variante/deluxe…).
const SPECIAL =
  /especial|deluxe|kanzenban|kanzen|coleccionista|aniversario|integral|omnibus|ómnibus|absolute|variante|limitada|maximum|gold|box\b/i;

/**
 * ¿Es seguro borrar `drop` en favor de `keep`? Sí cuando es claramente lo mismo:
 * título idéntico (estricto), o `drop` es un special con palabra clave que `keep`
 * no tiene. Si no, es ambiguo (posible homónimo) → se marca, no se borra.
 */
function safeToCollapse(keep: Row, drop: Row): boolean {
  if (tightNorm(keep.title) === tightNorm(drop.title)) return true;
  if (SPECIAL.test(drop.title) && !SPECIAL.test(keep.title)) return true;
  return false;
}

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");

  const rows: Row[] = await prisma.publisherEdition.findMany({
    select: {
      id: true,
      workId: true,
      anilistId: true,
      publisher: true,
      title: true,
      volumes: true,
      whakoomId: true,
    },
  });

  // Agrupar por (serie, editorial). La "serie" es el anilistId si está (fuerte:
  // junta ediciones del mismo anilistId aunque tengan distinto workId, p. ej.
  // Battle Royale regular + deluxe), y si no, el workId. Sin ninguno, no agrupa.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const series =
      r.anilistId != null ? `a${r.anilistId}` : r.workId != null ? `w${r.workId}` : null;
    if (!series) continue;
    const key = `${r.publisher}|${series}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const toDelete: number[] = [];
  const flagged: string[] = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    list.sort(rank);
    const keep = list[0];
    for (const drop of list.slice(1)) {
      if (safeToCollapse(keep, drop)) {
        toDelete.push(drop.id);
        console.log(
          `· borra #${drop.id} "${drop.title}" (${drop.volumes}t) → queda #${keep.id} "${keep.title}" (${keep.volumes}t) [${keep.publisher}]`,
        );
      } else {
        flagged.push(
          `⚠ #${keep.id} "${keep.title}" (${keep.volumes}t) vs #${drop.id} "${drop.title}" (${drop.volumes}t) [${keep.publisher}]`,
        );
      }
    }
  }

  if (flagged.length) {
    console.log(`\n--- A REVISAR a mano (posibles homónimos, NO se tocan) ---`);
    for (const f of flagged) console.log(f);
  }

  console.log(
    `\n${toDelete.length} ediciones a borrar (seguras); ${flagged.length} marcadas para revisión.`,
  );

  if (!apply) {
    console.log("DRY-RUN: no se borró nada. Corré con --apply para ejecutar.");
  } else if (toDelete.length) {
    const r = await prisma.publisherEdition.deleteMany({
      where: { id: { in: toDelete } },
    });
    console.log(`Borradas ${r.count} ediciones (sus Volume se borraron en cascada).`);
  }

  // Limpieza de Works huérfanos (sin ninguna edición), p. ej. tras borrar
  // cómics o duplicados. Una obra sin ediciones no representa nada.
  const orphans = await prisma.work.count({ where: { editions: { none: {} } } });
  if (orphans > 0) {
    if (!apply) {
      console.log(`(${orphans} works huérfanos se borrarían con --apply.)`);
    } else {
      const r = await prisma.work.deleteMany({ where: { editions: { none: {} } } });
      console.log(`Borrados ${r.count} works huérfanos.`);
    }
  }

  await prisma.$disconnect();
}

main();
