/**
 * Seed de DESARROLLO (idempotente) para habilitar la primera tienda comercial piloto (Crumb).
 * NO crea datos de producción ni hardcodea al dueño: el email del OWNER se pasa por argumento.
 *
 *   node scripts/with-staging.mjs npx tsx scripts/seed-crumb-commerce.ts --owner <email> \
 *        [--store "Espacio Crumb"] [--slug crumb] [--enable]
 *
 * Requiere que el usuario OWNER exista (se logueó al menos una vez). La `Store` se busca por nombre
 * (contains, case-insensitive) o se crea. El perfil comercial y la membresía OWNER son upserts.
 */
import { prisma } from "../lib/prisma";
import { createStore } from "../lib/stores";
import { STORE_ROLE } from "../lib/domain/store/authorize";
import { bootstrapStoreCommerce, addMember, setCommerceEnabled } from "../lib/storeCommerce";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const ownerEmail = arg("--owner");
  const storeName = arg("--store") ?? "Espacio Crumb";
  const slug = arg("--slug") ?? "crumb";
  const enable = process.argv.includes("--enable");

  if (!ownerEmail) {
    console.error("Falta --owner <email> (dueño de la tienda). No se hardcodea.");
    process.exit(1);
  }

  const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (!owner) {
    console.error(`No existe un usuario con email ${ownerEmail} (debe haberse logueado al menos una vez).`);
    process.exit(1);
  }

  // 1. Store (identidad durable): buscar por nombre o crear.
  let store = await prisma.store.findFirst({
    where: { name: { contains: storeName, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!store) {
    await createStore({ name: storeName, province: "Buenos Aires", city: "La Plata" }, { status: "APPROVED" });
    store = await prisma.store.findFirst({ where: { name: storeName }, select: { id: true, name: true } });
    console.log(`+ Store creada: ${store?.name} (#${store?.id})`);
  } else {
    console.log(`= Store existente: ${store.name} (#${store.id})`);
  }
  if (!store) throw new Error("no se pudo resolver la Store");

  // 2-3. Perfil comercial + OWNER inicial. El dominio exige que el bootstrap sea de admin global y crea
  // perfil + OWNER en una transacción. El seed ES la herramienta de admin de dev → isGlobalAdmin: true.
  // Idempotente: si el perfil ya existe, aseguramos el OWNER (y el enable) sin re-bootstrapear.
  const existing = await prisma.storeCommerceProfile.findUnique({ where: { storeId: store.id }, select: { id: true, slug: true, enabled: true } });
  let profile = existing;
  if (!existing) {
    const created = await bootstrapStoreCommerce({ storeId: store.id, slug, ownerUserId: owner.id, isGlobalAdmin: true, enabled: enable });
    profile = { id: created.id, slug: created.slug, enabled: created.enabled };
  } else {
    await addMember(existing.id, owner.id, STORE_ROLE.OWNER); // asegura OWNER (idempotente)
    if (enable && !existing.enabled) await setCommerceEnabled(existing.slug, true);
  }
  console.log(`= Perfil comercial: slug=${profile!.slug} (#${profile!.id})`);
  console.log(`= OWNER: ${ownerEmail}`);
  console.log(`\nListo. Admin en /tiendas/${slug}/admin`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
