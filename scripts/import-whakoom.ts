/**
 * Import local de ediciones de Whakoom (seed offline). Corre desde tu máquina,
 * donde el fetch a Whakoom no está bloqueado (los servers de Vercel sí pueden
 * estarlo), y escribe en la DB de `DATABASE_URL` (.env = producción).
 *
 *   npx tsx scripts/import-whakoom.ts <url-de-edicion> [<url2> ...]
 *
 * Ej: npx tsx scripts/import-whakoom.ts https://www.whakoom.com/ediciones/379335/slam_dunk-rustica
 */
import { importWhakoomUrl } from "../lib/whakoomImport";
import { prisma } from "../lib/prisma";

async function main() {
  const urls = process.argv.slice(2).filter(Boolean);
  if (urls.length === 0) {
    console.error(
      "Uso: npx tsx scripts/import-whakoom.ts <url-de-edicion-de-whakoom> [<url2> ...]",
    );
    process.exit(1);
  }

  let ok = 0;
  for (const url of urls) {
    const r = await importWhakoomUrl(url).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : "error",
    }));

    if (!r.ok) {
      console.log(`✗ ${url}\n    ${r.error}`);
      continue;
    }
    ok++;
    const vols = r.editionId
      ? await prisma.volume.count({ where: { editionId: r.editionId } })
      : 0;
    console.log(
      `✓ ${r.publisher} · ${r.title} — edición #${r.editionId}, ${vols} tomos` +
        `, AniList ${r.anilistId ?? "sin mapear"}`,
    );
  }

  console.log(`\n${ok}/${urls.length} importadas.`);
  await prisma.$disconnect();
}

main();
