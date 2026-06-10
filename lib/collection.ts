import { prisma } from "@/lib/prisma";
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
  coverImage: string;
  edition: EditionView;
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
        coverImage: m.coverImage,
        edition: toEditionView(e),
      });
    }
  }
  return items;
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

export async function setReading(
  userId: string,
  anilistId: number,
  key: string,
  status: ReadingStatus,
  volume: number | null,
): Promise<void> {
  const ed = await findEdition(userId, anilistId, key);
  if (!ed) return;
  await prisma.trackedEdition.update({
    where: { id: ed.id },
    data: { readingStatus: status, readingVolume: volume },
  });
}
