/**
 * Infra de Retail — servicio comercial de tiendas (Slice 1, endurecida). CRUD mínimo del perfil comercial
 * y sus miembros, con los INVARIANTES de OWNER aplicados bajo transacción + lock. SIN preventas.
 *
 * Política (§4): el **bootstrap** (crear perfil + OWNER inicial + habilitar) es de administrador GLOBAL y
 * ocurre en UNA transacción. La administración posterior (agregar/quitar/rol de miembros) es de OWNER/STAFF
 * vía `requireStoreMember*` (NUNCA `isAdmin`). Este módulo asume que el caller YA autorizó; acá solo se
 * protegen los invariantes de datos (≥1 OWNER) que ninguna autorización de rol garantiza.
 */
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { STORE_ROLE, type StoreRole } from "@/lib/domain/store/authorize";
import { assertBootstrapAllowed, assertKeepsOwner } from "@/lib/domain/store/membership";

type Client = PrismaClient;

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export interface BootstrapStoreCommerceInput {
  storeId: number;
  slug: string;
  /** OWNER inicial (obligatorio: un perfil nunca nace sin OWNER). */
  ownerUserId: string;
  /** El caller calcula esto (p. ej. `isAdmin(session.email)`); el dominio exige que sea true. */
  isGlobalAdmin: boolean;
  enabled?: boolean;
  whatsapp?: string | null;
  paymentAlias?: string | null;
  paymentInstructions?: string | null;
  pickupInstructions?: string | null;
  publicDescription?: string | null;
}

/**
 * BOOTSTRAP (admin global): crea el perfil comercial y su OWNER inicial en UNA transacción, así el
 * invariante "todo perfil tiene ≥1 OWNER" se cumple desde el nacimiento (nunca hay un perfil sin OWNER).
 */
export async function bootstrapStoreCommerce(input: BootstrapStoreCommerceInput, client: Client = prisma) {
  assertBootstrapAllowed(input.isGlobalAdmin);
  return client.$transaction(async (tx) => {
    const profile = await tx.storeCommerceProfile.create({
      data: {
        storeId: input.storeId,
        slug: input.slug.trim(),
        enabled: input.enabled ?? false,
        whatsapp: clean(input.whatsapp),
        paymentAlias: clean(input.paymentAlias),
        paymentInstructions: clean(input.paymentInstructions),
        pickupInstructions: clean(input.pickupInstructions),
        publicDescription: clean(input.publicDescription),
      },
    });
    await tx.storeMember.create({
      data: { profileId: profile.id, userId: input.ownerUserId, role: STORE_ROLE.OWNER },
    });
    return profile;
  });
}

export function getCommerceProfileBySlug(slug: string, client: Client = prisma) {
  return client.storeCommerceProfile.findUnique({ where: { slug }, include: { store: true } });
}

/** Activa/desactiva la operación comercial (pausable sin perder miembros ni datos). */
export function setCommerceEnabled(slug: string, enabled: boolean, client: Client = prisma) {
  return client.storeCommerceProfile.update({ where: { slug }, data: { enabled } });
}

export type CommerceDataInput = Partial<
  Pick<
    BootstrapStoreCommerceInput,
    "whatsapp" | "paymentAlias" | "paymentInstructions" | "pickupInstructions" | "publicDescription"
  >
>;

/** Actualiza los datos comerciales (pago/retiro/WA/descripción). No toca `enabled` ni el slug. */
export function updateCommerceData(slug: string, data: CommerceDataInput, client: Client = prisma) {
  return client.storeCommerceProfile.update({
    where: { slug },
    data: {
      ...(data.whatsapp !== undefined ? { whatsapp: clean(data.whatsapp) } : {}),
      ...(data.paymentAlias !== undefined ? { paymentAlias: clean(data.paymentAlias) } : {}),
      ...(data.paymentInstructions !== undefined ? { paymentInstructions: clean(data.paymentInstructions) } : {}),
      ...(data.pickupInstructions !== undefined ? { pickupInstructions: clean(data.pickupInstructions) } : {}),
      ...(data.publicDescription !== undefined ? { publicDescription: clean(data.publicDescription) } : {}),
    },
  });
}

/** Padrón de OWNERs del perfil, BLOQUEADO (`FOR UPDATE`) para serializar operaciones de rol concurrentes. */
async function lockOwnerUserIds(tx: Pick<PrismaClient, "$queryRaw">, profileId: number): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "StoreMember" WHERE "profileId" = ${profileId} AND "role" = 'OWNER' FOR UPDATE`;
  return rows.map((r) => r.userId);
}

/**
 * Agrega un miembro o ajusta su rol. Idempotente por `(profileId, userId)`. Bajo transacción + lock del
 * padrón OWNER: **degradar al último OWNER a STAFF se rechaza** (`LAST_OWNER`). Agregar/promover es seguro.
 */
export async function addMember(
  profileId: number,
  userId: string,
  role: StoreRole = STORE_ROLE.STAFF,
  client: Client = prisma,
) {
  return client.$transaction(async (tx) => {
    const owners = await lockOwnerUserIds(tx, profileId);
    // Si el rol nuevo no es OWNER, la operación podría quitar a `userId` del padrón OWNER → validar.
    if (role !== STORE_ROLE.OWNER) assertKeepsOwner(owners, { userId, next: role });
    return tx.storeMember.upsert({
      where: { profileId_userId: { profileId, userId } },
      update: { role },
      create: { profileId, userId, role },
    });
  });
}

/**
 * Quita un miembro. Bajo transacción + lock del padrón OWNER: **quitar al último OWNER se rechaza**
 * (`LAST_OWNER`). Un OWNER puede quitarse a sí mismo solo si queda otro OWNER.
 */
export async function removeMember(profileId: number, userId: string, client: Client = prisma) {
  await client.$transaction(async (tx) => {
    const owners = await lockOwnerUserIds(tx, profileId);
    assertKeepsOwner(owners, { userId, next: "REMOVE" });
    await tx.storeMember.deleteMany({ where: { profileId, userId } });
  });
}

/** Lista los miembros de una tienda (con datos mínimos del usuario para mostrarlos). */
export function listMembers(profileId: number, client: Client = prisma) {
  return client.storeMember.findMany({
    where: { profileId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, email: true, image: true } },
    },
  });
}
