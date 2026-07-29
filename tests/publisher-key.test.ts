import { describe, it, expect } from "vitest";
import { PURCHASE_PUBLISHER_KEY, publisherKey, publisherRegion } from "@/lib/publisher-key";

// Fuente única del eje de edición. El test valida el CONTRATO (editorial → key), no dos mapas paralelos:
// la escritura legada y la correspondencia importan ambos de aquí.
describe("publisherKey", () => {
  it("mapea cada editorial conocida a su key de contrato", () => {
    expect(publisherKey("Ivrea Argentina")).toBe("ivrea");
    expect(publisherKey("Panini Argentina")).toBe("panini");
    expect(publisherKey("Ovni Press")).toBe("ovni");
    expect(publisherKey("Kemuri Ediciones")).toBe("kemuri");
    expect(publisherKey("Utopía Editorial")).toBe("utopia");
    expect(publisherKey("Larp Editores")).toBe("larp");
    expect(publisherKey("Distrito Manga")).toBe("distrito");
    expect(publisherKey("Planeta Cómic")).toBe("planeta");
    expect(publisherKey("VIZ Media")).toBe("viz");
  });

  it("cae a 'ar' para editoriales fuera del mapa", () => {
    expect(publisherKey("Editorial Desconocida")).toBe("ar");
    expect(publisherKey("")).toBe("ar");
  });

  it("es coherente con el mapa exportado en toda entrada conocida", () => {
    for (const [pub, key] of Object.entries(PURCHASE_PUBLISHER_KEY)) {
      expect(publisherKey(pub)).toBe(key);
    }
  });
});

describe("publisherRegion", () => {
  it("marca VIZ como internacional", () => {
    expect(publisherRegion("VIZ Media")).toBe("INT");
    expect(publisherRegion("algo viz algo")).toBe("INT");
  });

  it("el resto es AR (incluye null/undefined)", () => {
    expect(publisherRegion("Ivrea Argentina")).toBe("AR");
    expect(publisherRegion(null)).toBe("AR");
    expect(publisherRegion(undefined)).toBe("AR");
  });
});
