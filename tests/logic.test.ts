import { describe, it, expect } from "vitest";
import { workCardFlags, publisherKey } from "@/lib/catalog";
import { volumeCap, isPlausibleVolume } from "@/lib/volumes";
import { parseStatus } from "@/lib/providers/mangaupdates";

// Reglas que se rompieron en producción y NO deben volver a romperse.

describe("workCardFlags (banderas de la card)", () => {
  const ivrea = { publisher: "Ivrea Argentina", volumes: 5 };
  const viz = { publisher: "VIZ Media", volumes: 3 };

  it("obra solo-VIZ NO es nacional (bug Portus/Elusive Samurai)", () => {
    const f = workCardFlags([viz], false);
    expect(f.national).toBe(false);
    expect(f.intl).toBe(true);
    expect(f.publishers).toEqual(["VIZ Media"]);
  });

  it("obra solo-VIZ con upcoming viejo TAMPOCO es nacional", () => {
    // El flag `upcoming` no debe marcar AR si ya hay una edición (VIZ).
    expect(workCardFlags([viz], true).national).toBe(false);
  });

  it("obra Ivrea es nacional", () => {
    expect(workCardFlags([ivrea], false).national).toBe(true);
  });

  it("obra en ambas editoriales muestra AMBAS banderas", () => {
    const f = workCardFlags([ivrea, viz], false);
    expect(f.national).toBe(true);
    expect(f.intl).toBe(true);
  });

  it("debut GENUINO (upcoming + sin ediciones) es nacional + isUpcoming", () => {
    const f = workCardFlags([], true);
    expect(f.national).toBe(true);
    expect(f.isUpcoming).toBe(true);
  });

  it("obra con edición publicada NO es isUpcoming aunque tenga el flag", () => {
    expect(workCardFlags([ivrea], true).isUpcoming).toBe(false);
  });
});

describe("publisherKey (key de edición estable)", () => {
  it("mapea las editoriales conocidas", () => {
    expect(publisherKey("Ivrea Argentina")).toBe("ivrea");
    expect(publisherKey("VIZ Media")).toBe("viz");
    expect(publisherKey("Panini Argentina")).toBe("panini");
  });
  it("fallback para desconocidas", () => {
    expect(publisherKey("Editorial Rara")).toBe("ar");
  });
});

describe("volumeCap / isPlausibleVolume (anti-typo de compra)", () => {
  it("acepta un tomo apenas por encima (catálogo atrasado)", () => {
    expect(isPlausibleVolume(10, 11)).toBe(true); // serie de 10, comprás el 11
  });
  it("rechaza un typo grosero (tomo 500 de una serie de 10)", () => {
    expect(isPlausibleVolume(10, 500)).toBe(false);
  });
  it("sin conteo conocido (0) no pone tope", () => {
    expect(volumeCap(0)).toBe(Infinity);
    expect(isPlausibleVolume(0, 99)).toBe(true);
  });
  it("escala con series largas", () => {
    expect(isPlausibleVolume(100, 120)).toBe(true); // 100 + 30%
    expect(isPlausibleVolume(100, 200)).toBe(false);
  });
});

describe("parseStatus (conteo de tomos de MangaUpdates)", () => {
  const standard = (s: string) => parseStatus(s).find((f) => f.isStandard)?.count;

  it("conteo simple", () => {
    expect(standard("12 Volumes (Complete)")).toBe(12);
  });
  it("tolera sufijo '+ N Extra Volume' (bug Death Note)", () => {
    expect(standard("12 Volumes + 1 Extra Volume (Complete)")).toBe(12);
  });
  it("tolera '+ Volume 0' en ongoing (bug Hunter x Hunter)", () => {
    expect(standard("38 Volumes + Volume 0 (Ongoing)")).toBe(38);
  });
  it("NO toma un formato no-estándar (Bunkoban) como estándar", () => {
    const formats = parseStatus("7 Bunkoban Volumes (Complete)");
    expect(formats.find((f) => f.isStandard)).toBeUndefined();
  });
  it("elige el formato estándar entre varios", () => {
    expect(
      standard("72 Volumes (Complete)\n24 Combini-ban Volumes (Complete)"),
    ).toBe(72);
  });
});
