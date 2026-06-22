/**
 * Migra las portadas existentes a Cloudflare R2: baja cada portada de su fuente
 * (hotlink/proxy) y la sube a R2, dejando la URL de R2 en `coverImage`. A partir
 * de ahí la portada es propia y no se pierde. Ver memoria covers-r2.
 *
 * Corré LOCAL (residencial) así también baja las de Whakoom (bloquea datacenter).
 *   node scripts/with-prod.mjs npx tsx scripts/migrate-covers-r2.ts [--limit N] [--dry]
 *
 * Idempotente y resumable: salta las que ya están en R2; corré varias veces.
 */
import { prisma } from "../lib/prisma";
import { storeCover, r2Configured } from "../lib/coverStore";
import { dbRetry } from "../lib/dbRetry";

const PUBLIC = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!r2Configured() || !PUBLIC) {
    console.error("✗ R2 no configurado (faltan vars R2_* en .env).");
    process.exit(1);
  }
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const limit = Number(arg("--limit")) || 300;
  const dry = process.argv.includes("--dry");

  // Portadas que todavía NO están en R2.
  const works = await dbRetry(() =>
    prisma.work.findMany({
      where: { coverImage: { not: null }, NOT: { coverImage: { startsWith: PUBLIC } } },
      select: { id: true, title: true, coverImage: true },
      take: limit,
    }),
  );
  const pending = await dbRetry(() =>
    prisma.work.count({
      where: { coverImage: { not: null }, NOT: { coverImage: { startsWith: PUBLIC } } },
    }),
  );
  console.log(`Portadas sin migrar: ${pending}. Procesando ${works.length}…\n`);

  let ok = 0;
  let fail = 0;
  for (const w of works) {
    if (dry) {
      ok++;
      continue;
    }
    const r = await storeCover(w.coverImage);
    if (r && r.startsWith(PUBLIC)) {
      await dbRetry(() => prisma.work.update({ where: { id: w.id }, data: { coverImage: r } }));
      ok++;
      if (ok <= 20) console.log(`  ✓ ${w.title}`);
    } else {
      fail++;
      if (fail <= 20) console.log(`  ✗ ${w.title} — fuente no responde (${w.coverImage?.slice(0, 50)})`);
    }
    await sleep(200);
  }

  console.log(`\n${dry ? "[DRY] " : ""}migradas ${ok} · fallaron ${fail} (fuente caída → quedan como están)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
