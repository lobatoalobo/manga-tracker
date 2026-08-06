import { describe, it, expect } from "vitest";
import { parsePreorderMessage } from "@/lib/domain/retail/message-parser";

const MSG = `IVREA 10% DE DESC. CRUMB
DUNGEON ELF 02 $12000
ONE PIECE 109 $11000

PLANETA MANGA
NAUSICAÄ DEL VALLE DEL VIENTO VOL. 6 $36900

REIMPRESIONES:
CALL OF THE NIGHT 01
JUNJI ITO GYO 01`;

describe("message-parser · mensaje real de Crumb", () => {
  const { items, publishers } = parsePreorderMessage(MSG);

  it("detecta las editoriales con su descuento", () => {
    expect(publishers).toEqual([
      { name: "IVREA", discountPct: 10 },
      { name: "PLANETA MANGA", discountPct: null },
    ]);
  });

  it("produce 5 ítems (2 IVREA + 1 PLANETA + 2 reimpresiones)", () => {
    expect(items).toHaveLength(5);
  });

  it("título / volumen / precio / editorial de un ítem normal", () => {
    expect(items[0]).toMatchObject({ publisher: "IVREA", title: "DUNGEON ELF", volumeNumber: 2, priceCents: 1_200_000, isReprint: false, needsReview: false });
    expect(items[1]).toMatchObject({ title: "ONE PIECE", volumeNumber: 109, priceCents: 1_100_000, needsReview: false });
  });

  it("hereda la editorial vigente (PLANETA) y parsea 'VOL. 6'", () => {
    expect(items[2]).toMatchObject({ publisher: "PLANETA MANGA", title: "NAUSICAÄ DEL VALLE DEL VIENTO", volumeNumber: 6, priceCents: 3_690_000 });
  });

  it("las líneas bajo REIMPRESIONES son reimpresión sin precio y NO necesitan revisión", () => {
    expect(items[3]).toMatchObject({ title: "CALL OF THE NIGHT", volumeNumber: 1, priceCents: null, isReprint: true, needsReview: false });
    expect(items[4]).toMatchObject({ title: "JUNJI ITO GYO", volumeNumber: 1, isReprint: true, needsReview: false });
  });
});

describe("message-parser · casos de revisión", () => {
  it("un título normal SIN precio queda needsReview", () => {
    const { items } = parsePreorderMessage("IVREA\nMI MANGA 03");
    expect(items[0]).toMatchObject({ title: "MI MANGA", volumeNumber: 3, priceCents: null, isReprint: false, needsReview: true });
  });

  it("una línea no reconocida no se descarta: kind unrecognized + needsReview", () => {
    const { items } = parsePreorderMessage("promo especial de hoy");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "unrecognized", title: null, needsReview: true });
  });

  it("un encabezado 'a secas' (mayúsculas, sin dígitos) es editorial, no ítem", () => {
    const { items, publishers } = parsePreorderMessage("OVNI PRESS\nBERSERK 42 $15000");
    expect(publishers).toEqual([{ name: "OVNI PRESS", discountPct: null }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ publisher: "OVNI PRESS", title: "BERSERK", volumeNumber: 42, priceCents: 1_500_000 });
  });

  it("texto vacío → sin ítems ni editoriales", () => {
    expect(parsePreorderMessage("")).toEqual({ items: [], publishers: [] });
  });
});
