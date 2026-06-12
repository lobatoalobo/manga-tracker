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
  importEdition,
  addPurchaseItemToCollection,
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
import {
  createIndieWork,
  setIndieWorkStatus,
  deleteIndieWork,
  type IndieWorkInput,
} from "@/lib/indie";
import {
  setEditionAnilistId,
  updatePublisherEditionFields,
  deletePublisherEdition,
  setEditionNationalOnly,
} from "@/lib/catalog";
import { resolveEditionSeries } from "@/lib/resolveSeries";
import { isAdmin } from "@/lib/admin";
import {
  addPurchase,
  updatePurchase,
  setPurchaseItemStatus,
  deletePurchase,
  normalizeStatus,
  type PurchaseStatus,
  type PurchaseItemInput,
  type UpdatePurchaseItem,
} from "@/lib/purchases";
import { searchMangaList } from "@/lib/anilist";
import { setCrumbQuery, setEditionUrl } from "@/lib/storeLinks";
import {
  invalidateEditionsCache,
  clearAllEditionsCache,
} from "@/lib/getMangaDetails";
import { dispatchCrawl } from "@/lib/github";
import { runAdminTask } from "@/lib/adminTasks";
import { parseCsv } from "@/lib/csv";
import { addWish, removeWish } from "@/lib/wishlist";
import { setNote } from "@/lib/notes";
import {
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  logActivity,
  toggleReaction,
  addComment,
  deleteComment,
} from "@/lib/social";
import { prisma } from "@/lib/prisma";

export async function addEditionAction(input: AddEditionInput) {
  const userId = await requireUserId();
  await addEdition(userId, input);
  await logActivity(userId, {
    type: "ADDED_EDITION",
    anilistId: input.anilistId,
    title: input.title.romaji,
    coverImage: input.coverImage,
    detail: input.edition.label,
  });
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
  if (owned) {
    const m = await mangaInfo(userId, anilistId);
    if (m)
      await logActivity(userId, {
        type: "COMPLETED",
        anilistId,
        title: m.romajiTitle,
        coverImage: m.coverImage,
      });
  }
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
  if (status === "READ") {
    const m = await mangaInfo(userId, anilistId);
    if (m)
      await logActivity(userId, {
        type: "MARKED_READ",
        anilistId,
        title: m.romajiTitle,
        coverImage: m.coverImage,
      });
  }
  revalidatePath("/collection");
  revalidatePath(`/manga/${anilistId}`);
}

async function mangaInfo(userId: string, anilistId: number) {
  return prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    select: { romajiTitle: true, coverImage: true },
  });
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

// --- Autores independientes ---

function readIndieWork(formData: FormData): IndieWorkInput {
  const get = (k: string) => (formData.get(k) as string | null) ?? null;
  return {
    title: (get("title") ?? "").trim(),
    author: (get("author") ?? "").trim(),
    synopsis: get("synopsis"),
    coverUrl: get("coverUrl"),
    buyUrl: get("buyUrl"),
    social: get("social"),
  };
}

/** Un autor sube su obra: queda PENDING para que el dueño la apruebe. */
export async function submitIndieWorkAction(
  _prev: unknown,
  formData: FormData,
) {
  const userId = await requireUserId();
  const input = readIndieWork(formData);
  if (!input.title || !input.author) {
    return { ok: false as const, error: "Faltan título o autor." };
  }
  await createIndieWork(input, { status: "PENDING", submittedBy: userId });
  revalidatePath("/admin/independientes");
  return { ok: true as const };
}

export async function approveIndieWorkAction(id: number) {
  await assertAdmin();
  await setIndieWorkStatus(id, "APPROVED");
  revalidatePath("/admin/independientes");
  revalidatePath("/independientes");
}

export async function deleteIndieWorkAction(id: number) {
  await assertAdmin();
  await deleteIndieWork(id);
  revalidatePath("/admin/independientes");
  revalidatePath("/independientes");
}

// --- Curación de mapeos editorial ↔ serie ---

/** Setea (o limpia con null) el anilistId de una edición del catálogo. */
export async function setEditionMappingAction(
  id: number,
  anilistId: number | null,
) {
  await assertAdmin();
  await setEditionAnilistId(id, anilistId);
  revalidatePath("/admin/mapeos");
}

/** Resuelve automáticamente (verificado por autor) una edición. */
export async function resolveEditionMappingAction(id: number) {
  await assertAdmin();
  const row = await prisma.publisherEdition.findUnique({
    where: { id },
    select: { publisher: true, slug: true, title: true },
  });
  if (row) {
    const anilistId = await resolveEditionSeries(row).catch(() => null);
    await setEditionAnilistId(id, anilistId);
  }
  revalidatePath("/admin/mapeos");
}

/** Edición manual de los campos de una entrada del catálogo. */
export async function updateEditionAction(
  id: number,
  data: { title?: string; url?: string; volumes?: number; anilistId?: number | null },
) {
  await assertAdmin();
  await updatePublisherEditionFields(id, data);
  revalidatePath("/admin/mapeos");
}

/** Borra una entrada del catálogo (p. ej. una entrada fantasma de Panini). */
export async function deleteEditionAction(id: number) {
  await assertAdmin();
  await deletePublisherEdition(id);
  revalidatePath("/admin/mapeos");
}

/** Marca/desmarca una edición como solo-nacional (sin equivalente en AniList). */
export async function setEditionNationalOnlyAction(id: number, value: boolean) {
  await assertAdmin();
  await setEditionNationalOnly(id, value);
  revalidatePath("/admin/mapeos");
  revalidatePath("/admin/herramientas");
}

async function assertAdmin() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) throw new Error("No autorizado");
}

/** Admin: dispara un crawl/job en GitHub Actions. */
export async function runCrawlAction(job: string) {
  await assertAdmin();
  return dispatchCrawl(job);
}

/** Admin: corre una tarea de mantenimiento (dry-run = solo simula). */
export async function runAdminTaskAction(id: string, dryRun: boolean) {
  await assertAdmin();
  try {
    const res = await runAdminTask(id, dryRun);
    if (!dryRun) revalidatePath("/admin/herramientas");
    return { ok: true as const, dryRun, ...res };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Error" };
  }
}

/** Admin: vacía toda la caché de ediciones (sin redeploy). */
export async function flushEditionsCacheAction() {
  await assertAdmin();
  const count = await clearAllEditionsCache();
  revalidatePath("/admin/herramientas");
  return { ok: true as const, count };
}

/** Admin: override del término de búsqueda de Crumb para una serie. */
export async function setCrumbQueryAction(anilistId: number, query: string) {
  await assertAdmin();
  await setCrumbQuery(anilistId, query);
  revalidatePath(`/manga/${anilistId}`);
}

/** Admin: corrige el link de tienda de una edición (cualquier editorial). */
export async function setEditionUrlAction(
  anilistId: number,
  editionId: number,
  url: string,
) {
  await assertAdmin();
  await setEditionUrl(editionId, url);
  // El link sale de la caché de ediciones (no en vivo): hay que invalidarla.
  await invalidateEditionsCache(anilistId);
  revalidatePath(`/manga/${anilistId}`);
}

// --- Compras ---

export interface AddPurchaseInput {
  store?: string | null;
  status?: string | null;
  purchasedAt?: string | null;
  note?: string | null;
  discount?: number | null;
  addToCollection?: boolean;
  items: {
    title: string;
    anilistId?: number | null;
    coverImage?: string | null;
    volume?: number | null;
    edition?: string | null;
    price: number;
    status?: string | null;
  }[];
}

export async function addPurchaseAction(input: AddPurchaseInput) {
  const userId = await requireUserId();

  const status = normalizeStatus(input.status);
  const items: PurchaseItemInput[] = (input.items ?? [])
    .map((i) => ({
      title: (i.title ?? "").trim(),
      anilistId: i.anilistId ?? null,
      coverImage: i.coverImage ?? null,
      volume: i.volume ?? null,
      edition: i.edition ?? null,
      price: Number(i.price),
      status: normalizeStatus(i.status ?? status),
    }))
    .filter((i) => i.title && Number.isFinite(i.price));

  if (items.length === 0) {
    return { ok: false as const, error: "Agregá al menos un tomo con precio." };
  }

  await addPurchase(userId, {
    store: input.store ?? null,
    status,
    note: input.note ?? null,
    discount: input.discount ?? 0,
    purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
    items,
  });

  // Auto-agregar a colección los tomos linkeados a una serie (salvo cancelados).
  if (input.addToCollection) {
    for (const it of items) {
      if (it.anilistId && it.status !== "CANCELLED") {
        await addPurchaseItemToCollection(userId, {
          anilistId: it.anilistId,
          title: it.title,
          coverImage: it.coverImage,
          volume: it.volume,
          edition: it.edition,
        }).catch(() => {});
      }
    }
    revalidatePath("/collection");
  }

  revalidatePath("/compras");
  return { ok: true as const };
}

export interface EditPurchaseInput {
  store?: string | null;
  purchasedAt?: string | null;
  note?: string | null;
  discount?: number | null;
  addToCollection?: boolean;
  items: {
    id?: number | null;
    title: string;
    anilistId?: number | null;
    coverImage?: string | null;
    volume?: number | null;
    edition?: string | null;
    price: number;
  }[];
}

export async function updatePurchaseAction(
  id: number,
  input: EditPurchaseInput,
) {
  const userId = await requireUserId();

  const items: UpdatePurchaseItem[] = (input.items ?? [])
    .map((i) => ({
      id: i.id ?? null,
      title: (i.title ?? "").trim(),
      anilistId: i.anilistId ?? null,
      coverImage: i.coverImage ?? null,
      volume: i.volume ?? null,
      edition: i.edition ?? null,
      price: Number(i.price),
    }))
    .filter((i) => i.title && Number.isFinite(i.price));

  if (items.length === 0) {
    return { ok: false as const, error: "La compra necesita al menos un tomo." };
  }

  const res = await updatePurchase(userId, id, {
    store: input.store ?? null,
    note: input.note ?? null,
    discount: input.discount ?? 0,
    purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
    items,
  });
  if (!res) {
    return { ok: false as const, error: "No se encontró la compra." };
  }

  // Sumar a colección solo los tomos nuevos linkeados (los existentes no se
  // re-agregan para no pisar lo que el usuario haya tocado).
  if (input.addToCollection) {
    for (const it of res.created) {
      if (it.anilistId && it.status !== "CANCELLED") {
        await addPurchaseItemToCollection(userId, {
          anilistId: it.anilistId,
          title: it.title,
          coverImage: it.coverImage,
          volume: it.volume,
          edition: it.edition,
        }).catch(() => {});
      }
    }
    revalidatePath("/collection");
  }

  revalidatePath("/compras");
  return { ok: true as const };
}

export async function setPurchaseItemStatusAction(
  itemId: number,
  status: string,
) {
  const userId = await requireUserId();
  await setPurchaseItemStatus(
    userId,
    itemId,
    normalizeStatus(status) as PurchaseStatus,
  );
  revalidatePath("/compras");
}

/** Búsqueda liviana de series para el selector del form de compras. */
export async function searchPurchaseSeriesAction(query: string) {
  const q = query.trim();
  if (q.length < 2) return [];
  const raw = await searchMangaList(q, true).catch(() => []);
  return raw.slice(0, 8).map((m: any) => ({
    id: m.id as number,
    title: (m.title?.english || m.title?.romaji || m.title?.native) as string,
    coverImage: (m.coverImage?.large ?? null) as string | null,
  }));
}

export async function deletePurchaseAction(id: number) {
  const userId = await requireUserId();
  await deletePurchase(userId, id);
  revalidatePath("/compras");
}

// --- Wishlist ---

export async function toggleWishAction(item: {
  anilistId: number;
  title: string;
  coverImage: string;
  wished: boolean;
}) {
  const userId = await requireUserId();
  if (item.wished) {
    await removeWish(userId, item.anilistId);
  } else {
    await addWish(userId, item);
  }
  revalidatePath("/deseados");
  revalidatePath(`/manga/${item.anilistId}`);
}

export async function removeWishAction(anilistId: number) {
  const userId = await requireUserId();
  await removeWish(userId, anilistId);
  revalidatePath("/deseados");
  revalidatePath(`/manga/${anilistId}`);
}

// --- Notas / puntaje ---

export async function setNoteAction(
  anilistId: number,
  rating: number | null,
  note: string | null,
) {
  const userId = await requireUserId();
  await setNote(userId, anilistId, {
    rating: rating && rating > 0 ? rating : null,
    note: note?.trim() || null,
  });
  revalidatePath(`/manga/${anilistId}`);
}

// --- Social (amigos / actividad) ---

export async function sendFriendRequestAction(_prev: unknown, formData: FormData) {
  const userId = await requireUserId();
  const email = ((formData.get("email") as string | null) ?? "").trim();
  if (!email) return { ok: false as const, error: "Ingresá un email." };
  const res = await sendFriendRequest(userId, email);
  revalidatePath("/amigos");
  return res.ok
    ? { ok: true as const }
    : { ok: false as const, error: res.error };
}

export async function respondFriendRequestAction(
  friendshipId: number,
  accept: boolean,
) {
  const userId = await requireUserId();
  await respondFriendRequest(userId, friendshipId, accept);
  revalidatePath("/amigos");
}

export async function removeFriendAction(otherId: string) {
  const userId = await requireUserId();
  await removeFriend(userId, otherId);
  revalidatePath("/amigos");
}

export async function toggleReactionAction(activityId: number, emoji: string) {
  const userId = await requireUserId();
  await toggleReaction(userId, activityId, emoji);
  revalidatePath("/amigos");
}

export async function addCommentAction(activityId: number, text: string) {
  const userId = await requireUserId();
  await addComment(userId, activityId, text);
  revalidatePath("/amigos");
}

export async function deleteCommentAction(commentId: number) {
  const userId = await requireUserId();
  await deleteComment(userId, commentId);
  revalidatePath("/amigos");
}

// --- Importar colección (CSV) ---

export async function importCollectionAction(_prev: unknown, formData: FormData) {
  const userId = await requireUserId();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0)
    return { ok: false as const, error: "Subí un archivo CSV." };

  const rows = parseCsv(await file.text());
  if (rows.length < 2)
    return { ok: false as const, error: "El CSV está vacío o sin filas." };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => {
    for (const n of names) {
      const k = header.indexOf(n);
      if (k >= 0) return k;
    }
    return -1;
  };
  const col = {
    anilistId: idx(["anilistid"]),
    romaji: idx(["romaji", "title", "titulo", "título", "nombre"]),
    english: idx(["english"]),
    native: idx(["native"]),
    cover: idx(["coverimage", "cover", "portada"]),
    editionKey: idx(["editionkey"]),
    editionLabel: idx([
      "editionlabel",
      "edition",
      "edicion",
      "edición",
      "editorial",
    ]),
    publisher: idx(["publisher"]),
    region: idx(["region", "región"]),
    total: idx(["totalvolumes", "total", "tomos"]),
    readingStatus: idx(["readingstatus", "lectura"]),
    readingVolume: idx(["readingvolume"]),
    owned: idx(["owned", "mis_tomos", "tengo"]),
  };

  let imported = 0;
  const errors: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const g = (k: number) => (k >= 0 ? (cells[k] ?? "").trim() : "");
    try {
      const owned = g(col.owned)
        .split(/[^0-9]+/)
        .filter(Boolean)
        .map(Number);
      await importEdition(userId, {
        anilistId: g(col.anilistId) ? Number(g(col.anilistId)) : null,
        romaji: g(col.romaji) || null,
        english: g(col.english) || null,
        native: g(col.native) || null,
        coverImage: g(col.cover) || null,
        editionKey: g(col.editionKey) || null,
        editionLabel: g(col.editionLabel) || "Edición",
        publisher: g(col.publisher) || null,
        region: g(col.region) || null,
        totalVolumes: Number(g(col.total)) || 0,
        readingStatus: g(col.readingStatus) || null,
        readingVolume: g(col.readingVolume) ? Number(g(col.readingVolume)) : null,
        owned,
      });
      imported++;
    } catch (e) {
      errors.push(`Fila ${r}: ${(e as Error).message}`);
    }
  }

  revalidatePath("/collection");
  return { ok: true as const, imported, errors: errors.slice(0, 5) };
}
