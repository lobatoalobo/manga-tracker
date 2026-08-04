import { describe, it, expect } from "vitest";
import { retailPreviewEnabled } from "@/app/(retail-preview)/gate";

// Gate de la preview del UI Kit (Fase 0 · C1). Evidencia determinística de que la
// ruta /kit solo se habilita con el valor EXPLÍCITO RETAIL_PREVIEW_ENABLED="true".
describe("retailPreviewEnabled", () => {
  it("HABILITA solo con el valor exacto 'true'", () => {
    expect(retailPreviewEnabled({ RETAIL_PREVIEW_ENABLED: "true" })).toBe(true);
  });

  it("DESHABILITA si la variable no está definida", () => {
    expect(retailPreviewEnabled({})).toBe(false);
  });

  it("DESHABILITA con cualquier otro valor (no acopla 'producción' con 'no previsualizable')", () => {
    expect(retailPreviewEnabled({ RETAIL_PREVIEW_ENABLED: "1" })).toBe(false);
    expect(retailPreviewEnabled({ RETAIL_PREVIEW_ENABLED: "TRUE" })).toBe(false);
    expect(retailPreviewEnabled({ RETAIL_PREVIEW_ENABLED: "false" })).toBe(false);
    expect(retailPreviewEnabled({ RETAIL_PREVIEW_ENABLED: "" })).toBe(false);
  });
});
