import { prisma } from "@/lib/prisma";
import { getTotalVolumes } from "@/lib/getTotalVolumes";
import type { Manga, OwnedVolume } from "@prisma/client";

type MangaRow = Manga & { ownedVolumes: OwnedVolume[] };

/**
 * Forma que consume la UI. `id` es el id de AniList (no el PK interno), para
 * que los componentes y rutas sigan trabajando con ids de AniList.
 */
export interface MangaView {
  id: number; // anilistId
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
    id: row.anilistId,
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
    ownedVolumes: row.ownedVolumes.map((v) => v.volume).sort((a, b) => a - b),
  };
}

export async function getCollection(userId: string): Promise<MangaView[]> {
  const rows = await prisma.manga.findMany({
    where: { userId },
    include: { ownedVolumes: true },
    orderBy: { romajiTitle: "asc" },
  });
  return rows.map(toView);
}

export async function getMangaFromCollection(
  userId: string,
  anilistId: number,
): Promise<MangaView | null> {
  const row = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    include: { ownedVolumes: true },
  });
  return row ? toView(row) : null;
}

export interface AddMangaInput {
  id: number; // anilistId
  title: { romaji: string; english?: string | null; native?: string | null };
  coverImage: string;
  volumes?: number | null;
  muVolumes?: number | null;
  edition?: {
    publisher?: string | null;
    slug?: string | null;
    status?: string | null;
    volumes?: number | null;
    nextVolume?: number | null;
  } | null;
  japanVolumes?: number | null;
}

export async function addToCollection(
  userId: string,
  manga: AddMangaInput,
): Promise<void> {
  const edition = manga.edition ?? null;

  await prisma.manga.upsert({
    where: { userId_anilistId: { userId, anilistId: manga.id } },
    update: {
      publisher: edition?.publisher ?? undefined,
      editionSlug: edition?.slug ?? undefined,
      argentinaStatus: edition?.status ?? undefined,
      customTotalVolumes: edition?.volumes ?? undefined,
      nextVolume: edition?.nextVolume ?? undefined,
      muVolumes: manga.muVolumes ?? undefined,
      japanVolumes: manga.japanVolumes ?? undefined,
    },
    create: {
      anilistId: manga.id,
      userId,
      romajiTitle: manga.title.romaji,
      englishTitle: manga.title.english ?? null,
      nativeTitle: manga.title.native ?? null,
      coverImage: manga.coverImage,
      apiTotalVolumes: manga.volumes ?? null,
      muVolumes: manga.muVolumes ?? null,
      customTotalVolumes: edition?.volumes ?? null,
      publisher: edition?.publisher ?? null,
      editionSlug: edition?.slug ?? null,
      argentinaStatus: edition?.status ?? null,
      japanVolumes: manga.japanVolumes ?? null,
      nextVolume: edition?.nextVolume ?? null,
      status: "IN_PROGRESS",
    },
  });
}

export async function removeFromCollection(
  userId: string,
  anilistId: number,
): Promise<void> {
  await prisma.manga.deleteMany({ where: { userId, anilistId } });
}

export async function toggleVolume(
  userId: string,
  anilistId: number,
  volume: number,
): Promise<void> {
  const manga = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    include: { ownedVolumes: true },
  });
  if (!manga) return;

  const owns = manga.ownedVolumes.some((v) => v.volume === volume);

  if (owns) {
    await prisma.ownedVolume.deleteMany({ where: { mangaId: manga.id, volume } });
  } else {
    await prisma.ownedVolume.create({ data: { mangaId: manga.id, volume } });
  }

  const ownedCount = owns
    ? manga.ownedVolumes.length - 1
    : manga.ownedVolumes.length + 1;
  const total = getTotalVolumes(manga);

  await prisma.manga.update({
    where: { id: manga.id },
    data: {
      status: total > 0 && ownedCount >= total ? "COMPLETED" : "IN_PROGRESS",
    },
  });
}

export async function setCustomTotal(
  userId: string,
  anilistId: number,
  total: number | null,
): Promise<void> {
  await prisma.manga.update({
    where: { userId_anilistId: { userId, anilistId } },
    data: { customTotalVolumes: total },
  });
}

export type ReadingStatus = "UNREAD" | "READING" | "READ";

export async function setReading(
  userId: string,
  anilistId: number,
  status: ReadingStatus,
  volume: number | null,
): Promise<void> {
  await prisma.manga.update({
    where: { userId_anilistId: { userId, anilistId } },
    data: { readingStatus: status, readingVolume: volume },
  });
}

/** Marca todos los tomos como propios, o los limpia todos. */
export async function setAllVolumes(
  userId: string,
  anilistId: number,
  owned: boolean,
): Promise<void> {
  const manga = await prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    include: { ownedVolumes: true },
  });
  if (!manga) return;

  const total = getTotalVolumes(manga);

  await prisma.ownedVolume.deleteMany({ where: { mangaId: manga.id } });

  if (owned && total > 0) {
    await prisma.ownedVolume.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        mangaId: manga.id,
        volume: i + 1,
      })),
    });
  }

  await prisma.manga.update({
    where: { id: manga.id },
    data: { status: owned && total > 0 ? "COMPLETED" : "IN_PROGRESS" },
  });
}
