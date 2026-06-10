import { prisma } from "../lib/prisma";
import { createStore } from "../lib/stores";

// Base inicial de comiquerías (datos públicos; editables desde /admin/tiendas).
const STORES = [
  {
    name: "La Revistería - Recoleta",
    address: "Av. Córdoba 3017, piso 2",
    city: "Recoleta",
    province: "CABA",
    website: "https://www.larevisteriacomics.com/",
  },
  {
    name: "La Revistería - Morón",
    address: "Pres. Domingo Faustino Sarmiento 870",
    city: "Morón",
    province: "Buenos Aires",
    website: "https://www.larevisteriacomics.com/",
  },
  {
    name: "La Revistería - San Isidro",
    address: "Av. Centenario 201",
    city: "San Isidro",
    province: "Buenos Aires",
    website: "https://www.larevisteriacomics.com/",
  },
  {
    name: "Club del Cómic",
    address: "Marcelo T. de Alvear 2002",
    city: "Recoleta",
    province: "CABA",
    website: "http://www.clubdelcomic.com.ar/",
  },
  {
    name: "Meridiana Cómics",
    address: "Av. Rivadavia 4963",
    city: "Caballito",
    province: "CABA",
  },
  {
    name: "Elektra Comics",
    address: "Defensa 251",
    city: "Monserrat",
    province: "CABA",
    website: "https://www.elektracomics.com.ar/",
  },
];

async function main() {
  const existing = await prisma.store.count();
  if (existing > 0) {
    console.log(`Ya hay ${existing} tiendas; no seedeo de nuevo.`);
    return;
  }
  for (const s of STORES) {
    await createStore(s, { status: "APPROVED" });
    console.log(`✓ ${s.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
