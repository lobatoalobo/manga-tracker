"use server";

import { revalidatePath } from "next/cache";
import {
  addToCollection,
  removeFromCollection,
  toggleVolume,
  setCustomTotal,
  type AddMangaInput,
} from "@/lib/collection";
import { createReport, setReportStatus } from "@/lib/reports";

export async function addMangaAction(manga: AddMangaInput) {
  await addToCollection(manga);
  revalidatePath("/collection");
  revalidatePath(`/manga/${manga.id}`);
}

export async function removeMangaAction(id: number) {
  await removeFromCollection(id);
  revalidatePath("/collection");
  revalidatePath(`/manga/${id}`);
}

export async function toggleVolumeAction(mangaId: number, volume: number) {
  await toggleVolume(mangaId, volume);
  revalidatePath("/collection");
  revalidatePath(`/manga/${mangaId}`);
}

export async function setCustomTotalAction(
  mangaId: number,
  total: number | null,
) {
  await setCustomTotal(mangaId, total);
  revalidatePath("/collection");
  revalidatePath(`/manga/${mangaId}`);
}

export async function createReportAction(input: {
  mangaId?: number | null;
  mangaTitle: string;
  message: string;
}) {
  const message = input.message.trim();
  if (!message) return { ok: false as const, error: "El reporte está vacío." };

  await createReport({ ...input, message });
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
