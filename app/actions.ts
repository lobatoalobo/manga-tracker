"use server";

import { revalidatePath } from "next/cache";
import { auth, requireUserId } from "@/auth";
import {
  addEdition,
  removeEdition,
  toggleVolume,
  setAllVolumes,
  setReading,
  type AddEditionInput,
  type ReadingStatus,
} from "@/lib/collection";
import { createReport, setReportStatus } from "@/lib/reports";

export async function addEditionAction(input: AddEditionInput) {
  const userId = await requireUserId();
  await addEdition(userId, input);
  revalidatePath("/collection");
  revalidatePath(`/manga/${input.anilistId}`);
}

export async function removeEditionAction(anilistId: number, key: string) {
  const userId = await requireUserId();
  await removeEdition(userId, anilistId, key);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function toggleVolumeAction(
  anilistId: number,
  key: string,
  volume: number,
) {
  const userId = await requireUserId();
  await toggleVolume(userId, anilistId, key, volume);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function setAllVolumesAction(
  anilistId: number,
  key: string,
  owned: boolean,
) {
  const userId = await requireUserId();
  await setAllVolumes(userId, anilistId, key, owned);
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

export async function setReadingAction(
  anilistId: number,
  key: string,
  status: ReadingStatus,
  volume: number | null,
) {
  const userId = await requireUserId();
  await setReading(userId, anilistId, key, status, volume);
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
