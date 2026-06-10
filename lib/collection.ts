import { prisma } from "@/lib/prisma";
import { getTotalVolumes } from "@/lib/getTotalVolumes";
import type { Manga, OwnedVolume } from "@prisma/client";

type MangaRow = Manga & { ownedVolumes: OwnedVolume[] };

/**
 * Forma que consume la UI. Mantiene `title` como objeto y `ownedVolumes`
 * como array de números, igual que el formato JSON anterior, para que los
 * componentes existentes sigan funcionando.
 */
export interface MangaView {
  id: number;
  title: { romaji: string; english: string | null; native: string | null };
  coverImage: string;
  apiTotalVolumes: number | null;
  muVolumes: number | null;
  customTotalVolumes: number | null;
  publisher: string | null;
  editionSlug: string | null;
  argentinaStatus: string | null;
  argentinaVolumes: number | null;
  japanStatus: string | null;
  japanVolumes: number | null;
  nextVolume: number | null;
  status: string;
  readingStatus: string;
  readingVolume: number | null;
  ownedVolumes: number[];
}

function toView(row: MangaRow): MangaView {
  return {
    id: row.id,
    title: {
      romaji: row.romajiTitle,
      english: row.englishTitle,
      native: row.nativeTitle,
    },
    coverImage: row.coverImage,
    apiTotalVolumes: row.apiTotalVolumes,
    muVolumes: row.muVolumes,
    customTotalVolumes: row.customTotalVolumes,
    publisher: row.publisher,
    editionSlug: row.editionSlug,
    argentinaStatus: row.argentinaStatus,
    argentinaVolumes: row.argentinaVolumes,
    japanStatus: row.japanStatus,
    japanVolumes: row.japanVolumes,
    nextVolume: row.nextVolume,
    status: row.status,
    readingStatus: row.readingStatus,
    readingVolume: row.readingVolume,
    ownedVolumes: row.ownedVolumes
      .map((v) => v.volume)
      .sort((a, b) => a - b),
  };
}

export async function getCollection(): Promise<MangaView[]> {
  const rows = await prisma.manga.findMany({
    include: { ownedVolumes: true },
    orderBy: { romajiTitle: "asc" },
  });

  return rows.map(toView);
}

export async function getMangaFromCollection(
  id: number,
): Promise<MangaView | null> {
  const row = await prisma.manga.findUnique({
    where: { id },
    include: { ownedVolumes: true },
  });

  return row ? toView(row) : null;
}

export interface AddMangaInput {
  id: number;
  title: { romaji: string; english?: string | null; native?: string | null };
  coverImage: string;
  volumes?: number | null;
  /** Tomos de la edición estándar según MangaUpdates (fuente autoritativa). */
  muVolumes?: number | null;
  /** Edición local que se trackea (Ivrea, Panini, etc.). */
  edition?: {
    publisher?: string | null;
    slug?: string | null;
    status?: string | null;
    volumes?: number | null; // tomos de la edición local
    nextVolume?: number | null;
  } | null;
  /** Tomos de la edición japonesa (referencia, respaldo para el total). */
  japanVolumes?: number | null;
}

export async function addToCollection(manga: AddMangaInput): Promise<void> {
  const edition = manga.edition ?? null;

  await prisma.manga.upsert({
    where: { id: manga.id },
    update: {
      // Al re-agregar, actualizamos la edición elegida y su total.
      publisher: edition?.publisher ?? undefined,
      editionSlug: edition?.slug ?? undefined,
      argentinaStatus: edition?.status ?? undefined,
      // La edición elegida define el total a coleccionar.
      customTotalVolumes: edition?.volumes ?? undefined,
      nextVolume: edition?.nextVolume ?? undefined,
      muVolumes: manga.muVolumes ?? undefined,
      japanVolumes: manga.japanVolumes ?? undefined,
    },
    create: {
      id: manga.id,
      romajiTitle: manga.title.romaji,
      englishTitle: manga.title.english ?? null,
      nativeTitle: manga.title.native ?? null,
      coverImage: manga.coverImage,
      apiTotalVolumes: manga.volumes ?? null,
      muVolumes: manga.muVolumes ?? null,
      // La edición elegida define el total a coleccionar.
      customTotalVolumes: edition?.volumes ?? null,
      publisher: edition?.publisher ?? null,
      editionSlug: edition?.slug ?? null,
      argentinaStatus: edition?.status ?? null,
      argentinaVolumes: null,
      japanStatus: null,
      japanVolumes: manga.japanVolumes ?? null,
      nextVolume: edition?.nextVolume ?? null,
      status: "IN_PROGRESS",
    },
  });
}

export async function removeFromCollection(id: number): Promise<void> {
  await prisma.manga.deleteMany({ where: { id } });
}

export async function toggleVolume(
  mangaId: number,
  volume: number,
): Promise<void> {
  const manga = await prisma.manga.findUnique({
    where: { id: mangaId },
    include: { ownedVolumes: true },
  });

  if (!manga) return;

  const owns = manga.ownedVolumes.some((v) => v.volume === volume);

  if (owns) {
    await prisma.ownedVolume.deleteMany({ where: { mangaId, volume } });
  } else {
    await prisma.ownedVolume.create({ data: { mangaId, volume } });
  }

  const ownedCount = owns
    ? manga.ownedVolumes.length - 1
    : manga.ownedVolumes.length + 1;

  const total = getTotalVolumes(manga);

  const status =
    total > 0 && ownedCount >= total ? "COMPLETED" : "IN_PROGRESS";

  await prisma.manga.update({ where: { id: mangaId }, data: { status } });
}

export async function setCustomTotal(
  mangaId: number,
  total: number | null,
): Promise<void> {
  await prisma.manga.update({
    where: { id: mangaId },
    data: { customTotalVolumes: total },
  });
}

export type ReadingStatus = "UNREAD" | "READING" | "READ";

/** Actualiza el estado de lectura y el tomo por el que va el usuario. */
export async function setReading(
  mangaId: number,
  status: ReadingStatus,
  volume: number | null,
): Promise<void> {
  await prisma.manga.update({
    where: { id: mangaId },
    data: { readingStatus: status, readingVolume: volume },
  });
}

/**
 * Marca todos los tomos de una serie como propios, o los limpia todos.
 * Útil para series que ya tenés completas (no ir tomo por tomo).
 */
export async function setAllVolumes(
  mangaId: number,
  owned: boolean,
): Promise<void> {
  const manga = await prisma.manga.findUnique({
    where: { id: mangaId },
    include: { ownedVolumes: true },
  });
  if (!manga) return;

  const total = getTotalVolumes(manga);

  // Reseteamos y, si corresponde, recreamos 1..total de una.
  await prisma.ownedVolume.deleteMany({ where: { mangaId } });

  if (owned && total > 0) {
    await prisma.ownedVolume.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        mangaId,
        volume: i + 1,
      })),
    });
  }

  await prisma.manga.update({
    where: { id: mangaId },
    data: { status: owned && total > 0 ? "COMPLETED" : "IN_PROGRESS" },
  });
}
