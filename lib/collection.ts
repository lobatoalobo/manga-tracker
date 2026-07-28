import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getMangaById, searchMangaList } from "@/lib/anilist";
import { nationalCoversByAnilist, upcomingForIds, authorsByAnilist } from "@/lib/catalog";
import { isPlausibleVolume } from "@/lib/volumes";
import { publisherKey, publisherRegion } from "@/lib/publisher-key";
import type { TrackedEdition, OwnedVolume } from "@prisma/client";

type EditionRow = TrackedEdition & { ownedVolumes: OwnedVolume[] };

export type ReadingStatus = "UNREAD" | "READING" | "READ";

export interface EditionView {
  editionId: number;
  key: string;
  label: string;
  publisher: string | null;
  region: string;
  totalVolumes: number;
  status: string;
  readingStatus: string;
  readingVolume: number | null;
  ownedVolumes: number[];
}

export interface SeriesView {
  anilistId: number;
  title: { romaji: string; english: string | null; native: string | null };
  coverImage: string;
  apiTotalVolumes: number | null;
  muVolumes: number | null;
  editions: EditionView[];
}

/** Un ítem de la colección = una edición trackeada (con su serie). */
export interface CollectionItem {
  anilistId: number;
  title: { romaji: string; english: string | null; native: string | null };
  author: string | null;
  coverImage: string;
  edition: EditionView;
  upcoming: boolean;
}

function toEditionView(e: EditionRow): EditionView {
  return {
    editionId: e.id,
    key: e.key,
    label: e.label,
    publisher: e.publisher,
    region: e.region,
    totalVolumes: e.totalVolumes,
    status: e.status,
    readingStatus: e.readingStatus,
    readingVolume: e.readingVolume,
    ownedVolumes: e.ownedVolumes.map((v) => v.volume).sort((a, b) => a - b),
  };
}

export async function getCollectionItems(
  userId: string,
): Promise<CollectionItem[]> {
  const rows = await prisma.manga.findMany({
    where: { userId },
    include: { editions: { include: { ownedVolumes: true } } },
    orderBy: { romajiTitle: "asc" },
  });

  // Portada nacional (cuando la tenemos) en vez de la guardada/AniList, flag
  // "próximo a salir" para el badge, y autor (para buscar por mangaka).
  const ids = rows.map((m) => m.anilistId);
  const [nationalCovers, upcoming, authors] = await Promise.all([
    nationalCoversByAnilist(ids).catch(() => new Map<number, string>()),
    upcomingForIds(ids).catch(() => new Set<number>()),
    authorsByAnilist(ids).catch(() => new Map<number, string>()),
  ]);

  const items: CollectionItem[] = [];
  for (const m of rows) {
    for (const e of m.editions) {
      items.push({
        anilistId: m.anilistId,
        title: {
          romaji: m.romajiTitle,
          english: m.englishTitle,
          native: m.nativeTitle,
        },
        author: authors.get(m.anilistId) ?? null,
        coverImage: nationalCovers.get(m.anilistId) ?? m.coverImage,
        edition: toEditionView(e),
        upcoming: upcoming.has(m.anilistId),
      });
    }
  }
  return items;
}

// --- Compartir colección (opt-in con link) ---

export async function getShareSlug(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { shareSlug: true },
  });
  return u?.shareSlug ?? null;
}

/**
 * Lista de series mapeadas de la colección (una por serie) con su estado de
 * muteo, para la pantalla "Notificaciones por serie". Solo mapeadas (anilistId
 * positivo): las nacionales no disparan notis de tomo nuevo.
 */
export async function getSeriesNotifList(
  userId: string,
): Promise<{ anilistId: number; title: string; coverImage: string; muted: boolean }[]> {
  const items = await getCollectionItems(userId);
  const byId = new Map<number, { title: string; coverImage: string }>();
  for (const i of items) {
    // Incluye obras locales (id negativo, -workId); solo descartamos el 0 inválido.
    if (i.anilistId === 0 || byId.has(i.anilistId)) continue;
    byId.set(i.anilistId, {
      // Mismo criterio que la colección (english primero, como displayTitle).
      title: i.title.english || i.title.romaji || i.title.native || "—",
      coverImage: i.coverImage,
    });
  }
  const muted = new Set(
    (
      await prisma.seriesNotifMute.findMany({
        where: { userId },
        select: { anilistId: true },
      })
    ).map((m) => m.anilistId),
  );
  return [...byId.entries()]
    .map(([anilistId, v]) => ({ anilistId, ...v, muted: muted.has(anilistId) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** anilistId de la serie preferida del usuario (1 por usuario), o null. */
export async function getFavoriteId(userId: string): Promise<number | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { favoriteAnilistId: true },
  });
  return u?.favoriteAnilistId ?? null;
}

/** Activa o desactiva compartir. Al activar, genera un slug si no existe. */
export async function setSharing(
  userId: string,
  enable: boolean,
): Promise<string | null> {
  if (!enable) {
    await prisma.user.update({ where: { id: userId }, data: { shareSlug: null } });
    return null;
  }
  const existing = await getShareSlug(userId);
  if (existing) return existing;

  const slug = randomBytes(6).toString("hex");
  await prisma.user.update({ where: { id: userId }, data: { shareSlug: slug } });
  return slug;
}

/** Colección pública por slug (solo lectura). null si el slug no existe. */
export async function getPublicCollection(
  slug: string,
): Promise<{ name: string; items: CollectionItem[]; favoriteId: number | null } | null> {
  const user = await prisma.user.findUnique({
    where: { shareSlug: slug },
    select: { id: true, name: true, favoriteAnilistId: true },
  });
  if (!user) return null;

  const items = await getCollectionItems(user.id);
  return {
    name: user.name ?? "Colección",
    items,
    favoriteId: user.favoriteAnilistId ?? null,
  };
}

/** Una serie de una colección pública (solo lectura). */
export async function getPublicSeries(
  slug: string,
  anilistId: number,
): Promise<{ ownerName: string; series: SeriesView } | null> {
  const user = await prisma.user.findUnique({
    where: { shareSlug: slug },
    select: { id: true, name: true },
  });
  if (!user) return null;

  const series = await getSeries(user.id, anilistId);
  if (!series) return null;

  return { ownerName: user.name ?? "Colección", series };
}

export async function getSeries(
  userId: string,
  anilistId: number,
): Promise<SeriesView | null> {
  const m = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    include: { editions: { include: { ownedVolumes: true } } },
  });
  if (!m) return null;

  return {
    anilistId: m.anilistId,
    title: {
      romaji: m.romajiTitle,
      english: m.englishTitle,
      native: m.nativeTitle,
    },
    coverImage: m.coverImage,
    apiTotalVolumes: m.apiTotalVolumes,
    muVolumes: m.muVolumes,
    editions: m.editions
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(toEditionView),
  };
}

export interface AddEditionInput {
  anilistId: number;
  title: { romaji: string; english?: string | null; native?: string | null };
  coverImage: string;
  volumes?: number | null; // AniList
  muVolumes?: number | null;
  edition: {
    key: string;
    label: string;
    publisher?: string | null;
    slug?: string | null;
    region: string;
    totalVolumes: number;
  };
}

/** Agrega (o actualiza) una edición trackeada de una serie. */
export async function addEdition(
  userId: string,
  input: AddEditionInput,
): Promise<void> {
  const manga = await prisma.manga.upsert({
    where: { userId_anilistId: { userId, anilistId: input.anilistId } },
    update: {
      muVolumes: input.muVolumes ?? undefined,
      apiTotalVolumes: input.volumes ?? undefined,
    },
    create: {
      anilistId: input.anilistId,
      userId,
      romajiTitle: input.title.romaji,
      englishTitle: input.title.english ?? null,
      nativeTitle: input.title.native ?? null,
      coverImage: input.coverImage,
      apiTotalVolumes: input.volumes ?? null,
      muVolumes: input.muVolumes ?? null,
    },
  });

  await prisma.trackedEdition.upsert({
    where: { mangaId_key: { mangaId: manga.id, key: input.edition.key } },
    update: {
      label: input.edition.label,
      publisher: input.edition.publisher ?? null,
      slug: input.edition.slug ?? null,
      region: input.edition.region,
      totalVolumes: input.edition.totalVolumes,
    },
    create: {
      mangaId: manga.id,
      key: input.edition.key,
      label: input.edition.label,
      publisher: input.edition.publisher ?? null,
      slug: input.edition.slug ?? null,
      region: input.edition.region,
      totalVolumes: input.edition.totalVolumes,
    },
  });
}

async function findEdition(userId: string, anilistId: number, key: string) {
  const manga = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    select: { id: true },
  });
  if (!manga) return null;
  return prisma.trackedEdition.findUnique({
    where: { mangaId_key: { mangaId: manga.id, key } },
    include: { ownedVolumes: true },
  });
}

/** Deja de trackear una edición. Si la serie queda sin ediciones, la borra. */
export async function removeEdition(
  userId: string,
  anilistId: number,
  key: string,
): Promise<void> {
  const manga = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    include: { editions: true },
  });
  if (!manga) return;

  await prisma.trackedEdition.deleteMany({ where: { mangaId: manga.id, key } });

  const remaining = manga.editions.filter((e) => e.key !== key).length;
  if (remaining === 0) {
    await prisma.manga.delete({ where: { id: manga.id } });
  }
}

export async function toggleVolume(
  userId: string,
  anilistId: number,
  key: string,
  volume: number,
): Promise<void> {
  const ed = await findEdition(userId, anilistId, key);
  if (!ed) return;

  const owns = ed.ownedVolumes.some((v) => v.volume === volume);
  if (owns) {
    await prisma.ownedVolume.deleteMany({
      where: { editionId: ed.id, volume },
    });
  } else {
    await prisma.ownedVolume.create({ data: { editionId: ed.id, volume } });
  }

  const ownedCount = owns
    ? ed.ownedVolumes.length - 1
    : ed.ownedVolumes.length + 1;

  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: {
      status:
        ed.totalVolumes > 0 && ownedCount >= ed.totalVolumes
          ? "COMPLETED"
          : "IN_PROGRESS",
    },
  });
}

export async function setAllVolumes(
  userId: string,
  anilistId: number,
  key: string,
  owned: boolean,
): Promise<void> {
  const ed = await findEdition(userId, anilistId, key);
  if (!ed) return;

  await prisma.ownedVolume.deleteMany({ where: { editionId: ed.id } });

  if (owned && ed.totalVolumes > 0) {
    await prisma.ownedVolume.createMany({
      data: Array.from({ length: ed.totalVolumes }, (_, i) => ({
        editionId: ed.id,
        volume: i + 1,
      })),
    });
  }

  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: {
      status: owned && ed.totalVolumes > 0 ? "COMPLETED" : "IN_PROGRESS",
    },
  });
}

/** Marca como propios exactamente los tomos 1..n (atajo para series largas). */
export async function setVolumesUpTo(
  userId: string,
  anilistId: number,
  key: string,
  n: number,
): Promise<void> {
  const ed = await findEdition(userId, anilistId, key);
  if (!ed) return;

  const top = ed.totalVolumes > 0 ? Math.min(n, ed.totalVolumes) : n;
  await prisma.ownedVolume.deleteMany({ where: { editionId: ed.id } });
  if (top > 0) {
    await prisma.ownedVolume.createMany({
      data: Array.from({ length: top }, (_, i) => ({
        editionId: ed.id,
        volume: i + 1,
      })),
    });
  }

  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: {
      status:
        ed.totalVolumes > 0 && top >= ed.totalVolumes
          ? "COMPLETED"
          : "IN_PROGRESS",
    },
  });
}

export async function setReading(
  userId: string,
  anilistId: number,
  key: string,
  status: ReadingStatus,
  volume: number | null,
): Promise<void> {
  const ed = await findEdition(userId, anilistId, key);
  if (!ed) return;
  // Se puede leer online más de lo que se tiene, pero nunca más que el total
  // de la serie (no existe "leído 11/10"). Clampeo defensivo server-side.
  const vol =
    volume != null && ed.totalVolumes > 0
      ? Math.min(Math.max(1, volume), ed.totalVolumes)
      : volume;
  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: { readingStatus: status, readingVolume: vol },
  });
}

export interface ImportRow {
  anilistId?: number | null;
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
  coverImage?: string | null;
  editionKey?: string | null;
  editionLabel: string;
  publisher?: string | null;
  region?: string | null;
  totalVolumes: number;
  readingStatus?: string | null;
  readingVolume?: number | null;
  owned: number[];
}

/** Importa una edición desde una fila de CSV. Resuelve datos faltantes en AniList. */
export async function importEdition(
  userId: string,
  row: ImportRow,
): Promise<void> {
  let anilistId = row.anilistId ?? null;
  let romaji = row.romaji ?? null;
  let english = row.english ?? null;
  let native = row.native ?? null;
  let cover = row.coverImage ?? null;

  if (!anilistId) {
    const title = romaji || english;
    if (!title) throw new Error("fila sin anilistId ni título");
    const hit = (await searchMangaList(title, true))[0];
    if (!hit) throw new Error(`no se encontró "${title}" en AniList`);
    anilistId = hit.id;
    romaji = romaji || hit.title.romaji;
    english = english ?? hit.title.english;
    native = native ?? hit.title.native;
    cover = cover || hit.coverImage.large;
  } else if (!cover || !romaji) {
    const m = await getMangaById(anilistId);
    romaji = romaji || m.title.romaji;
    english = english ?? m.title.english;
    native = native ?? m.title.native;
    cover = cover || m.coverImage.extraLarge;
  }

  if (anilistId == null) throw new Error("no se pudo resolver el id de AniList");

  const manga = await prisma.manga.upsert({
    where: { userId_anilistId: { userId, anilistId } },
    update: {},
    create: {
      anilistId,
      userId,
      romajiTitle: romaji ?? "—",
      englishTitle: english ?? null,
      nativeTitle: native ?? null,
      coverImage: cover ?? "",
    },
  });

  const key =
    row.editionKey?.trim() ||
    row.editionLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    "edicion";

  const total = row.totalVolumes || 0;
  const owned = [
    ...new Set(row.owned.filter((v) => v > 0 && (total === 0 || v <= total))),
  ];

  const ed = await prisma.trackedEdition.upsert({
    where: { mangaId_key: { mangaId: manga.id, key } },
    update: {
      label: row.editionLabel,
      publisher: row.publisher ?? null,
      region: row.region || "AR",
      totalVolumes: total,
      readingStatus: row.readingStatus || "UNREAD",
      readingVolume: row.readingVolume ?? null,
    },
    create: {
      mangaId: manga.id,
      key,
      label: row.editionLabel,
      publisher: row.publisher ?? null,
      region: row.region || "AR",
      totalVolumes: total,
      readingStatus: row.readingStatus || "UNREAD",
      readingVolume: row.readingVolume ?? null,
    },
  });

  await prisma.ownedVolume.deleteMany({ where: { editionId: ed.id } });
  if (owned.length) {
    await prisma.ownedVolume.createMany({
      data: owned.map((v) => ({ editionId: ed.id, volume: v })),
    });
  }

  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: {
      status: total > 0 && owned.length >= total ? "COMPLETED" : "IN_PROGRESS",
    },
  });
}

type PubRow = { publisher: string; slug: string | null; volumes: number };

/** Ediciones (PublisherEdition) de la obra, ordenadas por conteo. */
async function purchaseEditionRows(anilistId: number): Promise<PubRow[]> {
  return prisma.publisherEdition.findMany({
    where: anilistId < 0 ? { workId: -anilistId } : { anilistId },
    orderBy: { volumes: "desc" },
    select: { publisher: true, slug: true, volumes: true },
  });
}

/** Elige la edición que coincide con la editorial de la compra (o la de más tomos). */
function chooseRow(rows: PubRow[], edition?: string | null): PubRow | null {
  let row = rows[0] ?? null;
  if (edition && rows.length > 1) {
    const want = edition.toLowerCase();
    const match = rows.find((r) =>
      r.publisher.toLowerCase().split(" ").some((w) => w.length > 2 && want.includes(w)),
    );
    if (match) row = match;
  }
  return row;
}

/** Key de TrackedEdition para un tomo comprado (coherente con la ficha). */
function purchaseKey(row: PubRow | null, edition?: string | null): string {
  if (row) return publisherKey(row.publisher);
  return publisherRegion(edition) === "INT" ? "viz" : "ar";
}

/**
 * Suma un tomo comprado a la colección. Resuelve la edición nacional desde el
 * mapeo (PublisherEdition) para que coincida con la que muestra la ficha; si la
 * serie no tiene edición mapeada, usa una edición nacional genérica. Idempotente.
 */
export async function addPurchaseItemToCollection(
  userId: string,
  item: {
    anilistId: number;
    title: string;
    coverImage?: string | null;
    volume?: number | null;
    edition?: string | null;
  },
): Promise<void> {
  if (!item.anilistId) return;

  // Obra local: id negativo = -workId → buscamos sus ediciones por workId, y
  // preferimos la que coincide con la editorial de la compra (si no, la de más
  // tomos).
  const rows = await purchaseEditionRows(item.anilistId);
  const row = chooseRow(rows, item.edition);

  // El tomo comprado puede superar el conteo cacheado (catálogo algo
  // desactualizado) y en ese caso ampliamos el total. PERO con un tope: un tomo
  // muy por encima del conocido es un error de carga (ej. tomo 500 de una serie
  // de 10) y NO debe inflar la colección.
  const vol = item.volume ?? 0;
  const known = row?.volumes ?? 0;
  const plausible = isPlausibleVolume(known, vol); // typo (ej. #500 de 10) → no expande
  const total = plausible ? Math.max(known, vol) : known;
  const edition = row
    ? {
        key: purchaseKey(row, item.edition),
        label: row.publisher,
        publisher: row.publisher,
        slug: row.slug,
        region: publisherRegion(row.publisher),
        totalVolumes: total,
      }
    : {
        key: purchaseKey(null, item.edition),
        label: item.edition || "Edición nacional",
        publisher: item.edition || null,
        slug: null,
        region: publisherRegion(item.edition),
        totalVolumes: plausible ? vol : 0,
      };

  await addEdition(userId, {
    anilistId: item.anilistId,
    title: { romaji: item.title },
    coverImage: item.coverImage ?? "",
    edition,
  });

  // Tomo implausible (typo) → agregamos la edición pero NO el tomo dueño.
  if (!item.volume || !plausible) return;

  const manga = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId: item.anilistId } },
    select: { id: true },
  });
  if (!manga) return;
  const ed = await prisma.trackedEdition.findUnique({
    where: { mangaId_key: { mangaId: manga.id, key: edition.key } },
    select: { id: true, totalVolumes: true },
  });
  if (!ed) return;

  await prisma.ownedVolume
    .create({ data: { editionId: ed.id, volume: item.volume } })
    .catch(() => {}); // @@unique: ya lo tenía

  const ownedCount = await prisma.ownedVolume.count({
    where: { editionId: ed.id },
  });
  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: {
      status:
        ed.totalVolumes > 0 && ownedCount >= ed.totalVolumes
          ? "COMPLETED"
          : "IN_PROGRESS",
    },
  });
}

/**
 * Quita de la colección el tomo de una compra (al borrar/editar la compra).
 * Inverso de `addPurchaseItemToCollection`. Guard: si OTRA compra no cancelada
 * todavía cubre ese tomo de esa misma edición, no lo quita (evita borrar de más
 * cuando se compró el mismo tomo dos veces). Llamar DESPUÉS de borrar/actualizar
 * la compra en cuestión (así sus ítems ya no cuentan en el guard).
 */
export async function removePurchaseItemFromCollection(
  userId: string,
  item: { anilistId: number | null; edition?: string | null; volume?: number | null },
): Promise<void> {
  if (!item.anilistId || !item.volume) return;

  const rows = await purchaseEditionRows(item.anilistId);
  const key = purchaseKey(chooseRow(rows, item.edition), item.edition);

  // ¿Queda otra compra (no cancelada) que cubra este tomo de esta edición?
  const others = await prisma.purchaseItem.findMany({
    where: {
      purchase: { userId },
      anilistId: item.anilistId,
      volume: item.volume,
      status: { not: "CANCELLED" },
    },
    select: { edition: true },
  });
  const stillCovered = others.some(
    (o) => purchaseKey(chooseRow(rows, o.edition), o.edition) === key,
  );
  if (stillCovered) return;

  const manga = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId: item.anilistId } },
    select: { id: true },
  });
  if (!manga) return;
  const ed = await prisma.trackedEdition.findUnique({
    where: { mangaId_key: { mangaId: manga.id, key } },
    select: { id: true, totalVolumes: true },
  });
  if (!ed) return;

  await prisma.ownedVolume.deleteMany({
    where: { editionId: ed.id, volume: item.volume },
  });

  const ownedCount = await prisma.ownedVolume.count({
    where: { editionId: ed.id },
  });
  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: {
      status:
        ed.totalVolumes > 0 && ownedCount >= ed.totalVolumes
          ? "COMPLETED"
          : "IN_PROGRESS",
    },
  });
}
