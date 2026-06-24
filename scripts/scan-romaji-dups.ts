/**
 * Diagnóstico (READ-ONLY) de Works que son la MISMA serie pero quedaron PARTIDOS
 * en dos (o más) por venir en distinto idioma (VIZ inglés/romaji vs Ivrea/Panini
 * español) sin compartir id externo. Agrupa por `romajiKey(originalTitle)` + autor
 * compatible. NO fusiona nada — es la cola de revisión para un merge manual.
 *
 * Usa el MISMO `romajiKey` que la prevención de `findOrCreateWork`, así que NO
 * agrupa una serie con su secuela (Citrus vs Citrus+ tienen claves distintas).
 *
 *   node scripts/with-prod.mjs npx tsx scripts/scan-romaji-dups.ts
 */
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { romajiKey, authorNameMatches } from "../lib/catalog";

async function main() {
  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: { originalTitle: { not: null } },
      select: {
        id: true, title: true, originalTitle: true, author: true, anilistId: true,
        muId: true, mdId: true, editions: { select: { publisher: true } },
      },
    }),
  );
  const byKey = new Map<string, typeof works>();
  for (const w of works) {
    const k = romajiKey(w.originalTitle!);
    if (k.length < 4) continue;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(w);
  }

  let groups = 0;
  for (const [k, ws] of byKey) {
    if (ws.length < 2) continue;
    const compat = ws.filter((a, i) =>
      ws.some((b, j) => i !== j && authorNameMatches(a.author ?? "", b.author)),
    );
    if (compat.length < 2) continue;
    groups++;
    const pubs = new Set(
      compat.flatMap((w) => w.editions.map((e) => e.publisher.replace(" Argentina", ""))),
    );
    console.log(`\n[${k}] (${[...pubs].join("+")})`);
    for (const w of compat)
      console.log(
        `   #${w.id} "${w.title}" autor=${w.author ?? "—"} AL=${w.anilistId ?? "—"} mu=${w.muId ?? "—"} md=${w.mdId ? "y" : "—"} [${w.editions.map((e) => e.publisher.replace(" Argentina", "")).join(",")}]`,
      );
  }
  console.log(`\n=== ${groups} grupos romaji con works separados + autor compatible ===`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
