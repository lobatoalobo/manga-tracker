/**
 * Re-crawlea fichas de Ivrea para traer el conteo de tomos AR REAL y resolver las
 * "contradicciones" (próximo tomo #N con la edición diciendo ≥N tomos). Corré
 * cuando Ivrea esté ARRIBA (hoy a veces cae). No asume nada: lee la ficha y
 * actualiza volumes = argentinaVolumes. Si tras traer el conteo real sigue
 * habiendo contradicción (volume ≤ tomos), lo marca como PROBABLE REEDICIÓN para
 * revisar el parser de /proximas/ (no cambia el kind solo).
 *
 *   node scripts/with-prod.mjs npx tsx scripts/recrawl-ivrea.ts --contradictions [--dry]
 *   node scripts/with-prod.mjs npx tsx scripts/recrawl-ivrea.ts --works 803,814 [--dry]
 */
import { prisma } from "../lib/prisma";
import { getIvreaDataBySlug } from "../lib/providers/ivrea";
import { dbRetry } from "../lib/dbRetry";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function targetEditions(): Promise<
  { id: number; slug: string; volumes: number; workId: number | null; title: string; prox: number | null }[]
> {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const worksArg = arg("--works");
  if (worksArg) {
    const ids = worksArg.split(",").map(Number).filter(Boolean);
    const eds = await dbRetry(() =>
      prisma.publisherEdition.findMany({
        where: { publisher: "Ivrea Argentina", workId: { in: ids } },
        select: { id: true, slug: true, volumes: true, workId: true, work: { select: { title: true } } },
      }),
    );
    return eds.map((e) => ({ id: e.id, slug: e.slug, volumes: e.volumes, workId: e.workId, title: e.work?.title ?? "", prox: null }));
  }
  // --contradictions: próximo tomo (kind volume, futuro) con volume ≤ tomos.
  const today = new Date(new Date().toISOString().slice(0, 10));
  const rels = await dbRetry(() =>
    prisma.ivreaRelease.findMany({
      where: { kind: "volume", releaseDate: { gte: today } },
      select: { volume: true, editionId: true },
    }),
  );
  const edIds = [...new Set(rels.map((r) => r.editionId).filter((x): x is number => x != null))];
  const eds = await dbRetry(() =>
    prisma.publisherEdition.findMany({
      where: { id: { in: edIds }, publisher: "Ivrea Argentina" },
      select: { id: true, slug: true, volumes: true, workId: true, work: { select: { title: true } } },
    }),
  );
  const edMap = new Map(eds.map((e) => [e.id, e]));
  const out: { id: number; slug: string; volumes: number; workId: number | null; title: string; prox: number | null }[] = [];
  for (const r of rels) {
    const e = r.editionId != null ? edMap.get(r.editionId) : null;
    if (e && r.volume != null && r.volume <= e.volumes)
      out.push({ id: e.id, slug: e.slug, volumes: e.volumes, workId: e.workId, title: e.work?.title ?? "", prox: r.volume });
  }
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const targets = await targetEditions();
  console.log(`${targets.length} ediciones Ivrea a re-crawlear…\n`);

  let fixed = 0;
  let reissue = 0;
  let unreachable = 0;
  for (const t of targets) {
    const d = await getIvreaDataBySlug(t.slug).catch(() => null);
    if (!d) {
      unreachable++;
      console.log(`  ? ${t.title} — ficha no accesible (¿Ivrea caída?)`);
      await sleep(400);
      continue;
    }
    const real = d.argentinaVolumes;
    const changed = real !== t.volumes;
    if (changed && !dry)
      await dbRetry(() =>
        prisma.publisherEdition.update({ where: { id: t.id }, data: { volumes: real, status: d.argentinaStatus } }),
      ).catch(() => {});
    if (changed) fixed++;
    const stillBad = t.prox != null && t.prox <= real;
    if (stillBad) reissue++;
    console.log(
      `  /serie/${t.workId} ${t.title}: ${t.volumes}→${real} tomos` +
        (t.prox != null ? ` · próximo #${t.prox}${stillBad ? " → PROBABLE REEDICIÓN (revisar parser)" : " (tomo nuevo OK)"}` : ""),
    );
    await sleep(400);
  }

  console.log(
    `\n${dry ? "[DRY] " : ""}${fixed} conteos corregidos · ${reissue} probables reediciones · ${unreachable} fichas caídas`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
