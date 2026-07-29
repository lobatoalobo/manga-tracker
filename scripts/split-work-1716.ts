/**
 * SPLIT PUNTUAL de Work #1716 "Reborn": separa el manga Katekyo Hitman Reborn!
 * (que se queda en #1716) del cómic "Reborn" de Mark Millar (edición Utopía, que
 * se mueve a un Work nuevo). Corrige la contaminación cross-type previa al guard
 * de `findOrCreateWork`. Ver diseño B.2 y memoria del arco cross-type.
 *
 * Default = DRY-RUN (no escribe). `--apply` ejecuta todo en UNA transacción y
 * deja un backup JSON para rollback. `--rollback <backup.json>` revierte.
 *
 *   node scripts/with-prod.mjs npx tsx scripts/split-work-1716.ts            # dry-run
 *   node scripts/with-prod.mjs npx tsx scripts/split-work-1716.ts --apply
 *   node scripts/with-prod.mjs npx tsx scripts/split-work-1716.ts --rollback scripts/.backup-split-1716-<ts>.json
 */
import { writeFileSync, readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { dbRetry } from "../lib/dbRetry";
import { normalizeTitle } from "../lib/catalog";

const WORK_ID = 1716;
const AL = 30047; // anilistId del manga (se queda en #1716)
const VIZ = "VIZ Media"; // ediciones manga que se quedan
const COMIC_PUBLISHER = "Utopía Editorial"; // edición cómic que se mueve
// key/editionKey con que la edición Utopía aparece en user-data (colección/wishlist).
const COMIC_EDITION_KEYS = ["utopia"];

const MANGA_FIX = { title: "Katekyo Hitman Reborn!", author: "Akira Amano", type: "MANGA" };
const COMIC_NEW = { title: "Reborn", author: "Mark Millar", type: "COMIC" };

type Backup = {
  ts: string;
  newWorkId: number;
  work1716Before: { title: string; normTitle: string; author: string | null; type: string };
  comicEdition: { id: number; workIdBefore: number | null; anilistIdBefore: number | null };
  wishlistMoved: { id: number; anilistIdBefore: number }[];
  trackedMoved: { id: number; mangaIdBefore: number; newMangaId: number }[];
  mangaCreated: number[];
  editionsCacheDeleted: unknown[];
};

async function loadState() {
  const work = await dbRetry(() => prisma.work.findUnique({ where: { id: WORK_ID } }));
  if (!work) throw new Error(`Work #${WORK_ID} no existe`);
  const editions = await dbRetry(() =>
    prisma.publisherEdition.findMany({
      where: { workId: WORK_ID },
      select: {
        id: true, publisher: true, slug: true, title: true, volumes: true,
        anilistId: true, synopsis: true,
        volumesList: { select: { number: true, coverImage: true }, orderBy: { number: "asc" } },
      },
    }),
  );
  const comicEds = editions.filter((e) => e.publisher !== VIZ);
  const mangaEds = editions.filter((e) => e.publisher === VIZ);
  return { work, editions, comicEds, mangaEds };
}

function assertSplittable(s: Awaited<ReturnType<typeof loadState>>) {
  const errs: string[] = [];
  if (s.work.type !== "COMIC")
    errs.push(`type actual = ${s.work.type} (esperaba COMIC; ¿ya se corrió el split?)`);
  if (s.comicEds.length !== 1)
    errs.push(`ediciones no-VIZ = ${s.comicEds.length} (esperaba 1: la Utopía)`);
  else if (s.comicEds[0].publisher !== COMIC_PUBLISHER)
    errs.push(`la edición cómic es "${s.comicEds[0].publisher}", no "${COMIC_PUBLISHER}"`);
  if (s.mangaEds.length < 1) errs.push("no hay ediciones VIZ (manga) para retener");
  if (errs.length) throw new Error("Estado inesperado, abortando:\n  - " + errs.join("\n  - "));
}

async function userDataReport(comicKeys: string[]) {
  const ids = [AL, -WORK_ID];
  const wishlist = await dbRetry(() =>
    prisma.wishlistItem.findMany({ where: { anilistId: { in: ids }, editionKey: { in: comicKeys } } }),
  );
  const mangaWithComicEd = await dbRetry(() =>
    prisma.manga.findMany({
      where: { anilistId: { in: ids }, editions: { some: { key: { in: comicKeys } } } },
      include: { editions: { where: { key: { in: comicKeys } }, include: { ownedVolumes: true } } },
    }),
  );
  // Series-level (pertenecen al manga que retiene AL): solo se REPORTAN.
  const seriesLevel = {
    UserNote: await dbRetry(() => prisma.userNote.count({ where: { anilistId: { in: ids } } })),
    PurchaseItem: await dbRetry(() => prisma.purchaseItem.count({ where: { anilistId: { in: ids } } })),
    SeriesNotifMute: await dbRetry(() => prisma.seriesNotifMute.count({ where: { anilistId: { in: ids } } })),
    Activity: await dbRetry(() => prisma.activity.count({ where: { anilistId: { in: ids } } })),
    Notification: await dbRetry(() => prisma.notification.count({ where: { anilistId: { in: ids } } })),
    UserFav: await dbRetry(() => prisma.user.count({ where: { favoriteAnilistId: { in: ids } } })),
    IvreaRelease: await dbRetry(() => prisma.ivreaRelease.count({ where: { anilistId: { in: ids } } })),
  };
  const editionsCache = await dbRetry(() => prisma.editionsCache.findMany({ where: { anilistId: { in: ids } } }));
  return { wishlist, mangaWithComicEd, seriesLevel, editionsCache };
}

async function dryRun() {
  const s = await loadState();
  assertSplittable(s);
  const comicEd = s.comicEds[0];
  const comicCover = comicEd.volumesList[0]?.coverImage ?? null;
  const ud = await userDataReport(COMIC_EDITION_KEYS);

  console.log(`=== DRY-RUN split #${WORK_ID} (nada escrito) ===\n`);
  console.log(`#${WORK_ID} AHORA: title="${s.work.title}" author="${s.work.author}" type=${s.work.type}`);
  console.log(`#${WORK_ID} QUEDA (manga): title="${MANGA_FIX.title}" author="${MANGA_FIX.author}" type=${MANGA_FIX.type}`);
  console.log(`   conserva anilistId=${s.work.anilistId} muId=${s.work.muId} mdId=${s.work.mdId ? "y" : "—"} + metadata manga`);
  console.log(`   ediciones que se quedan: ${s.mangaEds.map((e) => `#${e.id} ${e.publisher}`).join(", ")}`);
  console.log(`\nWork NUEVO (cómic): title="${COMIC_NEW.title}" author="${COMIC_NEW.author}" type=${COMIC_NEW.type}`);
  console.log(`   sin anilistId/muId/mdId · cover=${comicCover ?? "null"} · synopsisEs=${comicEd.synopsis ? "(de la edición)" : "null"}`);
  console.log(`   se mueve edición #${comicEd.id} ${comicEd.publisher} (anilistId ${comicEd.anilistId} → null)`);
  console.log(`\n--- user-data asociada al cómic (a repuntar a -newWorkId) ---`);
  console.log(`   WishlistItem(editionKey∈${JSON.stringify(COMIC_EDITION_KEYS)}): ${ud.wishlist.length}`);
  console.log(`   Manga con TrackedEdition cómic: ${ud.mangaWithComicEd.length}`);
  console.log(`   EditionsCache a borrar (rebuild): ${ud.editionsCache.length}`);
  console.log(`--- series-level (se quedan con el manga / AL=${AL}, solo informativo) ---`);
  for (const [k, n] of Object.entries(ud.seriesLevel)) console.log(`   ${k}: ${n}`);
  console.log(`\nSin --apply no se escribe nada.`);
}

async function apply() {
  const s = await loadState();
  assertSplittable(s);
  const comicEd = s.comicEds[0];
  const comicCover = comicEd.volumesList[0]?.coverImage ?? null;
  const ud = await userDataReport(COMIC_EDITION_KEYS);
  const ids = [AL, -WORK_ID];

  const backup: Backup = {
    ts: new Date().toISOString(),
    newWorkId: -1,
    work1716Before: { title: s.work.title, normTitle: s.work.normTitle, author: s.work.author, type: s.work.type },
    comicEdition: { id: comicEd.id, workIdBefore: WORK_ID, anilistIdBefore: comicEd.anilistId },
    wishlistMoved: [],
    trackedMoved: [],
    mangaCreated: [],
    editionsCacheDeleted: ud.editionsCache,
  };

  const newWorkId = await prisma.$transaction(async (tx) => {
    // 1. Work nuevo para el cómic (sin ids manga, sin metadata heredada).
    const comic = await tx.work.create({
      data: {
        title: COMIC_NEW.title,
        normTitle: normalizeTitle(COMIC_NEW.title),
        author: COMIC_NEW.author,
        type: COMIC_NEW.type,
        coverImage: comicCover,
        synopsisEs: comicEd.synopsis ?? null,
      },
    });
    backup.newWorkId = comic.id;

    // 2. Mover la edición Utopía al Work nuevo + limpiar su anilistId manga.
    await tx.publisherEdition.update({
      where: { id: comicEd.id },
      data: { workId: comic.id, anilistId: null },
    });

    // 3. Corregir #1716 a manga.
    await tx.work.update({
      where: { id: WORK_ID },
      data: {
        title: MANGA_FIX.title,
        normTitle: normalizeTitle(MANGA_FIX.title),
        author: MANGA_FIX.author,
        type: MANGA_FIX.type,
      },
    });

    // 4. User-data del cómic → -newWorkId. (En prod: 0 filas; soportado igual.)
    for (const w of ud.wishlist) {
      backup.wishlistMoved.push({ id: w.id, anilistIdBefore: w.anilistId });
      await tx.wishlistItem.update({ where: { id: w.id }, data: { anilistId: -comic.id } });
    }
    for (const m of ud.mangaWithComicEd) {
      let target = await tx.manga.findUnique({
        where: { userId_anilistId: { userId: m.userId, anilistId: -comic.id } },
      });
      if (!target) {
        target = await tx.manga.create({
          data: {
            userId: m.userId, anilistId: -comic.id,
            romajiTitle: COMIC_NEW.title, coverImage: comicCover ?? "",
          },
        });
        backup.mangaCreated.push(target.id);
      }
      for (const e of m.editions) {
        backup.trackedMoved.push({ id: e.id, mangaIdBefore: m.id, newMangaId: target.id });
        await tx.trackedEdition.update({ where: { id: e.id }, data: { mangaId: target.id } });
      }
    }
    // 5. Cache derivado: borrar (se reconstruye).
    if (ud.editionsCache.length)
      await tx.editionsCache.deleteMany({ where: { anilistId: { in: ids } } });

    return comic.id;
  });

  const file = `scripts/.backup-split-1716-${backup.ts.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`✓ APLICADO. newWorkId = ${newWorkId}`);
  console.log(`  backup → ${file}`);
  console.log(`  siguiente: re-correr scan-crosstype (0 MERGE) + abrir ambas fichas.`);
}

async function rollback(file: string) {
  const b = JSON.parse(readFileSync(file, "utf8")) as Backup;
  await prisma.$transaction(async (tx) => {
    // Revertir user-data.
    for (const w of b.wishlistMoved)
      await tx.wishlistItem.update({ where: { id: w.id }, data: { anilistId: w.anilistIdBefore } });
    for (const t of b.trackedMoved)
      await tx.trackedEdition.update({ where: { id: t.id }, data: { mangaId: t.mangaIdBefore } });
    if (b.mangaCreated.length)
      await tx.manga.deleteMany({ where: { id: { in: b.mangaCreated } } });
    // Devolver la edición al #1716.
    await tx.publisherEdition.update({
      where: { id: b.comicEdition.id },
      data: { workId: b.comicEdition.workIdBefore, anilistId: b.comicEdition.anilistIdBefore },
    });
    // Restaurar campos de #1716.
    await tx.work.update({
      where: { id: WORK_ID },
      data: b.work1716Before,
    });
    // Borrar el Work cómic (ya sin ediciones).
    await tx.work.delete({ where: { id: b.newWorkId } });
    // Nota: EditionsCache borrado se reconstruye solo; no se restaura.
  });
  console.log(`✓ ROLLBACK aplicado desde ${file}. Work cómic ${b.newWorkId} eliminado, #${WORK_ID} restaurado.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const rbIdx = argv.indexOf("--rollback");
  if (rbIdx !== -1) {
    const file = argv[rbIdx + 1];
    if (!file) throw new Error("--rollback requiere <backup.json>");
    await rollback(file);
  } else if (argv.includes("--apply")) {
    await apply();
  } else {
    await dryRun();
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
