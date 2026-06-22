/**
 * Regenera SOLO las portadas de obras con edición Ivrea, desde la ficha de Ivrea
 * (hotlink ivrea.com.ar, no necesita proxy). No toca tomos/releases/nada más —
 * a diferencia del crawl completo. Por defecto solo las que están SIN portada;
 * con --force refresca todas las de Ivrea (p. ej. para reemplazar una rota).
 *
 *   node scripts/with-prod.mjs npx tsx scripts/ivrea-covers.ts [--limit N] [--dry] [--force]
 */
import { prisma } from "../lib/prisma";
import { getIvreaDataBySlug } from "../lib/providers/ivrea";
import { storeCover } from "../lib/coverStore";
import { dbRetry } from "../lib/dbRetry";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const limit = Number(arg("--limit")) || 200;
  const dryRun = process.argv.includes("--dry");
  const force = process.argv.includes("--force");

  // Ediciones de Ivrea cuya obra necesita portada (o todas, con --force).
  const eds = await dbRetry(() =>
    prisma.publisherEdition.findMany({
      where: {
        publisher: "Ivrea Argentina",
        workId: { not: null },
        // NUNCA pisamos una portada editada a mano (curada), ni con --force.
        work: force
          ? { NOT: { curated: { has: "coverImage" } } }
          : { coverImage: null, NOT: { curated: { has: "coverImage" } } },
      },
      select: { slug: true, workId: true, work: { select: { title: true } } },
      take: limit,
    }),
  );
  console.log(
    `${eds.length} ediciones Ivrea a revisar${force ? " (force: todas)" : " (sin portada)"}…\n`,
  );

  let updated = 0;
  let noCover = 0;
  for (const e of eds) {
    const ficha = await getIvreaDataBySlug(e.slug).catch(() => null);
    const raw = ficha?.coverImage ?? null;
    // La guardamos en R2 (propia); si R2 no está/falla, queda el hotlink de Ivrea.
    const cover = raw ? ((await storeCover(raw)) ?? raw) : null;
    if (!cover) {
      noCover++;
    } else {
      if (!dryRun)
        await dbRetry(() =>
          prisma.work.update({ where: { id: e.workId! }, data: { coverImage: cover } }),
        ).catch(() => {});
      updated++;
      if (updated <= 25) console.log(`  ✓ ${e.work?.title} → ${cover.slice(0, 70)}`);
    }
    await sleep(300);
  }

  console.log(
    `\n${dryRun ? "[DRY] " : ""}${updated} portadas ${dryRun ? "a actualizar" : "actualizadas"} · ${noCover} sin portada en la ficha`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
