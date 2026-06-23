import { describe, it, expect } from "vitest";
import { buildTargets } from "@/lib/enrichWorks";

describe("buildTargets", () => {
  it("extrae el romaji antes de ': ' (patrón de Whakoom AR)", () => {
    const t = buildTargets(null, "Umimachi Diary: Diario de una Ciudad Costera");
    expect(t).toContain("Umimachi Diary");
  });

  it("extrae el prefijo antes de ' - '", () => {
    const t = buildTargets(null, "JIGOKURAKU - Hell's Paradise");
    expect(t).toContain("JIGOKURAKU");
  });

  it("NO corta 'Re:Zero' (colon sin espacio)", () => {
    const t = buildTargets(null, "Re:Zero");
    // No debe aparecer "Re" como target (quedaría < 3 chars de todas formas).
    expect(t).not.toContain("Re");
    expect(t).toContain("Re:Zero");
  });

  it("incluye original, título y versión sin espacios", () => {
    const t = buildTargets("GACHI AKUTA", "Gachiakuta");
    expect(t).toContain("GACHI AKUTA");
    expect(t).toContain("Gachiakuta");
    expect(t).toContain("GACHIAKUTA"); // sin espacios
  });

  it("dedupe y sin prefijos triviales (< 3 chars)", () => {
    const t = buildTargets(null, "AB: algo");
    expect(t).not.toContain("AB");
  });
});
