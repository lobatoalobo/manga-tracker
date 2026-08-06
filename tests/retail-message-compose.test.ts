import { describe, it, expect } from "vitest";
import { composePreorderMessage, type ComposeOffer } from "@/lib/domain/retail/message-compose";

const OFFERS: ComposeOffer[] = [
  { title: "ONE PIECE", volumeNumber: 109, publisher: "IVREA", preorderPriceCents: 1_100_000 },
  { title: "KAGURABACHI", volumeNumber: 9, publisher: "IVREA", preorderPriceCents: 1_100_000 },
  { title: "NAUSICAÄ DEL VALLE DEL VIENTO", volumeNumber: 6, publisher: "PLANETA MANGA", preorderPriceCents: 3_690_000 },
  { title: "CALL OF THE NIGHT", volumeNumber: 1, publisher: "IVREA", preorderPriceCents: 0, isReprint: true },
];

describe("message-compose · mensaje agrupado", () => {
  const msg = composePreorderMessage(OFFERS, {
    opensAt: new Date(2026, 7, 7, 10, 0),
    closesAt: new Date(2026, 7, 10, 15, 0),
    discounts: { IVREA: 10 },
  });

  it("saludo con la fecha de apertura y aviso de cierre con la hora", () => {
    expect(msg).toMatch(/^Hola, les traemos las novedades del \w+ 7 de agosto\./);
    expect(msg).toMatch(/IMPORTANTE: HAGAN SUS PEDIDOS hasta el [A-ZÁÉÍÓÚ]+ A LAS 15 HS\./);
  });

  it("agrupa por editorial con su descuento y lista los ítems con precio", () => {
    expect(msg).toContain("IVREA 10% DE DESC. CRUMB\nONE PIECE 109 $11000\nKAGURABACHI 9 $11000");
    expect(msg).toContain("PLANETA MANGA\nNAUSICAÄ DEL VALLE DEL VIENTO 6 $36900");
  });

  it("separa las reimpresiones en su propia sección, sin precio", () => {
    expect(msg).toContain("REIMPRESIONES:\nCALL OF THE NIGHT 1");
    expect(msg).not.toContain("CALL OF THE NIGHT 1 $");
  });

  it("cierra con el saludo final", () => {
    expect(msg.endsWith("¡Gracias!")).toBe(true);
  });
});

describe("message-compose · sin metadatos", () => {
  it("saludo genérico, sin línea de cierre, editorial 'Otros' para sin editorial", () => {
    const msg = composePreorderMessage([{ title: "TOMO SUELTO", volumeNumber: null, publisher: null, preorderPriceCents: 500_000 }]);
    expect(msg.startsWith("Hola, les traemos las novedades.")).toBe(true);
    expect(msg).not.toContain("IMPORTANTE");
    expect(msg).toContain("OTROS\nTOMO SUELTO $5000");
  });
});
