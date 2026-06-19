"use server";

import { revalidatePath } from "next/cache";
import { auth, requireUserId, signOut } from "@/auth";
import { deleteAccount } from "@/lib/account";
import {
  addEdition,
  removeEdition,
  toggleVolume,
  setAllVolumes,
  setVolumesUpTo,
  setReading,
  setSharing,
  importEdition,
  addPurchaseItemToCollection,
  removePurchaseItemFromCollection,
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
  upsertPublisherEdition,
  slugifyTitle,
  normalizeTitle,
  searchPurchaseEditions,
  EDITORIALS,
} from "@/lib/catalog";
import { ANILIST_OFF } from "@/lib/flags";
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
import { normalizeReleaseLabel } from "@/lib/releaseDate";
import {
  invalidateEditionsCache,
  clearAllEditionsCache,
} from "@/lib/getMangaDetails";
import { dispatchCrawl } from "@/lib/github";
import { importWhakoomUrl } from "@/lib/whakoomImport";
import { runAdminTask } from "@/lib/adminTasks";
import { setNotifPref, type NotifCategory } from "@/lib/notificationPrefs";
import {
  deleteNotification,
  deleteAllNotifications,
} from "@/lib/notifications";
import {
  saveSubscription,
  deleteSubscription,
  sendPushToUser,
  type WebPushSub,
} from "@/lib/push";
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
import { enforceRateLimit, RL } from "@/lib/rateLimit";
import { rejectEditions } from "@/lib/rejectedSources";
import { safeHttpUrl, seriesHref } from "@/lib/url";

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
  revalidatePath(seriesHref(anilistId));
}

export async function toggleVolumeAction(
  anilistId: number,
  key: string,
  volume: number,
) {
  const userId = await requireUserId();
  await toggleVolume(userId, anilistId, key, volume);
  revalidatePath("/collection");
  revalidatePath(seriesHref(anilistId));
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
  revalidatePath(seriesHref(anilistId));
}

export async function setVolumesUpToAction(
  anilistId: number,
  key: string,
  n: number,
) {
  const userId = await requireUserId();
  await setVolumesUpTo(userId, anilistId, key, n);
  revalidatePath("/collection");
  revalidatePath(seriesHref(anilistId));
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
  revalidatePath(seriesHref(anilistId));
}

async function mangaInfo(userId: string, anilistId: number) {
  return prisma.manga.findUnique({
    where: { userId_anilistId: { userId, anilistId } },
    select: { romajiTitle: true, coverImage: true },
  });
}

/**
 * Borra la cuenta del usuario y todos sus datos, y cierra la sesión. Acción
 * irreversible (derecho de supresión). El `signOut` redirige a la home.
 */
export async function deleteAccountAction() {
  const userId = await requireUserId();
  await deleteAccount(userId);
  await signOut({ redirectTo: "/" });
}

export async function setSharingAction(enable: boolean) {
  const userId = await requireUserId();
  const slug = await setSharing(userId, enable);
  revalidatePath("/collection");
  return { slug };
}

/** Silencia (o reactiva) las notificaciones de UNA serie para el usuario. */
export async function setSeriesMutedAction(anilistId: number, muted: boolean) {
  const userId = await requireUserId();
  if (muted)
    await prisma.seriesNotifMute.upsert({
      where: { userId_anilistId: { userId, anilistId } },
      create: { userId, anilistId },
      update: {},
    });
  else await prisma.seriesNotifMute.deleteMany({ where: { userId, anilistId } });
  revalidatePath(seriesHref(anilistId));
}

/** Marca (o desmarca) la serie preferida del usuario (1 por usuario). */
export async function setFavoriteAction(anilistId: number, makeFavorite: boolean) {
  const userId = await requireUserId();
  await prisma.user.update({
    where: { id: userId },
    data: { favoriteAnilistId: makeFavorite ? anilistId : null },
  });
  revalidatePath("/collection");
}

export async function createReportAction(input: {
  mangaId?: number | null;
  mangaTitle: string;
  message: string;
}) {
  const message = input.message.trim();
  if (!message) return { ok: false as const, error: "El reporte está vacío." };

  const rl = await enforceRateLimit("report", RL.report);
  if (!rl.ok) return { ok: false as const, error: rl.error };

  const session = await auth();
  await createReport({ ...input, message, userId: session?.user?.id ?? null });
  revalidatePath("/admin/reportes");
  return { ok: true as const };
}

export async function resolveReportAction(
  id: number,
  status: "PENDING" | "RESOLVED",
) {
  await assertAdmin(); // solo el dueño resuelve reportes
  await setReportStatus(id, status);
  revalidatePath("/admin/reportes");
}

/**
 * Valida un conjunto de URLs ingresadas por la comunidad. Las vacías quedan en
 * null; las que tienen valor deben ser http(s) válidas (ver `safeHttpUrl`). Si
 * alguna es inválida devuelve un error apuntando al campo, para que el usuario
 * lo corrija en vez de guardar basura o un esquema peligroso.
 */
function validateUrls(
  fields: [value: string | null | undefined, label: string][],
):
  | { ok: true; values: (string | null)[] }
  | { ok: false; error: string } {
  const values: (string | null)[] = [];
  for (const [value, label] of fields) {
    const raw = value?.trim();
    if (!raw) {
      values.push(null);
      continue;
    }
    const safe = safeHttpUrl(raw);
    if (!safe) {
      return {
        ok: false,
        error: `El enlace de ${label} no es válido. Usá una dirección web (https://…).`,
      };
    }
    values.push(safe);
  }
  return { ok: true, values };
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

  const rl = await enforceRateLimit("submitStore", RL.submitStore);
  if (!rl.ok) return { ok: false as const, error: rl.error };

  const urls = validateUrls([
    [input.website, "sitio web"],
    [input.social, "red social"],
  ]);
  if (!urls.ok) return { ok: false as const, error: urls.error };
  input.website = urls.values[0];
  input.social = urls.values[1];

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
  const rl = await enforceRateLimit("submitIndie", RL.submitIndie);
  if (!rl.ok) return { ok: false as const, error: rl.error };

  const urls = validateUrls([
    [input.coverUrl, "portada"],
    [input.buyUrl, "compra"],
    [input.social, "red social"],
  ]);
  if (!urls.ok) return { ok: false as const, error: urls.error };
  input.coverUrl = urls.values[0];
  input.buyUrl = urls.values[1];
  input.social = urls.values[2];

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

// Invalida la caché de ediciones de las series afectadas, para que el cambio de
// mapeo se vea en la ficha (si no, la card sigue saliendo desde la caché).
async function flushEditionCaches(
  ...ids: (number | null | undefined)[]
) {
  for (const id of new Set(ids)) if (id) await invalidateEditionsCache(id);
}

async function editionAnilistId(id: number): Promise<number | null> {
  const row = await prisma.publisherEdition.findUnique({
    where: { id },
    select: { anilistId: true },
  });
  return row?.anilistId ?? null;
}

/** Setea (o limpia con null) el anilistId de una edición del catálogo. */
export async function setEditionMappingAction(
  id: number,
  anilistId: number | null,
) {
  await assertAdmin();
  const old = await editionAnilistId(id);
  await setEditionAnilistId(id, anilistId);
  await flushEditionCaches(old, anilistId);
  revalidatePath("/admin/mapeos");
}

/** Resuelve automáticamente (verificado por autor) una edición. */
export async function resolveEditionMappingAction(id: number) {
  await assertAdmin();
  const row = await prisma.publisherEdition.findUnique({
    where: { id },
    select: { publisher: true, slug: true, title: true, anilistId: true },
  });
  if (row) {
    const anilistId = await resolveEditionSeries(row).catch(() => null);
    await setEditionAnilistId(id, anilistId);
    await flushEditionCaches(row.anilistId, anilistId);
  }
  revalidatePath("/admin/mapeos");
}

/** Edición manual de los campos de una entrada del catálogo. */
export async function updateEditionAction(
  id: number,
  data: { title?: string; url?: string; volumes?: number; anilistId?: number | null },
) {
  await assertAdmin();
  const old = await editionAnilistId(id);
  await updatePublisherEditionFields(id, data);
  await flushEditionCaches(old, data.anilistId);
  revalidatePath("/admin/mapeos");
}

/** Borra una entrada del catálogo (p. ej. una entrada fantasma de Panini). */
export async function deleteEditionAction(id: number) {
  await assertAdmin();
  const old = await editionAnilistId(id);
  await deletePublisherEdition(id);
  await flushEditionCaches(old);
  revalidatePath("/admin/mapeos");
}

/** Marca/desmarca una edición como solo-nacional (sin equivalente en AniList). */
export async function setEditionNationalOnlyAction(id: number, value: boolean) {
  await assertAdmin();
  await setEditionNationalOnly(id, value);
  revalidatePath("/admin/mapeos");
  revalidatePath("/admin/herramientas");
}

/** Acción en lote sobre varias entradas seleccionadas en /admin/mapeos. */
export async function bulkEditionAction(
  ids: number[],
  op: "delete" | "national" | "unnational",
) {
  await assertAdmin();
  const unique = [...new Set(ids)].filter((n) => Number.isInteger(n));
  if (!unique.length) return { changed: 0 };

  if (op === "delete") {
    const rows = await prisma.publisherEdition.findMany({
      where: { id: { in: unique } },
      select: { anilistId: true },
    });
    await rejectEditions(unique); // que el crawl no las re-importe
    await prisma.publisherEdition.deleteMany({ where: { id: { in: unique } } });
    await flushEditionCaches(...rows.map((r) => r.anilistId));
    // Limpiamos works que quedaron sin ediciones.
    await prisma.work.deleteMany({ where: { editions: { none: {} } } });
  } else {
    await prisma.publisherEdition.updateMany({
      where: { id: { in: unique } },
      data: { nationalOnly: op === "national" },
    });
  }
  revalidatePath("/admin/mapeos");
  revalidatePath("/admin/herramientas");
  return { changed: unique.length };
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

/** Admin: importa una edición puntual desde una URL de Whakoom. */
export async function importWhakoomUrlAction(url: string) {
  await assertAdmin();
  const res = await importWhakoomUrl(url.trim());
  if (res.ok) {
    revalidatePath("/admin/herramientas");
    revalidatePath("/admin/mapeos");
    if (res.anilistId) revalidatePath(`/manga/${res.anilistId}`);
  }
  return res;
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
  revalidatePath(seriesHref(anilistId));
}

/**
 * Admin: agrega (o actualiza) una edición de editorial para esta serie, mapeada
 * directo al anilistId. Para resolver a mano series que no trae el catálogo.
 */
export async function addSeriesEditionAction(
  anilistId: number,
  title: string,
  publisher: string,
  url: string,
  volumes: number,
) {
  await assertAdmin();
  if (!EDITORIALS.some((e) => e.publisher === publisher))
    return { ok: false as const, error: "Editorial inválida." };

  // Slug a partir del título. "Agregar" SIEMPRE crea una card nueva: si el slug
  // ya existe (misma o distinta serie, ej. Battle Royale + Deluxe, o Citrus vs
  // Citrus+), lo desambiguamos con un sufijo numérico hasta que sea único.
  const base = slugifyTitle(title);
  let slug = base;
  for (let n = 2; ; n++) {
    const taken = await prisma.publisherEdition.findUnique({
      where: { publisher_slug: { publisher, slug } },
      select: { id: true },
    });
    if (!taken) break;
    slug = `${base}-${n}`;
  }

  await upsertPublisherEdition({
    publisher,
    slug,
    title,
    volumes: Number.isFinite(volumes) && volumes > 0 ? volumes : 0,
    status: "EN CATÁLOGO",
    url: url.trim(),
  });
  await prisma.publisherEdition.updateMany({
    where: { publisher, slug },
    data: { anilistId },
  });
  // Si esta editorial estaba desvinculada de la serie, agregarla a mano implica
  // que ahora SÍ la querés: quitamos la exclusión (si no, la card no aparecería
  // en las ediciones públicas aunque la agregues una y otra vez).
  await prisma.editionExclusion
    .deleteMany({ where: { anilistId, publisher } })
    .catch(() => {});
  await invalidateEditionsCache(anilistId);
  revalidatePath(seriesHref(anilistId));
  revalidatePath("/admin/mapeos");
  return { ok: true as const };
}

/**
 * Admin (panel de serie): edita UNA card de edición (título/tomos/URL) y refresca
 * la ficha de forma fiable, invalidando la caché con el anilistId de la serie.
 * Cada card es independiente: esto no toca al resto ni a la editorial.
 */
export async function updateSeriesEditionAction(
  anilistId: number,
  editionId: number,
  data: { title?: string; url?: string; volumes?: number },
) {
  await assertAdmin();
  await updatePublisherEditionFields(editionId, data);
  await invalidateEditionsCache(anilistId);
  revalidatePath(seriesHref(anilistId));
  revalidatePath("/admin/mapeos");
  return { ok: true as const };
}

/**
 * Admin (panel de serie): borra UNA card de edición y nada más. No excluye la
 * editorial (para eso está "Desvincular editorial"): si era la única card
 * auto-resoluble de esa editorial, puede volver a aparecer en un próximo update
 * del catálogo, que es justamente el comportamiento esperado.
 */
export async function deleteSeriesEditionAction(
  anilistId: number,
  editionId: number,
) {
  await assertAdmin();
  await deletePublisherEdition(editionId);
  await invalidateEditionsCache(anilistId);
  revalidatePath(seriesHref(anilistId));
  revalidatePath("/admin/mapeos");
  return { ok: true as const };
}

/**
 * Admin: edita los campos de display de una obra del catálogo local (título,
 * autor, sinopsis, portada). Para "editar todo" desde /nacional sin depender de
 * la ficha en vivo de la editorial. Si está mapeada, invalida su caché.
 */
export async function updateWorkAction(
  workId: number,
  data: {
    title?: string;
    author?: string | null;
    synopsis?: string | null;
    coverImage?: string | null;
    genres?: string[];
    upcoming?: boolean;
    releaseLabel?: string | null; // "YYYY" o "YYYY-MM"; "" para limpiar
  },
) {
  await assertAdmin();
  const patch: {
    title?: string;
    normTitle?: string;
    author?: string | null;
    synopsis?: string | null;
    coverImage?: string | null;
    genres?: string[];
    upcoming?: boolean;
    releaseLabel?: string | null;
  } = {};
  if (data.title !== undefined && data.title.trim()) {
    patch.title = data.title.trim();
    patch.normTitle = normalizeTitle(data.title);
  }
  if (data.author !== undefined) patch.author = data.author?.trim() || null;
  if (data.synopsis !== undefined) patch.synopsis = data.synopsis?.trim() || null;
  if (data.coverImage !== undefined)
    patch.coverImage = data.coverImage?.trim() || null;
  if (data.genres !== undefined)
    patch.genres = data.genres.map((g) => g.trim()).filter(Boolean);
  if (data.upcoming !== undefined) patch.upcoming = data.upcoming;
  if (data.releaseLabel !== undefined)
    patch.releaseLabel = normalizeReleaseLabel(data.releaseLabel);

  const work = await prisma.work.update({
    where: { id: workId },
    data: patch,
    select: { anilistId: true },
  });
  if (work.anilistId) await invalidateEditionsCache(work.anilistId);
  return { ok: true as const };
}

/**
 * Admin: marca/desmarca una serie mapeada como "próximo a salir" (preventa AR) y
 * opcionalmente fija la fecha estimada ("YYYY-MM"; "" la limpia).
 */
export async function setWorkUpcomingAction(
  anilistId: number,
  upcoming: boolean,
  releaseLabel?: string | null,
) {
  await assertAdmin();
  // Vía edición→work (el work puede tener anilistId null aunque la edición no).
  const eds = await prisma.publisherEdition.findMany({
    where: { anilistId },
    select: { workId: true },
  });
  const workIds = [
    ...new Set(eds.map((e) => e.workId).filter((x): x is number => x != null)),
  ];
  const data: { upcoming: boolean; releaseLabel?: string | null } = { upcoming };
  if (releaseLabel !== undefined)
    data.releaseLabel = normalizeReleaseLabel(releaseLabel);
  if (workIds.length)
    await prisma.work.updateMany({
      where: { id: { in: workIds } },
      data,
    });
  await invalidateEditionsCache(anilistId);
  revalidatePath(seriesHref(anilistId));
  return { ok: true as const };
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
  revalidatePath(seriesHref(anilistId));
}

/**
 * Admin: desvincula una editorial de esta serie. Borra sus ediciones mapeadas y
 * la deja en una lista de exclusión, para que la resolución en vivo NO la vuelva
 * a enganchar por título (caso típico: ids duplicados de AniList con mismo
 * nombre, donde la card aparece en la serie equivocada).
 */
export async function unlinkEditionAction(anilistId: number, publisher: string) {
  await assertAdmin();
  await prisma.editionExclusion.upsert({
    where: { anilistId_publisher: { anilistId, publisher } },
    update: {},
    create: { anilistId, publisher },
  });
  await prisma.publisherEdition.deleteMany({ where: { anilistId, publisher } });
  await invalidateEditionsCache(anilistId);
  revalidatePath(seriesHref(anilistId));
  revalidatePath("/admin/mapeos");
  return { ok: true as const };
}

/** Admin: deshace una desvinculación (vuelve a permitir esa editorial). */
export async function relinkEditionAction(anilistId: number, publisher: string) {
  await assertAdmin();
  await prisma.editionExclusion
    .delete({ where: { anilistId_publisher: { anilistId, publisher } } })
    .catch(() => {});
  await invalidateEditionsCache(anilistId);
  revalidatePath(seriesHref(anilistId));
  return { ok: true as const };
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

  // Sincronizar la colección con los cambios de la compra:
  // 1) Quitar la contribución de los tomos removidos o cuyo dato (serie/edición/
  //    número) cambió. Corre siempre; el guard interno respeta tomos cubiertos
  //    por otra compra.
  for (const it of [...res.removed, ...res.changed.map((c) => c.before)]) {
    if (it.anilistId && it.status !== "CANCELLED") {
      await removePurchaseItemFromCollection(userId, it).catch(() => {});
    }
  }
  // 2) Sumar los tomos nuevos y los cambiados (con su dato nuevo), si corresponde.
  if (input.addToCollection) {
    const toAdd = [...res.created, ...res.changed.map((c) => c.after)];
    for (const it of toAdd) {
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
  }
  revalidatePath("/collection");
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
  await requireUserId(); // solo desde el form de compras (logueado)
  const q = query.trim();
  if (q.length < 2) return [];
  // Catálogo local: una entrada POR EDICIÓN (Ivrea / VIZ), así al elegir ya
  // sabemos serie + editorial + colección. id negativo (-workId).
  if (ANILIST_OFF) return searchPurchaseEditions(q, 8);
  const raw = await searchMangaList(q, true).catch(() => []);
  return raw.slice(0, 8).map((m: any) => ({
    id: m.id as number,
    title: (m.title?.english || m.title?.romaji || m.title?.native) as string,
    coverImage: (m.coverImage?.large ?? null) as string | null,
    publisher: null as string | null,
    label: (m.title?.english || m.title?.romaji || m.title?.native) as string,
    intl: false,
  }));
}

export async function deletePurchaseAction(id: number) {
  const userId = await requireUserId();
  const items = await deletePurchase(userId, id);
  // Quita de la colección los tomos de esta compra (los cancelados nunca se
  // sumaron). El guard interno respeta tomos cubiertos por otra compra.
  for (const it of items) {
    if (it.anilistId && it.status !== "CANCELLED") {
      await removePurchaseItemFromCollection(userId, it).catch(() => {});
    }
  }
  revalidatePath("/collection");
  revalidatePath("/compras");
}

/** Web Push: guarda la suscripción del navegador del usuario. */
export async function subscribePushAction(sub: WebPushSub) {
  const userId = await requireUserId();
  await saveSubscription(userId, sub);
  return { ok: true as const };
}

export async function unsubscribePushAction(endpoint: string) {
  const userId = await requireUserId();
  await deleteSubscription(userId, endpoint);
  return { ok: true as const };
}

/** Manda un push de prueba al propio usuario (para validar permisos). */
export async function testPushAction() {
  const userId = await requireUserId();
  await sendPushToUser(userId, {
    title: "Nakama",
    body: "✅ Las notificaciones push están activadas.",
    url: "/notificaciones",
  });
  return { ok: true as const };
}

/** Preferencias de notificación: activa/desactiva una categoría. */
const NOTIF_CATEGORIES = ["newVolume", "reissue", "wishlist", "social", "friends"];

export async function setNotifPrefAction(key: string, value: boolean) {
  const userId = await requireUserId();
  if (!NOTIF_CATEGORIES.includes(key)) return;
  await setNotifPref(userId, key as NotifCategory, value);
  revalidatePath("/ajustes");
}

export async function deleteNotificationAction(id: number) {
  const userId = await requireUserId();
  await deleteNotification(userId, id);
  revalidatePath("/notificaciones");
}

export async function deleteAllNotificationsAction() {
  const userId = await requireUserId();
  await deleteAllNotifications(userId);
  revalidatePath("/notificaciones");
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
  revalidatePath(seriesHref(item.anilistId));
}

export async function removeWishAction(anilistId: number) {
  const userId = await requireUserId();
  await removeWish(userId, anilistId);
  revalidatePath("/deseados");
  revalidatePath(seriesHref(anilistId));
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
  revalidatePath(seriesHref(anilistId));
}

// --- Social (amigos / actividad) ---

export async function sendFriendRequestAction(_prev: unknown, formData: FormData) {
  const userId = await requireUserId();
  const email = ((formData.get("email") as string | null) ?? "").trim();
  if (!email) return { ok: false as const, error: "Ingresá un email." };
  const rl = await enforceRateLimit("friendRequest", RL.friendRequest);
  if (!rl.ok) return { ok: false as const, error: rl.error };
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
  // Anti-spam: si se pasó del límite, se descarta en silencio (la UI no espera
  // resultado). Evita inundar el feed de un amigo con comentarios.
  const rl = await enforceRateLimit("comment", RL.comment);
  if (!rl.ok) return;
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

  const rl = await enforceRateLimit("importCsv", RL.importCsv);
  if (!rl.ok) return { ok: false as const, error: rl.error };

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
