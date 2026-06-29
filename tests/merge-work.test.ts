import { describe, it, expect } from "vitest";
import { sameSeries, titlesAgree, type SeriesIdentity } from "@/lib/domain/work/merge";

const W = (o: Partial<SeriesIdentity>): SeriesIdentity => ({
  title: "", anilistId: null, muId: null, mdId: null, originalTitle: null, ...o,
});

describe("sameSeries (invariante del merge)", () => {
  it("RECHAZA anilistId distintos (series confirmadas distintas)", () => {
    expect(sameSeries(W({ anilistId: 1 }), W({ anilistId: 2 }))).toBe(false);
  });
  it("RECHAZA muId/mdId distintos aunque el título se parezca", () => {
    expect(sameSeries(W({ title: "Naruto", muId: "10" }), W({ title: "Naruto", muId: "11" }))).toBe(false);
    expect(sameSeries(W({ mdId: "a" }), W({ mdId: "b" }))).toBe(false);
  });
  it("ACEPTA mismo anilistId (la cola de dups)", () => {
    expect(sameSeries(W({ anilistId: 5 }), W({ anilistId: 5 }))).toBe(true);
  });
  it("ACEPTA mismo muId / mismo mdId", () => {
    expect(sameSeries(W({ muId: "7" }), W({ muId: "7" }))).toBe(true);
    expect(sameSeries(W({ mdId: "uuid" }), W({ mdId: "uuid" }))).toBe(true);
  });
  it("ACEPTA mismo título estricto sin id externo (Work por título)", () => {
    expect(sameSeries(W({ title: "El Callejón" }), W({ title: "el callejón" }))).toBe(true);
  });
  it("ACEPTA mismo romaji base (VIZ inglés vs Ivrea español)", () => {
    expect(
      sameSeries(
        W({ title: "The Alley", originalTitle: "Rojiura (ITO Junji)" }),
        W({ title: "El Callejón", originalTitle: "ROJIURA" }),
      ),
    ).toBe(true);
  });
  it("RECHAZA series distintas con título distinto y sin id", () => {
    expect(sameSeries(W({ title: "Naruto" }), W({ title: "Bleach" }))).toBe(false);
  });
  it("NO fusiona una serie con su secuela (Citrus vs Citrus+)", () => {
    expect(sameSeries(W({ title: "Citrus" }), W({ title: "Citrus+" }))).toBe(false);
  });
});

describe("titlesAgree (átomo compartido con el guard de enrich)", () => {
  const T = (title: string, originalTitle: string | null = null) => ({ title, originalTitle });
  it("coincide por título estricto (ignora mayúsculas/acentos)", () => {
    expect(titlesAgree(T("El Callejón"), T("el callejon"))).toBe(true);
  });
  it("coincide por romaji base aunque difiera el título traducido", () => {
    expect(titlesAgree(T("The Alley", "Rojiura (ITO Junji)"), T("El Callejón", "ROJIURA"))).toBe(true);
  });
  it("NO coincide base vs spin-off (el caso del over-merge)", () => {
    expect(titlesAgree(T("Attack on Titan"), T("Attack on Titan: Sin Remordimientos"))).toBe(false);
  });
  it("NO confía en nada más que el título: distinto título = false", () => {
    expect(titlesAgree(T("Naruto"), T("Bleach"))).toBe(false);
  });
});
