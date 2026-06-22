import { describe, it, expect } from "vitest";
import { decodeEntities } from "@/lib/decodeEntities";

describe("decodeEntities", () => {
  it("decodifica &quot; (caso I&quot;s)", () => {
    expect(decodeEntities("I&quot;s")).toBe('I"s');
    expect(decodeEntities('Bizancio: &quot;Punta Baja&quot;')).toBe('Bizancio: "Punta Baja"');
  });

  it("decodifica nombradas comunes y acentos", () => {
    expect(decodeEntities("Caf&eacute;")).toBe("Café");
    expect(decodeEntities("ni&ntilde;o &amp; ni&ntilde;a")).toBe("niño & niña");
    expect(decodeEntities("&iquest;Qu&eacute;?")).toBe("¿Qué?");
  });

  it("decodifica numéricas decimal y hex", () => {
    expect(decodeEntities("A&#34;B")).toBe('A"B');
    expect(decodeEntities("A&#x22;B")).toBe('A"B');
    expect(decodeEntities("&#233;")).toBe("é");
  });

  it("deja intactas las desconocidas y el texto sin entidades", () => {
    expect(decodeEntities("normal title")).toBe("normal title");
    expect(decodeEntities("R&D &foobar;")).toBe("R&D &foobar;");
  });

  it("es idempotente sobre texto ya decodificado", () => {
    expect(decodeEntities(decodeEntities("I&quot;s"))).toBe('I"s');
  });
});
