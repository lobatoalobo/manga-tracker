/**
 * Diagnóstico READ-ONLY de duplicados. Para una lista de workIds, muestra la
 * identidad de cada uno, sus ediciones, y los WORKS CANDIDATOS a ser el mismo
 * (por anilistId/muId/mdId compartido, o por título estricto / romaji base). NO
 * escribe nada. Sirve para decidir merges/cleanups sin asumir.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/inspect-dups.ts 2411 2308 938 …
 */
import { prisma } from "../lib/prisma";
import { tightTitleKey, romajiKey } from "../lib/catalog";

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Boolean);
  if (!ids.length) {
    console.error("uso: inspect-dups <workId…>");
    process.exit(1);
  }

  // Índice de TODOS los works para buscar partners por identidad/título/romaji.
  const all = await prisma.work.findMany({
    select: { id: true, title: true, normTitle: true, originalTitle: true, anilistId: true, muId: true, mdId: true },
  });
  const byTitle = new Map<string, number[]>();
  const byRomaji = new Map<string, number[]>();
  const byAni = new Map<number, number[]>();
  const byMu = new Map<string, number[]>();
  const byMd = new Map<string, number[]>();
  const push = <K>(m: Map<K, number[]>, k: K | null | undefined, id: number) => {
    if (k == null || k === "") return;
    (m.get(k) ?? m.set(k, []).get(k)!).push(id);
  };
  for (const w of all) {
    push(byTitle, tightTitleKey(w.title), w.id);
    if (w.originalTitle) push(byRomaji, romajiKey(w.originalTitle), w.id);
    push(byAni, w.anilistId, w.id);
    push(byMu, w.muId, w.id);
    push(byMd, w.mdId, w.id);
  }
  const meta = new Map(all.map((w) => [w.id, w]));

  for (const id of ids) {
    const w = meta.get(id);
    if (!w) {
      console.log(`\n#${id} — NO EXISTE`);
      continue;
    }
    // Partners candidatos (excluye self), con el motivo del match.
    const partners = new Map<number, string[]>();
    const add = (cands: number[] | undefined, why: string) => {
      for (const pid of cands ?? []) {
        if (pid === id) continue;
        (partners.get(pid) ?? partners.set(pid, []).get(pid)!).push(why);
      }
    };
    add(byAni.get(w.anilistId ?? -1), "anilistId");
    add(w.muId ? byMu.get(w.muId) : [], "muId");
    add(w.mdId ? byMd.get(w.mdId) : [], "mdId");
    add(byTitle.get(tightTitleKey(w.title)), "título");
    if (w.originalTitle) add(byRomaji.get(romajiKey(w.originalTitle)), "romaji");

    const eds = await prisma.publisherEdition.findMany({
      where: { workId: id },
      select: { id: true, publisher: true, slug: true, volumes: true, status: true, normTitle: true },
      orderBy: { publisher: "asc" },
    });
    // Ediciones duplicadas dentro del work: mismo publisher + normTitle.
    const edKey = new Map<string, number>();
    const dupEds: string[] = [];
    for (const e of eds) {
      const k = `${e.publisher}::${e.normTitle}`;
      if (edKey.has(k)) dupEds.push(`${e.publisher} (slugs duplicados)`);
      edKey.set(k, (edKey.get(k) ?? 0) + 1);
    }

    console.log(`\n#${id} «${w.title}»  ani=${w.anilistId ?? "—"} mu=${w.muId ?? "—"} md=${w.mdId ?? "—"} romaji=${w.originalTitle ?? "—"}`);
    for (const e of eds)
      console.log(`   · ${e.publisher} — ${e.slug} — ${e.volumes} tomos${e.status ? ` [${e.status}]` : ""}`);
    if (dupEds.length) console.log(`   ⚠ EDICIONES DUP: ${[...new Set(dupEds)].join(", ")}`);
    if (partners.size) {
      for (const [pid, whys] of partners) {
        const p = meta.get(pid)!;
        console.log(`   ↔ PARTNER #${pid} «${p.title}» (match: ${[...new Set(whys)].join("+")})`);
      }
    } else if (!dupEds.length) {
      console.log(`   (sin partner ni ediciones dup detectadas — revisar a mano)`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
