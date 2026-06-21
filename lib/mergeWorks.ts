import { prisma } from "@/lib/prisma";

export interface MergeReport {
  sourceId: number;
  targetId: number;
  editionsMoved: number;
}

/**
 * Fusiona dos `Work` que son la MISMA serie pero quedaron separados (típico: una
 * edición se importó sin anilistId → Work por título; el anilistId se resolvió
 * después sobre la edición y nunca reconcilió el Work). Ver lib/catalog
 * `findOrCreateWork` y la memoria anilist-removal.
 *
 * Mueve las ediciones del `source` al `target`, re-clavea TODA la data de usuario
 * que vive en el "espacio de ids del dominio" (anilistId; para obras locales la
 * clave es `-workId`), resolviendo los choques de unicidad por usuario, y borra el
 * Work source. El `target` es el que se conserva (elegí el que tiene anilistId /
 * mejor ficha). Idempotente-ish: si no hay nada que mover, no rompe.
 */
export async function mergeWorks(
  sourceId: number,
  targetId: number,
): Promise<MergeReport> {
  if (sourceId === targetId) throw new Error("source y target son el mismo Work");
  const [src, tgt] = await Promise.all([
    prisma.work.findUnique({
      where: { id: sourceId },
      select: {
        id: true, anilistId: true, coverImage: true, author: true,
        synopsis: true, originalTitle: true, upcoming: true,
      },
    }),
    prisma.work.findUnique({
      where: { id: targetId },
      select: {
        id: true, anilistId: true, coverImage: true, author: true,
        synopsis: true, originalTitle: true, upcoming: true,
      },
    }),
  ]);
  if (!src) throw new Error(`Work source ${sourceId} no existe`);
  if (!tgt) throw new Error(`Work target ${targetId} no existe`);

  const negSrc = -sourceId;
  const negTgt = -targetId;
  let editionsMoved = 0;

  await prisma.$transaction(
    async (tx) => {
      // 1) Ediciones del source → target (el núcleo del dedup).
      const moved = await tx.publisherEdition.updateMany({
        where: { workId: sourceId },
        data: { workId: targetId },
      });
      editionsMoved = moved.count;

      // 2) Backfill de campos del target desde el source (sin pisar lo existente).
      const patch: Record<string, unknown> = {};
      if (!tgt.anilistId && src.anilistId) patch.anilistId = src.anilistId;
      if (!tgt.coverImage && src.coverImage) patch.coverImage = src.coverImage;
      if (!tgt.author && src.author) patch.author = src.author;
      if (!tgt.synopsis && src.synopsis) patch.synopsis = src.synopsis;
      if (!tgt.originalTitle && src.originalTitle) patch.originalTitle = src.originalTitle;
      if (!tgt.upcoming && src.upcoming) patch.upcoming = true;
      if (Object.keys(patch).length)
        await tx.work.update({ where: { id: targetId }, data: patch });

      // 3) Colección (Manga, unique userId+anilistId). Si el usuario ya tiene el
      //    target, movemos sus ediciones (unique mangaId+key) y borramos el source.
      const srcMangas = await tx.manga.findMany({
        where: { anilistId: negSrc },
        select: { id: true, userId: true },
      });
      for (const m of srcMangas) {
        const existing = await tx.manga.findUnique({
          where: { userId_anilistId: { userId: m.userId, anilistId: negTgt } },
          select: { id: true },
        });
        if (!existing) {
          await tx.manga.update({ where: { id: m.id }, data: { anilistId: negTgt } });
          continue;
        }
        const tgtKeys = new Set(
          (
            await tx.trackedEdition.findMany({
              where: { mangaId: existing.id },
              select: { key: true },
            })
          ).map((e) => e.key),
        );
        const srcEds = await tx.trackedEdition.findMany({
          where: { mangaId: m.id },
          select: { id: true, key: true },
        });
        for (const e of srcEds) {
          if (tgtKeys.has(e.key)) continue; // el target ya tiene esa edición
          await tx.trackedEdition.update({
            where: { id: e.id },
            data: { mangaId: existing.id },
          });
        }
        await tx.manga.delete({ where: { id: m.id } }); // cascade: ediciones/tomos sobrantes
      }

      // 4) Deseados (unique userId+anilistId+editionKey).
      const srcWishes = await tx.wishlistItem.findMany({
        where: { anilistId: negSrc },
        select: { id: true, userId: true, editionKey: true },
      });
      for (const w of srcWishes) {
        const dup = await tx.wishlistItem.findFirst({
          where: { userId: w.userId, anilistId: negTgt, editionKey: w.editionKey },
          select: { id: true },
        });
        if (dup) await tx.wishlistItem.delete({ where: { id: w.id } });
        else await tx.wishlistItem.update({ where: { id: w.id }, data: { anilistId: negTgt } });
      }

      // 5) Notas (unique userId+anilistId).
      const srcNotes = await tx.userNote.findMany({
        where: { anilistId: negSrc },
        select: { id: true, userId: true },
      });
      for (const n of srcNotes) {
        const dup = await tx.userNote.findUnique({
          where: { userId_anilistId: { userId: n.userId, anilistId: negTgt } },
          select: { id: true },
        });
        if (dup) await tx.userNote.delete({ where: { id: n.id } });
        else await tx.userNote.update({ where: { id: n.id }, data: { anilistId: negTgt } });
      }

      // 6) Muteos de notificación (@id userId+anilistId).
      const srcMutes = await tx.seriesNotifMute.findMany({
        where: { anilistId: negSrc },
        select: { userId: true },
      });
      for (const mu of srcMutes) {
        const dup = await tx.seriesNotifMute.findUnique({
          where: { userId_anilistId: { userId: mu.userId, anilistId: negTgt } },
        });
        if (dup)
          await tx.seriesNotifMute.delete({
            where: { userId_anilistId: { userId: mu.userId, anilistId: negSrc } },
          });
        else
          await tx.seriesNotifMute.update({
            where: { userId_anilistId: { userId: mu.userId, anilistId: negSrc } },
            data: { anilistId: negTgt },
          });
      }

      // 7) Tablas con anilistId no-único: re-clave directa.
      await tx.activity.updateMany({ where: { anilistId: negSrc }, data: { anilistId: negTgt } });
      await tx.notification.updateMany({ where: { anilistId: negSrc }, data: { anilistId: negTgt } });
      await tx.purchaseItem.updateMany({ where: { anilistId: negSrc }, data: { anilistId: negTgt } });
      await tx.ivreaRelease.updateMany({ where: { anilistId: negSrc }, data: { anilistId: negTgt } });

      // 8) Exclusiones de edición (@id anilistId+publisher).
      const srcExcl = await tx.editionExclusion.findMany({ where: { anilistId: negSrc } });
      for (const ex of srcExcl) {
        const dup = await tx.editionExclusion.findUnique({
          where: { anilistId_publisher: { anilistId: negTgt, publisher: ex.publisher } },
        });
        if (dup)
          await tx.editionExclusion.delete({
            where: { anilistId_publisher: { anilistId: negSrc, publisher: ex.publisher } },
          });
        else
          await tx.editionExclusion.update({
            where: { anilistId_publisher: { anilistId: negSrc, publisher: ex.publisher } },
            data: { anilistId: negTgt },
          });
      }

      // 9) Override de búsqueda Crumb (@id anilistId).
      const crumb = await tx.crumbMapping.findUnique({ where: { anilistId: negSrc } });
      if (crumb) {
        const dup = await tx.crumbMapping.findUnique({ where: { anilistId: negTgt } });
        if (dup) await tx.crumbMapping.delete({ where: { anilistId: negSrc } });
        else
          await tx.crumbMapping.update({
            where: { anilistId: negSrc },
            data: { anilistId: negTgt },
          });
      }

      // 10) Borrar el Work source (sus ediciones ya se movieron).
      await tx.work.delete({ where: { id: sourceId } });
    },
    { timeout: 30000 },
  );

  return { sourceId, targetId, editionsMoved };
}
