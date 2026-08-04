import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  composeEdition,
  type OfferForComposition,
  type ComposeInput,
} from "@/lib/domain/retail/edition-composition";

// Fábrica de ofertas: base ACTIVE fuera de portada; cada test sobrescribe lo suyo.
let seq = 0;
function offer(over: Partial<OfferForComposition> = {}): OfferForComposition {
  const id = over.offerId ?? ++seq;
  return {
    offerId: id,
    status: "ACTIVE",
    onCover: false,
    sortOrder: 0,
    displayTitle: `Serie ${id}`,
    displayVolume: 1,
    displayPublisher: "Ivrea",
    listPriceCents: 10_000,
    preorderPriceCents: 8_000,
    ...over,
  };
}
const ids = (items: { offerId: number }[]) => items.map((i) => i.offerId);

describe("edition-composition · portada vacía", () => {
  it("sin ofertas → todos los buckets vacíos", () => {
    const c = composeEdition({ offers: [], principalOfferId: null });
    expect(c).toEqual({ principal: null, secundarias: [], resto: [], fueraDeVenta: [] });
  });

  it("ofertas activas fuera de portada + sin principal → portada vacía, todo en resto", () => {
    const c = composeEdition({ offers: [offer({ offerId: 1 }), offer({ offerId: 2 })], principalOfferId: null });
    expect(c.principal).toBeNull();
    expect(c.secundarias).toEqual([]);
    expect(ids(c.resto)).toEqual([1, 2]);
  });
});

describe("edition-composition · principal", () => {
  it("válida (ACTIVE + onCover) → principal seteada y excluida de secundarias", () => {
    const c = composeEdition({
      offers: [offer({ offerId: 1, onCover: true, sortOrder: 0 }), offer({ offerId: 2, onCover: true, sortOrder: 1 })],
      principalOfferId: 1,
    });
    expect(c.principal?.offerId).toBe(1);
    expect(ids(c.secundarias)).toEqual([2]); // la principal NO aparece en secundarias
  });

  it("inexistente (id que no está) → principal null defensivo", () => {
    const c = composeEdition({ offers: [offer({ offerId: 1, onCover: true })], principalOfferId: 999 });
    expect(c.principal).toBeNull();
    expect(ids(c.secundarias)).toEqual([1]); // la oferta sigue como secundaria
  });

  it.each(["HIDDEN", "CANCELLED"] as const)("apuntando a una oferta %s → principal null; va a fueraDeVenta", (status) => {
    const c = composeEdition({ offers: [offer({ offerId: 1, onCover: true, status })], principalOfferId: 1 });
    expect(c.principal).toBeNull();
    expect(ids(c.fueraDeVenta)).toEqual([1]);
    expect(c.secundarias).toEqual([]);
  });

  it("apuntando a una oferta fuera de portada (ACTIVE, !onCover) → principal null; va a resto", () => {
    const c = composeEdition({ offers: [offer({ offerId: 1, onCover: false })], principalOfferId: 1 });
    expect(c.principal).toBeNull();
    expect(ids(c.resto)).toEqual([1]);
    expect(c.secundarias).toEqual([]);
  });
});

describe("edition-composition · orden por bucket", () => {
  it("secundarias ordenadas por sortOrder", () => {
    const c = composeEdition({
      offers: [
        offer({ offerId: 10, onCover: true, sortOrder: 2 }),
        offer({ offerId: 11, onCover: true, sortOrder: 0 }),
        offer({ offerId: 12, onCover: true, sortOrder: 1 }),
      ],
      principalOfferId: null,
    });
    expect(ids(c.secundarias)).toEqual([11, 12, 10]);
  });

  it("resto ordenado por sortOrder", () => {
    const c = composeEdition({
      offers: [
        offer({ offerId: 10, sortOrder: 5 }),
        offer({ offerId: 11, sortOrder: 1 }),
        offer({ offerId: 12, sortOrder: 3 }),
      ],
      principalOfferId: null,
    });
    expect(ids(c.resto)).toEqual([11, 12, 10]);
  });

  it("fueraDeVenta agrupa HIDDEN y CANCELLED, ordenadas", () => {
    const c = composeEdition({
      offers: [
        offer({ offerId: 20, status: "CANCELLED", sortOrder: 2 }),
        offer({ offerId: 21, status: "HIDDEN", sortOrder: 0 }),
      ],
      principalOfferId: null,
    });
    expect(ids(c.fueraDeVenta)).toEqual([21, 20]);
  });

  it("desempate por offerId cuando el sortOrder empata", () => {
    const c = composeEdition({
      offers: [
        offer({ offerId: 30, sortOrder: 0 }),
        offer({ offerId: 28, sortOrder: 0 }),
        offer({ offerId: 29, sortOrder: 0 }),
      ],
      principalOfferId: null,
    });
    expect(ids(c.resto)).toEqual([28, 29, 30]);
  });
});

describe("edition-composition · pureza", () => {
  it("no muta la entrada (ni el array ni los objetos)", () => {
    const offers = [offer({ offerId: 2, sortOrder: 5 }), offer({ offerId: 1, sortOrder: 0 })];
    const input: ComposeInput = { offers, principalOfferId: 1 };
    const snapshot = JSON.parse(JSON.stringify(offers));
    composeEdition(input);
    expect(offers).toEqual(snapshot); // orden y contenido intactos
  });

  it("no importa react, prisma, componentes ni servicios (lib/retail)", () => {
    const src = readFileSync(fileURLToPath(new URL("../lib/domain/retail/edition-composition.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/from ["']react["']/);
    expect(src).not.toMatch(/@prisma\/client|["']\.\.?\/.*prisma/);
    expect(src).not.toMatch(/@\/components\//);
    expect(src).not.toMatch(/@\/lib\/retail\b/); // permite @/lib/domain/retail
  });
});
