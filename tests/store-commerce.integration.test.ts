/**
 * Integración de Retail — Store Commerce (Slice 1 endurecida) contra Postgres REAL desechable (harness
 * efímero; skip sin `IDENTITY_TEST_DATABASE_URL`). Prueba lo que los dobles no pueden: creación atómica
 * de perfil+OWNER, los invariantes de OWNER bajo transacción + lock (incluida concurrencia real), y la
 * autorización central por ID estable con `userId` explícito (sin `auth()`).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapStoreCommerce, addMember, removeMember, listMembers, updateCommerceData } from "@/lib/storeCommerce";
import { authorizeStoreAccess } from "@/lib/storeAccess";
import { DEFAULT_CHECKOUT_MODE } from "@/lib/domain/retail/checkout";
import { STORE_ROLE, STORE_AUTH_ERROR, StoreAuthError } from "@/lib/domain/store/authorize";
import { STORE_MEMBERSHIP_ERROR, StoreMembershipError } from "@/lib/domain/store/membership";

const URL = process.env.IDENTITY_TEST_DATABASE_URL;

describe.skipIf(!URL)("integración — Store Commerce (Slice 1, base real)", () => {
  const prisma = new PrismaClient({ datasourceUrl: URL });
  let seq = 0;
  const uniq = () => `sc-${Date.now()}-${seq++}`;

  const user = async () => (await prisma.user.create({ data: { email: `${uniq()}@t.dev` }, select: { id: true } })).id;
  const store = async () => (await prisma.store.create({ data: { name: uniq() }, select: { id: true } })).id;

  async function membershipErr(fn: () => Promise<unknown>): Promise<string> {
    try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof StoreMembershipError ? e.code : `OTHER:${(e as Error).message}`; }
  }
  async function authErr(fn: () => Promise<unknown>): Promise<string> {
    try { await fn(); return "NO_THROW"; } catch (e) { return e instanceof StoreAuthError ? e.code : `OTHER:${(e as Error).message}`; }
  }

  beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
  afterEach(async () => {
    await prisma.storeMember.deleteMany({});
    await prisma.storeCommerceProfile.deleteMany({});
    await prisma.store.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: "@t.dev" } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  // --- bootstrap atómico + política ---
  it("bootstrap (admin global) crea perfil + OWNER en una transacción", async () => {
    const owner = await user();
    const p = await bootstrapStoreCommerce({ storeId: await store(), slug: uniq(), ownerUserId: owner, isGlobalAdmin: true }, prisma);
    const members = await listMembers(p.id, prisma);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: owner, role: "OWNER" });
  });

  it("bootstrap rechazado para usuario NO admin → BOOTSTRAP_FORBIDDEN, sin crear nada", async () => {
    const storeId = await store();
    expect(await membershipErr(() => bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: "x", isGlobalAdmin: false }, prisma))).toBe(
      STORE_MEMBERSHIP_ERROR.BOOTSTRAP_FORBIDDEN,
    );
    expect(await prisma.storeCommerceProfile.count({ where: { storeId } })).toBe(0);
  });

  // --- configuración comercial (Slice P0): datos de contacto/pago + default de checkoutMode ---
  it("bootstrap deja checkoutMode en CONVERSATIONAL (default); updateCommerceData round-trip sin tocar enabled/slug/checkoutMode", async () => {
    const owner = await user();
    const slug = uniq();
    await bootstrapStoreCommerce({ storeId: await store(), slug, ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);
    const before = await prisma.storeCommerceProfile.findUnique({ where: { slug }, select: { checkoutMode: true } });
    expect(before?.checkoutMode).toBe(DEFAULT_CHECKOUT_MODE); // CONVERSATIONAL

    await updateCommerceData(
      slug,
      {
        whatsapp: " +54 9 11 5555 5555 ",
        paymentAlias: " mi.alias.mp ",
        paymentInstructions: "Transferí al alias y avisá",
        pickupInstructions: "Retiro L-V",
        publicDescription: "Tienda de prueba",
      },
      prisma,
    );
    const after = await prisma.storeCommerceProfile.findUnique({ where: { slug } });
    expect(after).toMatchObject({
      slug,
      enabled: true,
      checkoutMode: DEFAULT_CHECKOUT_MODE,
      whatsapp: "+54 9 11 5555 5555", // clean() recorta
      paymentAlias: "mi.alias.mp",
      paymentInstructions: "Transferí al alias y avisá",
      pickupInstructions: "Retiro L-V",
      publicDescription: "Tienda de prueba",
    });

    // vaciar un campo lo deja en null (clean); no afecta a los demás
    await updateCommerceData(slug, { paymentAlias: "   " }, prisma);
    const cleared = await prisma.storeCommerceProfile.findUnique({ where: { slug } });
    expect(cleared?.paymentAlias).toBeNull();
    expect(cleared?.paymentInstructions).toBe("Transferí al alias y avisá");
  });

  // --- autorización central por ID estable (sin auth(), userId explícito) ---
  it("autorización por storeId: OWNER autorizado; externo → NOT_A_MEMBER; inexistente → PROFILE_NOT_FOUND", async () => {
    const owner = await user();
    const outsider = await user();
    const storeId = await store();
    const p = await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: true }, prisma);

    const ok = await authorizeStoreAccess(prisma, { storeId }, owner);
    expect(ok.role).toBe("OWNER");
    expect(ok.profileRow.id).toBe(p.id);
    expect(await authErr(() => authorizeStoreAccess(prisma, { storeId }, outsider))).toBe(STORE_AUTH_ERROR.NOT_A_MEMBER);
    expect(await authErr(() => authorizeStoreAccess(prisma, { storeId: 9999999 }, owner))).toBe(STORE_AUTH_ERROR.PROFILE_NOT_FOUND);
    expect(await authErr(() => authorizeStoreAccess(prisma, { slug: "no-existe" }, owner))).toBe(STORE_AUTH_ERROR.PROFILE_NOT_FOUND);
  });

  it("autorización: perfil deshabilitado + requireEnabled → STORE_DISABLED; sin requireEnabled → OK", async () => {
    const owner = await user();
    const storeId = await store();
    await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true, enabled: false }, prisma);
    expect(await authErr(() => authorizeStoreAccess(prisma, { storeId }, owner, { requireEnabled: true }))).toBe(STORE_AUTH_ERROR.STORE_DISABLED);
    expect((await authorizeStoreAccess(prisma, { storeId }, owner, { requireEnabled: false })).role).toBe("OWNER");
  });

  it("STAFF no puede administrar miembros (allowedRoles: [OWNER]) → FORBIDDEN_ROLE", async () => {
    const owner = await user();
    const staff = await user();
    const storeId = await store();
    const p = await bootstrapStoreCommerce({ storeId, slug: uniq(), ownerUserId: owner, isGlobalAdmin: true }, prisma);
    await addMember(p.id, staff, STORE_ROLE.STAFF, prisma);
    expect(await authErr(() => authorizeStoreAccess(prisma, { storeId }, staff, { allowedRoles: [STORE_ROLE.OWNER] }))).toBe(
      STORE_AUTH_ERROR.FORBIDDEN_ROLE,
    );
  });

  // --- invariantes de OWNER ---
  it("no se puede quitar al ÚLTIMO OWNER → LAST_OWNER (sigue habiendo OWNER)", async () => {
    const owner = await user();
    const p = await bootstrapStoreCommerce({ storeId: await store(), slug: uniq(), ownerUserId: owner, isGlobalAdmin: true }, prisma);
    expect(await membershipErr(() => removeMember(p.id, owner, prisma))).toBe(STORE_MEMBERSHIP_ERROR.LAST_OWNER);
    expect(await prisma.storeMember.count({ where: { profileId: p.id, role: "OWNER" } })).toBe(1);
  });

  it("no se puede degradar al ÚLTIMO OWNER a STAFF → LAST_OWNER", async () => {
    const owner = await user();
    const p = await bootstrapStoreCommerce({ storeId: await store(), slug: uniq(), ownerUserId: owner, isGlobalAdmin: true }, prisma);
    expect(await membershipErr(() => addMember(p.id, owner, STORE_ROLE.STAFF, prisma))).toBe(STORE_MEMBERSHIP_ERROR.LAST_OWNER);
    expect((await prisma.storeMember.findFirst({ where: { profileId: p.id, userId: owner } }))?.role).toBe("OWNER");
  });

  it("un OWNER puede quitarse a sí mismo si queda OTRO OWNER", async () => {
    const owner1 = await user();
    const owner2 = await user();
    const p = await bootstrapStoreCommerce({ storeId: await store(), slug: uniq(), ownerUserId: owner1, isGlobalAdmin: true }, prisma);
    await addMember(p.id, owner2, STORE_ROLE.OWNER, prisma);
    await removeMember(p.id, owner1, prisma); // OK: queda owner2
    const owners = await prisma.storeMember.findMany({ where: { profileId: p.id, role: "OWNER" }, select: { userId: true } });
    expect(owners).toEqual([{ userId: owner2 }]);
  });

  it("agregar dos veces al mismo usuario es idempotente (1 fila)", async () => {
    const owner = await user();
    const staff = await user();
    const p = await bootstrapStoreCommerce({ storeId: await store(), slug: uniq(), ownerUserId: owner, isGlobalAdmin: true }, prisma);
    await addMember(p.id, staff, STORE_ROLE.STAFF, prisma);
    await addMember(p.id, staff, STORE_ROLE.STAFF, prisma);
    expect(await prisma.storeMember.count({ where: { profileId: p.id, userId: staff } })).toBe(1);
  });

  it("concurrencia: dos remociones simultáneas de owners distintos → exactamente una gana, queda ≥1 OWNER", async () => {
    const owner1 = await user();
    const owner2 = await user();
    const p = await bootstrapStoreCommerce({ storeId: await store(), slug: uniq(), ownerUserId: owner1, isGlobalAdmin: true }, prisma);
    await addMember(p.id, owner2, STORE_ROLE.OWNER, prisma); // 2 owners
    const [r1, r2] = await Promise.allSettled([removeMember(p.id, owner1, prisma), removeMember(p.id, owner2, prisma)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(["fulfilled", "rejected"]); // una gana, otra LAST_OWNER
    const rejected = (r1.status === "rejected" ? r1 : r2) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(StoreMembershipError);
    expect(await prisma.storeMember.count({ where: { profileId: p.id, role: "OWNER" } })).toBe(1); // nunca queda sin OWNER
  });
});
