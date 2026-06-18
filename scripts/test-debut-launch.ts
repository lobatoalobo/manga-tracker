/**
 * Simula que SALE una serie nueva (debut) que el usuario tiene en DESEADOS:
 * le crea una edición de Ivrea publicada (1 tomo), saca el flag "próximo a salir"
 * y dispara el aviso de deseados. Sirve para ver que se popule "para comprar".
 *
 *   node scripts/with-staging.mjs npx tsx scripts/test-debut-launch.ts <email> <substr-título>
 *   (ej: ... <email> akebi)
 */
import { prisma } from "../lib/prisma";
import { slugifyTitle, normalizeTitle } from "../lib/catalog";
import { getWishlistToBuy } from "../lib/shopping";
import { detectAndNotifyWishlistAvailable } from "../lib/catalogNotify";

async function main() {
  const [email, sub] = process.argv.slice(2);
  if (!email || !sub) return console.error("Uso: ... <email> <substr-título>");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return console.error("No existe ese usuario.");

  const work = await prisma.work.findFirst({
    where: { title: { contains: sub, mode: "insensitive" } },
    select: { id: true, title: true, coverImage: true },
  });
  if (!work) return console.error(`No hay obra que matchee "${sub}".`);
  console.log(`Obra: ${work.title} (workId ${work.id})`);

  // Crear/actualizar edición de Ivrea publicada (tomo 1).
  const slug = slugifyTitle(work.title);
  const existing = await prisma.publisherEdition.findFirst({
    where: { workId: work.id, publisher: "Ivrea Argentina" },
    select: { id: true },
  });
  if (existing) {
    await prisma.publisherEdition.update({ where: { id: existing.id }, data: { volumes: 1 } });
  } else {
    await prisma.publisherEdition.create({
      data: {
        publisher: "Ivrea Argentina",
        slug,
        title: work.title,
        normTitle: normalizeTitle(work.title),
        volumes: 1,
        status: "EN CURSO",
        url: `https://www.ivrea.com.ar/titulo/${slug}/`,
        workId: work.id,
      },
    });
  }
  // Ya salió → no es "próximo a salir".
  await prisma.work.update({ where: { id: work.id }, data: { upcoming: false } });

  const wl = await detectAndNotifyWishlistAvailable();
  const buy = await getWishlistToBuy(user.id);
  console.log(`\nAviso deseados disponibles: ${wl.notifications} noti(s)`);
  console.log("Para comprar (deseados ya salieron):");
  for (const b of buy) console.log(`  ${b.title} (${b.publisher}, ${b.total}t)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
