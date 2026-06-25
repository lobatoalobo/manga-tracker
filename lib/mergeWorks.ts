import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface DupWork {
  id: number;
  title: string;
  anilistId: number | null;
  editions: { publisher: string; slug: string; volumes: number }[];
}
export interface DupGroup {
  anilistId: number;
  works: DupWork[];
}

/**
 * Grupos de Works que comparten el MISMO `anilistId` a través de sus ediciones,
 * pero son Works distintos. Cola de revisión para fusionar (si es dup real) o
 * separar (si es un mismapeo, ej. una novela pegada al id del manga). Ver
 * `scripts/audit-catalog.ts` (check split-anilist) y la memoria anilist-removal.
 */
export async function getDuplicateWorkGroups(): Promise<DupGroup[]> {
  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId: { not: null }, workId: { not: null } },
    select: {
      anilistId: true,
      publisher: true,
      slug: true,
      volumes: true,
      work: { select: { id: true, title: true, anilistId: true } },
    },
  });
  const byAnilist = new Map<number, Map<number, DupWork>>();
  for (const e of eds) {
    if (!e.work) continue;
    const wmap = byAnilist.get(e.anilistId!) ?? new Map<number, DupWork>();
    const w =
      wmap.get(e.work.id) ??
      { id: e.work.id, title: e.work.title, anilistId: e.work.anilistId, editions: [] };
    w.editions.push({ publisher: e.publisher, slug: e.slug, volumes: e.volumes });
    wmap.set(e.work.id, w);
    byAnilist.set(e.anilistId!, wmap);
  }
  return [...byAnilist.entries()]
    .filter(([, wmap]) => wmap.size > 1)
    .map(([anilistId, wmap]) => ({ anilistId, works: [...wmap.values()] }))
    .sort((a, b) => a.anilistId - b.anilistId);
}

/**
 * Borra Works sin ninguna edición (huérfanos), salvo los debuts "próximo a salir"
 * (que legítimamente no tienen edición todavía). Prevención: ninguna operación
 * que mueva/borre ediciones debe dejar un Work huérfano (ver caso I"s/work 72).
 */
export async function cleanOrphanWorks(): Promise<number> {
  const r = await prisma.work.deleteMany({
    where: { editions: { none: {} }, upcoming: false },
  });
  return r.count;
}

export interface EditionDupEdition {
  id: number;
  slug: string;
  title: string;
  volumes: number;
  workId: number | null;
  anilistId: number | null;
  url: string;
}
export interface EditionDupGroup {
  publisher: string;
  normTitle: string;
  sameWork: boolean; // todas las ediciones cuelgan del mismo Work
  editions: EditionDupEdition[];
}

/**
 * Grupos de ediciones duplicadas (misma editorial + normTitle). Clasificados:
 *  - `sameWork`: redundantes en el MISMO Work → borrar las extra (queda la
 *    canónica). Ej. I"s con slugs "is" e "i-quot-s".
 *  - `!sameWork`: la misma serie quedó en Works distintos → fusionar los Works.
 * Excluye series realmente distintas con título parecido (distinto anilistId).
 */
export async function getEditionDuplicateGroups(): Promise<EditionDupGroup[]> {
  const rows = await prisma.publisherEdition.findMany({
    select: {
      id: true, publisher: true, normTitle: true, slug: true, title: true,
      volumes: true, workId: true, anilistId: true, url: true,
    },
  });
  const byKey = new Map<string, EditionDupEdition[]>();
  const meta = new Map<string, { publisher: string; normTitle: string }>();
  for (const r of rows) {
    const k = `${r.publisher}::${r.normTitle}`;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
    meta.set(k, { publisher: r.publisher, normTitle: r.normTitle });
  }
  const out: EditionDupGroup[] = [];
  for (const [k, g] of byKey) {
    if (g.length < 2) continue;
    const series = new Set(g.filter((r) => r.anilistId != null).map((r) => r.anilistId));
    if (series.size >= 2) continue; // series distintas, no es dup
    const workIds = new Set(g.map((r) => r.workId));
    out.push({
      publisher: meta.get(k)!.publisher,
      normTitle: meta.get(k)!.normTitle,
      sameWork: workIds.size === 1,
      editions: g,
    });
  }
  return out;
}

/** Edición canónica de un grupo: con anilistId > más tomos > slug más corto. */
function canonicalEdition(eds: EditionDupEdition[]): EditionDupEdition {
  return [...eds].sort(
    (a, b) =>
      (b.anilistId ? 1 : 0) - (a.anilistId ? 1 : 0) ||
      b.volumes - a.volumes ||
      a.slug.length - b.slug.length,
  )[0];
}

/**
 * Auto-resuelve las ediciones redundantes del MISMO Work: mantiene la canónica y
 * borra las extra. Self-healing para el caso I"s. Devuelve cuántas borró.
 */
export async function cleanRedundantEditions(): Promise<number> {
  const groups = (await getEditionDuplicateGroups()).filter((g) => g.sameWork);
  let deleted = 0;
  for (const g of groups) {
    const keep = canonicalEdition(g.editions);
    for (const e of g.editions) {
      if (e.id === keep.id) continue;
      await prisma.publisherEdition.delete({ where: { id: e.id } }).catch(() => {});
      deleted++;
    }
  }
  return deleted;
}

/**
 * Desvincula un Work de su anilistId (lo pone null en el Work y en sus ediciones).
 * Para mismapeos: una obra distinta (novela/spin-off) quedó pegada al id de otra,
 * y así deja de aparecer como duplicado.
 */
export async function unlinkWorkAnilist(workId: number): Promise<void> {
  await prisma.publisherEdition.updateMany({
    where: { workId },
    data: { anilistId: null },
  });
  await prisma.work
    .update({ where: { id: workId }, data: { anilistId: null } })
    .catch(() => {});
}

export interface DeleteWorkReport {
  workId: number;
  editionsDeleted: number;
  collectionRemoved: number; // mangas (colección de usuarios) borrados
  wishlistRemoved: number; // ítems de deseados borrados
}

/**
 * Borra por completo un `Work` del catálogo: sus ediciones y TODA la data de
 * usuario que cuelga de su clave de dominio (anilistId real, o `-workId` si es
 * local). Para duplicados que el detector de "Series duplicadas" no agarra
 * (no comparten anilistId). Devuelve cuánta data de usuario se borró, para que
 * el admin vea si la entrada tenía colección real (señal de que quizá convenía
 * fusionar en vez de borrar). El registro de rechazo de las fuentes (para que el
 * crawl no las re-importe) lo hace el caller con `rejectEditions`.
 */
export async function deleteWork(workId: number): Promise<DeleteWorkReport> {
  const work = await prisma.work.findUnique({
    where: { id: workId },
    select: { id: true, anilistId: true },
  });
  if (!work) throw new Error(`Work ${workId} no existe`);
  // Clave de dominio: positiva = anilistId (vía edición), negativa = -workId
  // (catálogo local). Como el dup NO comparte anilistId con la canónica
  // (si no, saldría en "Series duplicadas"), esta clave es exclusiva de este Work.
  const domainKey = work.anilistId ?? -workId;

  let editionsDeleted = 0;
  let collectionRemoved = 0;
  let wishlistRemoved = 0;

  await prisma.$transaction(
    async (tx) => {
      // Colección (Manga → TrackedEdition → OwnedVolume por cascade DB).
      const col = await tx.manga.deleteMany({ where: { anilistId: domainKey } });
      collectionRemoved = col.count;
      const wl = await tx.wishlistItem.deleteMany({ where: { anilistId: domainKey } });
      wishlistRemoved = wl.count;
      await tx.userNote.deleteMany({ where: { anilistId: domainKey } });
      await tx.seriesNotifMute.deleteMany({ where: { anilistId: domainKey } });
      await tx.activity.deleteMany({ where: { anilistId: domainKey } });
      await tx.notification.deleteMany({ where: { anilistId: domainKey } });
      await tx.purchaseItem.deleteMany({ where: { anilistId: domainKey } });
      await tx.ivreaRelease.deleteMany({ where: { anilistId: domainKey } });
      await tx.editionExclusion.deleteMany({ where: { anilistId: domainKey } });
      await tx.crumbMapping.deleteMany({ where: { anilistId: domainKey } });

      // Ediciones (PublisherEdition.workId es onDelete:SetNull → hay que borrarlas
      // explícito, si no quedarían huérfanas en vez de irse con el Work).
      const ed = await tx.publisherEdition.deleteMany({ where: { workId } });
      editionsDeleted = ed.count;

      await tx.work.delete({ where: { id: workId } });
    },
    { timeout: 30000 },
  );

  return { workId, editionsDeleted, collectionRemoved, wishlistRemoved };
}

export interface MergeReport {
  sourceId: number;
  targetId: number;
  editionsMoved: number;
}

type Tx = Prisma.TransactionClient;

/**
 * Mueve TODA la data de usuario de una clave de dominio (`from`) a otra (`to`),
 * donde la clave es el anilistId real de la serie o `-workId` para obras locales.
 * Resuelve los choques de unicidad por usuario (si el usuario ya tiene la serie
 * destino, fusiona ediciones y descarta el sobrante). Usado al fusionar Works.
 */
async function rekeyDomain(tx: Tx, from: number, to: number): Promise<void> {
  // Colección (Manga, unique userId+anilistId). Si el usuario ya tiene el
  // destino, movemos sus ediciones (unique mangaId+key) y borramos el sobrante.
  const srcMangas = await tx.manga.findMany({
    where: { anilistId: from },
    select: { id: true, userId: true },
  });
  for (const m of srcMangas) {
    const existing = await tx.manga.findUnique({
      where: { userId_anilistId: { userId: m.userId, anilistId: to } },
      select: { id: true },
    });
    if (!existing) {
      await tx.manga.update({ where: { id: m.id }, data: { anilistId: to } });
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
      if (tgtKeys.has(e.key)) continue; // el destino ya tiene esa edición
      await tx.trackedEdition.update({ where: { id: e.id }, data: { mangaId: existing.id } });
    }
    await tx.manga.delete({ where: { id: m.id } }); // cascade: ediciones/tomos sobrantes
  }

  // Deseados (unique userId+anilistId+editionKey).
  const srcWishes = await tx.wishlistItem.findMany({
    where: { anilistId: from },
    select: { id: true, userId: true, editionKey: true },
  });
  for (const w of srcWishes) {
    const dup = await tx.wishlistItem.findFirst({
      where: { userId: w.userId, anilistId: to, editionKey: w.editionKey },
      select: { id: true },
    });
    if (dup) await tx.wishlistItem.delete({ where: { id: w.id } });
    else await tx.wishlistItem.update({ where: { id: w.id }, data: { anilistId: to } });
  }

  // Notas (unique userId+anilistId).
  const srcNotes = await tx.userNote.findMany({
    where: { anilistId: from },
    select: { id: true, userId: true },
  });
  for (const n of srcNotes) {
    const dup = await tx.userNote.findUnique({
      where: { userId_anilistId: { userId: n.userId, anilistId: to } },
      select: { id: true },
    });
    if (dup) await tx.userNote.delete({ where: { id: n.id } });
    else await tx.userNote.update({ where: { id: n.id }, data: { anilistId: to } });
  }

  // Muteos de notificación (@id userId+anilistId).
  const srcMutes = await tx.seriesNotifMute.findMany({
    where: { anilistId: from },
    select: { userId: true },
  });
  for (const mu of srcMutes) {
    const dup = await tx.seriesNotifMute.findUnique({
      where: { userId_anilistId: { userId: mu.userId, anilistId: to } },
    });
    if (dup)
      await tx.seriesNotifMute.delete({
        where: { userId_anilistId: { userId: mu.userId, anilistId: from } },
      });
    else
      await tx.seriesNotifMute.update({
        where: { userId_anilistId: { userId: mu.userId, anilistId: from } },
        data: { anilistId: to },
      });
  }

  // Tablas con anilistId no-único: re-clave directa.
  await tx.activity.updateMany({ where: { anilistId: from }, data: { anilistId: to } });
  await tx.notification.updateMany({ where: { anilistId: from }, data: { anilistId: to } });
  await tx.purchaseItem.updateMany({ where: { anilistId: from }, data: { anilistId: to } });
  await tx.ivreaRelease.updateMany({ where: { anilistId: from }, data: { anilistId: to } });

  // Exclusiones de edición (@id anilistId+publisher).
  const srcExcl = await tx.editionExclusion.findMany({ where: { anilistId: from } });
  for (const ex of srcExcl) {
    const dup = await tx.editionExclusion.findUnique({
      where: { anilistId_publisher: { anilistId: to, publisher: ex.publisher } },
    });
    if (dup)
      await tx.editionExclusion.delete({
        where: { anilistId_publisher: { anilistId: from, publisher: ex.publisher } },
      });
    else
      await tx.editionExclusion.update({
        where: { anilistId_publisher: { anilistId: from, publisher: ex.publisher } },
        data: { anilistId: to },
      });
  }

  // Override de búsqueda Crumb (@id anilistId).
  const crumb = await tx.crumbMapping.findUnique({ where: { anilistId: from } });
  if (crumb) {
    const dup = await tx.crumbMapping.findUnique({ where: { anilistId: to } });
    if (dup) await tx.crumbMapping.delete({ where: { anilistId: from } });
    else await tx.crumbMapping.update({ where: { anilistId: from }, data: { anilistId: to } });
  }
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
  const sel = {
    id: true, anilistId: true, coverImage: true, author: true,
    synopsis: true, originalTitle: true, upcoming: true,
    // Identidad externa + nombres + sinopsis multi-idioma: hay que preservarlos
    // CUALQUIERA sea la dirección de la fusión (típico: el target nacional/ES no
    // tiene muId/mdId/titleEn y el source VIZ sí). Ver redesign de datos.
    muId: true, mdId: true, titleEn: true, titleNative: true, assistants: true,
    synopsisEs: true, synopsisEn: true, synopsisEsAuto: true, synopsisEnAuto: true,
    demographic: true, genres: true, rawGenres: true,
  } as const;
  const [src, tgt] = await Promise.all([
    prisma.work.findUnique({ where: { id: sourceId }, select: sel }),
    prisma.work.findUnique({ where: { id: targetId }, select: sel }),
  ]);
  if (!src) throw new Error(`Work source ${sourceId} no existe`);
  if (!tgt) throw new Error(`Work target ${targetId} no existe`);

  // Clave de dominio de cada Work: positiva = anilistId (la colección/deseados se
  // clavan por el anilistId de la serie), negativa = -id para obras locales. El
  // target PUEDE adquirir el anilistId del source en el backfill; su clave final
  // es esa. Consolidamos la data de usuario de ambas claves viejas bajo la final.
  const finalKey = tgt.anilistId ?? src.anilistId ?? -targetId;
  const srcOldKey = src.anilistId ?? -sourceId;
  const tgtOldKey = tgt.anilistId ?? -targetId;
  let editionsMoved = 0;

  await prisma.$transaction(
    async (tx) => {
      // 1) Ediciones del source → target (el núcleo del dedup).
      const moved = await tx.publisherEdition.updateMany({
        where: { workId: sourceId },
        data: { workId: targetId },
      });
      editionsMoved = moved.count;

      // `anilistId`/`muId`/`mdId` son @unique: liberamos los del source ANTES de
      // pasarlos al target (si no, el update del target choca porque el source aún
      // los tiene). El source se borra al final igual, así que nullearlos es seguro.
      const free: Record<string, unknown> = {};
      if (src.anilistId) free.anilistId = null;
      if (src.muId) free.muId = null;
      if (src.mdId) free.mdId = null;
      if (Object.keys(free).length)
        await tx.work.update({ where: { id: sourceId }, data: free });

      // 2) Backfill de campos del target desde el source (sin pisar lo existente).
      const patch: Record<string, unknown> = {};
      if (!tgt.anilistId && src.anilistId) patch.anilistId = src.anilistId;
      if (!tgt.coverImage && src.coverImage) patch.coverImage = src.coverImage;
      if (!tgt.author && src.author) patch.author = src.author;
      if (!tgt.synopsis && src.synopsis) patch.synopsis = src.synopsis;
      if (!tgt.originalTitle && src.originalTitle) patch.originalTitle = src.originalTitle;
      if (!tgt.upcoming && src.upcoming) patch.upcoming = true;
      // Identidad externa + nombres + sinopsis multi-idioma + géneros/demografía.
      if (!tgt.muId && src.muId) patch.muId = src.muId;
      if (!tgt.mdId && src.mdId) patch.mdId = src.mdId;
      if (!tgt.titleEn && src.titleEn) patch.titleEn = src.titleEn;
      if (!tgt.titleNative && src.titleNative) patch.titleNative = src.titleNative;
      if (!tgt.assistants?.length && src.assistants?.length) patch.assistants = src.assistants;
      if (!tgt.synopsisEs && src.synopsisEs) {
        patch.synopsisEs = src.synopsisEs;
        patch.synopsisEsAuto = src.synopsisEsAuto;
      }
      if (!tgt.synopsisEn && src.synopsisEn) {
        patch.synopsisEn = src.synopsisEn;
        patch.synopsisEnAuto = src.synopsisEnAuto;
      }
      if (!tgt.demographic && src.demographic) patch.demographic = src.demographic;
      if (!tgt.genres?.length && src.genres?.length) patch.genres = src.genres;
      if (!tgt.rawGenres?.length && src.rawGenres?.length) patch.rawGenres = src.rawGenres;
      if (Object.keys(patch).length)
        await tx.work.update({ where: { id: targetId }, data: patch });

      // 3) Re-clave de TODA la data de usuario de ambas claves viejas → la final.
      //    (Para una fusión mixta local+anilistId, las claves difieren; para la
      //    cola automática suelen coincidir y queda no-op.)
      if (srcOldKey !== finalKey) await rekeyDomain(tx, srcOldKey, finalKey);
      if (tgtOldKey !== finalKey) await rekeyDomain(tx, tgtOldKey, finalKey);

      // 4) Borrar el Work source (sus ediciones ya se movieron).
      await tx.work.delete({ where: { id: sourceId } });
    },
    { timeout: 30000 },
  );

  return { sourceId, targetId, editionsMoved };
}
