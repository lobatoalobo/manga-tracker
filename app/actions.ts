"use server";

import { revalidatePath } from "next/cache";
import { auth, requireUserId } from "@/auth";
import {
  addToCollection,
  removeFromCollection,
  toggleVolume,
  setCustomTotal,
  setAllVolumes,
  setReading,
  type AddMangaInput,
  type ReadingStatus,
} from "@/lib/collection";
import { createReport, setReportStatus } from "@/lib/reports";

export async function addMangaAction(manga: AddMangaInput) {
  const userId = await requireUserId();
  await addToCollection(userId, manga);
  revalidatePath("/collection");
  revalidatePath(`/manga/${manga.id}`);
}

export async function removeMangaAction(anilistId: number) {
  const userId = await requireUserId();
  await removeFromCollection(userId, anilistId);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function toggleVolumeAction(anilistId: number, volume: number) {
  const userId = await requireUserId();
  await toggleVolume(userId, anilistId, volume);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function setAllVolumesAction(anilistId: number, owned: boolean) {
  const userId = await requireUserId();
  await setAllVolumes(userId, anilistId, owned);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function setReadingAction(
  anilistId: number,
  status: ReadingStatus,
  volume: number | null,
) {
  const userId = await requireUserId();
  await setReading(userId, anilistId, status, volume);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function setCustomTotalAction(
  anilistId: number,
  total: number | null,
) {
  const userId = await requireUserId();
  await setCustomTotal(userId, anilistId, total);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function createReportAction(input: {
  mangaId?: number | null;
  mangaTitle: string;
  message: string;
}) {
  const message = input.message.trim();
  if (!message) return { ok: false as const, error: "El reporte está vacío." };

  const session = await auth();
  await createReport({ ...input, message, userId: session?.user?.id ?? null });
  revalidatePath("/admin/reportes");
  return { ok: true as const };
}

export async function resolveReportAction(
  id: number,
  status: "PENDING" | "RESOLVED",
) {
  await setReportStatus(id, status);
  revalidatePath("/admin/reportes");
}
