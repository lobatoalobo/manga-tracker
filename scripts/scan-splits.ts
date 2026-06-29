/**
 * Scan READ-ONLY de works partidos: grupos de works DISTINTOS que comparten
 * romaji base o título estricto pero NO un id externo (el patrón de "misma serie
 * en dos Works"). Excluye los que ya comparten anilistId/mu/md (esos son otra
 * cosa). Solo reporta — no escribe. Para encontrar dups que no se vieron a mano.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/scan-splits.ts
 */
import { prisma } from "../lib/prisma";
import { tightTitleKey, romajiKey } from "../lib/catalog";

async function main() {
  const all = await prisma.work.findMany({
    select: { id: true, title: true, originalTitle: true, anilistId: true, muId: true, mdId: true },
  });

  const groups = new Map<string, typeof all>();
  const add = (k: string, w: (typeof all)[number]) => {
    if (!k) return;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(w);
  };
  for (const w of all) {
    add("t:" + tightTitleKey(w.title), w);
    if (w.originalTitle) add("r:" + romajiKey(w.originalTitle), w);
  }

  const seen = new Set<string>();
  let n = 0;
  for (const [, ws] of groups) {
    const ids = [...new Set(ws.map((w) => w.id))];
    if (ids.length < 2) continue;
    // ¿comparten algún id externo? entonces no es "split" (misma identidad).
    const anis = new Set(ws.map((w) => w.anilistId).filter(Boolean));
    const mus = new Set(ws.map((w) => w.muId).filter(Boolean));
    const mds = new Set(ws.map((w) => w.mdId).filter(Boolean));
    const sharesId =
      [...anis].some((a) => ws.filter((w) => w.anilistId === a).length > 1) ||
      [...mus].some((m) => ws.filter((w) => w.muId === m).length > 1) ||
      [...mds].some((m) => ws.filter((w) => w.mdId === m).length > 1);
    if (sharesId) continue;
    const key = ids.sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    n++;
    console.log(
      `\n[${n}] ` +
        ws
          .map((w) => `#${w.id} «${w.title}»${w.anilistId ? ` ani=${w.anilistId}` : ""}${w.muId ? " mu" : ""}${w.mdId ? " md" : ""}`)
          .join("  ↔  "),
    );
  }
  console.log(`\n${n} grupo(s) candidato(s) a serie partida.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
