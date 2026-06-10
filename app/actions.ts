"use server";

import { revalidatePath } from "next/cache";
import { auth, requireUserId } from "@/auth";
import {
  addEdition,
  removeEdition,
  toggleVolume,
  setAllVolumes,
  setReading,
  setSharing,
  type AddEditionInput,
  type ReadingStatus,
} from "@/lib/collection";
import { createReport, setReportStatus } from "@/lib/reports";
import {
  createStore,
  setStoreStatus,
  deleteStore,
  type StoreInput,
} from "@/lib/stores";
import { isAdmin } from "@/lib/admin";

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

export async function setSharingAction(enable: boolean) {
  const userId = await requireUserId();
  const slug = await setSharing(userId, enable);
  revalidatePath("/collection");
  return { slug };
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

// --- Tiendas ---

function readStore(formData: FormData): StoreInput {
  const get = (k: string) => (formData.get(k) as string | null) ?? null;
  return {
    name: (get("name") ?? "").trim(),
    address: get("address"),
    city: get("city"),
    province: get("province"),
    phone: get("phone"),
    hours: get("hours"),
    website: get("website"),
    social: get("social"),
  };
}

/** Propuesta de la comunidad: queda PENDING para que el dueño la apruebe. */
export async function submitStoreAction(_prev: unknown, formData: FormData) {
  const userId = await requireUserId();
  const input = readStore(formData);
  if (!input.name) return { ok: false as const, error: "Falta el nombre." };

  await createStore(input, { status: "PENDING", submittedBy: userId });
  revalidatePath("/admin/tiendas");
  return { ok: true as const };
}

export async function createStoreAdminAction(formData: FormData) {
  await assertAdmin();
  const input = readStore(formData);
  if (!input.name) return;
  await createStore(input, { status: "APPROVED" });
  revalidatePath("/admin/tiendas");
  revalidatePath("/tiendas");
}

export async function approveStoreAction(id: number) {
  await assertAdmin();
  await setStoreStatus(id, "APPROVED");
  revalidatePath("/admin/tiendas");
  revalidatePath("/tiendas");
}

export async function deleteStoreAction(id: number) {
  await assertAdmin();
  await deleteStore(id);
  revalidatePath("/admin/tiendas");
  revalidatePath("/tiendas");
}

async function assertAdmin() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) throw new Error("No autorizado");
}
