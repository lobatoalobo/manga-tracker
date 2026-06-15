/**
 * Consolida duplicados de misma editorial + título (los que lista "Posibles
 * duplicados" en admin): la misma serie cargada por el crawl y por el seed de
 * Whakoom. Junta lo mejor en UNA edición —anilistId + link real de la editorial
 * (no Whakoom) + whakoomId— y borra la sobrante.
 *
 *   npx tsx scripts/consolidate-dups.ts            # dry-run
 *   npx tsx scripts/consolidate-dups.ts --apply
 *
 * SEGURO: solo consolida ediciones con mismo título normalizado Y mismos tomos.
 * Si los tomos difieren (posible serie distinta tipo Citrus/Citrus+), las marca
 * para revisión y no las toca.
 */
import { prisma } from "../lib/prisma";
import { tightTitleKey } from "../lib/catalog";

const isWhakoom = (u: string) => /whakoom\.com/i.test(u);

interface Row {
  id: number;
  publisher: string;
  title: string;
  normTitle: string;
  volumes: number;
  anilistId: number | null;
  whakoomId: string | null;
  url: string;
}

async function main() {
  const apply = process.argv.slice(2).some((a) => a === "--apply" || a === "apply");

  const rows: Row[] = await prisma.publisherEdition.findMany({
    select: {
      id: true, publisher: true, title: true, normTitle: true,
      volumes: true, anilistId: true, whakoomId: true, url: true,
    },
  });

  // Agrupar por (editorial, título ESTRICTO, tomos). La llave estricta preserva
  // "+"/números para no juntar homónimos (Citrus vs Citrus+) ni con mismos tomos.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.publisher}|${tightTitleKey(r.title)}|${r.volumes}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  let consolidated = 0;
  const toDelete: number[] = [];
  const cachesToFlush = new Set<number>();

  for (const [, grp] of groups) {
    if (grp.length < 2) continue;

    // Keeper: prioriza tener anilistId, después link real (no Whakoom), id bajo.
    grp.sort((a, b) => {
      const am = a.anilistId ? 1 : 0;
      const bm = b.anilistId ? 1 : 0;
      if (am !== bm) return bm - am;
      const ar = isWhakoom(a.url) ? 0 : 1;
      const br = isWhakoom(b.url) ? 0 : 1;
      if (ar !== br) return br - ar;
      return a.id - b.id;
    });
    const keep = grp[0];
    const rest = grp.slice(1);

    // Merge: completar lo que al keeper le falta desde las hermanas.
    const patch: { anilistId?: number; url?: string; whakoomId?: string } = {};
    if (!keep.anilistId) {
      const m = rest.find((r) => r.anilistId);
      if (m?.anilistId) patch.anilistId = m.anilistId;
    }
    if (isWhakoom(keep.url)) {
      const real = rest.find((r) => !isWhakoom(r.url));
      if (real) patch.url = real.url;
    }
    if (!keep.whakoomId) {
      const w = rest.find((r) => r.whakoomId);
      if (w?.whakoomId) patch.whakoomId = w.whakoomId;
    }

    console.log(
      `· queda #${keep.id} "${keep.title}" [${keep.publisher}, ${keep.volumes}t]` +
        ` ${patch.anilistId ? `+anilist ${patch.anilistId} ` : ""}${patch.url ? "+url-real " : ""}` +
        `→ borra ${rest.map((r) => `#${r.id}`).join(", ")}`,
    );

    if (apply) {
      // Borramos las hermanas ANTES de aplicar el patch (evita choque de unique
      // whakoomId/anilistId entre la que queda y las que se van).
      await prisma.publisherEdition.deleteMany({ where: { id: { in: rest.map((r) => r.id) } } });
      if (Object.keys(patch).length)
        await prisma.publisherEdition.update({ where: { id: keep.id }, data: patch }).catch(() => {});
    }
    toDelete.push(...rest.map((r) => r.id));
    if (keep.anilistId) cachesToFlush.add(keep.anilistId);
    if (patch.anilistId) cachesToFlush.add(patch.anilistId);
    consolidated++;
  }

  console.log(`\n${consolidated} grupos consolidados; ${toDelete.length} ediciones borradas.`);
  if (apply) {
    const orphans = await prisma.work.deleteMany({ where: { editions: { none: {} } } });
    if (cachesToFlush.size)
      await prisma.editionsCache.deleteMany({ where: { anilistId: { in: [...cachesToFlush] } } });
    console.log(`Works huérfanos borrados: ${orphans.count}.`);
  } else {
    console.log("DRY-RUN: nada cambiado. Corré con --apply.");
  }

  await prisma.$disconnect();
}

main();
