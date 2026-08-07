import { describe, it, expect } from "vitest";
import { reviewRowsFromCsv, reviewRowsFromMessage, reviewRowsFromSheet, reviewRowToManual, studioSummary, previewFromState } from "@/components/store-preventas/studio/format";
import type { StudioState } from "@/lib/retail/studio";

describe("studio/format · CSV → filas de revisión", () => {
  const csv = `editorial,titulo,volumen,precio lista,precio preventa,descuento,reimpresion
IVREA,One Piece,109,12000,11000,10,no
IVREA,Call of the Night,1,,,,si`;
  const rows = reviewRowsFromCsv(csv);

  it("mapea columnas por encabezado tolerante", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "One Piece", volumeNumber: "109", publisher: "IVREA", listPesos: "12000", preorderPesos: "11000", isReprint: false, needsReview: false });
  });

  it("una reimpresión sin precio NO necesita revisión", () => {
    expect(rows[1]).toMatchObject({ title: "Call of the Night", isReprint: true, needsReview: false });
  });

  it("reviewRowToManual convierte pesos → centavos", () => {
    expect(reviewRowToManual(rows[0])).toEqual({ title: "One Piece", volumeNumber: 109, publisher: "IVREA", isbn: null, listPriceCents: 1_200_000, preorderPriceCents: 1_100_000, isReprint: false, publisherDiscountPct: 10 });
  });
});

describe("studio/format · Excel (matriz) → filas de revisión", () => {
  it("mapea una hoja con números y saltea filas vacías", () => {
    const matrix: (string | number | null)[][] = [
      ["Editorial", "Título", "Volumen", "Precio lista", "Precio preventa", "Descuento", "Reimpresión"],
      ["IVREA", "One Piece", 109, 12000, 11000, 10, "no"],
      [null, null, null, null, null, null, null],
      ["PLANETA", "Nausicaä", 6, 36900, 36900, null, "no"],
    ];
    const rows = reviewRowsFromSheet(matrix);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "One Piece", volumeNumber: "109", listPesos: "12000", preorderPesos: "11000", discountPct: "10" });
    expect(rows[1]).toMatchObject({ title: "Nausicaä", volumeNumber: "6", preorderPesos: "36900" });
  });
});

describe("studio/format · TXT reusa el parser de mensaje", () => {
  it("produce filas desde texto libre", () => {
    const rows = reviewRowsFromMessage("IVREA 10% DE DESC. CRUMB\nONE PIECE 109 $11000");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "ONE PIECE", volumeNumber: "109", preorderPesos: "11000", discountPct: "10" });
  });
});

describe("studio/format · resumen y vista previa desde el estado", () => {
  const state: StudioState = {
    campaignId: 1,
    title: "Novedades",
    opensAt: new Date(2026, 7, 7, 10, 0).toISOString(),
    closesAt: new Date(2026, 7, 10, 15, 0).toISOString(),
    description: "",
    status: "DRAFT",
    offers: [
      { id: 1, title: "ONE PIECE", volumeNumber: 109, publisher: "IVREA", isbn: null, volumeId: null, listPriceCents: 1_200_000, preorderPriceCents: 1_100_000, status: "ACTIVE", sortOrder: 0, isReprint: false, publisherDiscountPct: 10 },
      { id: 2, title: "CALL OF THE NIGHT", volumeNumber: 1, publisher: "IVREA", isbn: null, volumeId: null, listPriceCents: 1_100_000, preorderPriceCents: 1_100_000, status: "ACTIVE", sortOrder: 1, isReprint: true, publisherDiscountPct: 10 },
      { id: 3, title: "PAUSADA", volumeNumber: 1, publisher: "PLANETA", isbn: null, volumeId: null, listPriceCents: 500_000, preorderPriceCents: 500_000, status: "HIDDEN", sortOrder: 2, isReprint: false, publisherDiscountPct: null },
    ],
  };

  it("resumen cuenta solo ofertas ACTIVAS", () => {
    expect(studioSummary(state)).toEqual({ tomos: 2, editoriales: 1, precioDesdeCents: 1_100_000 });
  });

  it("vista previa agrupa por editorial, separa reimpresiones y omite las pausadas", () => {
    const msg = previewFromState(state);
    expect(msg).toContain("IVREA 10% DE DESC. CRUMB\nONE PIECE 109 $11000");
    expect(msg).toContain("REIMPRESIONES:\nCALL OF THE NIGHT 1");
    expect(msg).not.toContain("PAUSADA");
    expect(msg).toMatch(/A LAS 15 HS\./);
  });
});
