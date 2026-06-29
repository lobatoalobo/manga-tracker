import { describe, it, expect } from "vitest";
import { workDomainKey } from "@/lib/domain/work/identity";
import { buildDeleteWorkPlan, deleteWorkWarnings } from "@/lib/domain/work/delete";

describe("workDomainKey (invariante de ciclo de vida compartido)", () => {
  it("usa anilistId cuando existe", () => {
    expect(workDomainKey({ anilistId: 42, id: 7 })).toBe(42);
  });
  it("usa -id para obras locales sin anilistId", () => {
    expect(workDomainKey({ anilistId: null, id: 7 })).toBe(-7);
  });
});

describe("buildDeleteWorkPlan", () => {
  it("arma el plan con la clave de dominio correcta", () => {
    expect(buildDeleteWorkPlan({ id: 5, anilistId: null })).toEqual({ workId: 5, domainKey: -5 });
    expect(buildDeleteWorkPlan({ id: 5, anilistId: 99 })).toEqual({ workId: 5, domainKey: 99 });
  });
});

describe("deleteWorkWarnings", () => {
  it("advierte (no bloquea) si hay colección real → sugiere fusionar", () => {
    const w = deleteWorkWarnings({ editions: 2, collection: 3, wishlist: 0 });
    expect(w.some((x) => x.toLowerCase().includes("fusionar"))).toBe(true);
  });
  it("advierte por deseados", () => {
    expect(deleteWorkWarnings({ editions: 0, collection: 0, wishlist: 4 }).length).toBe(1);
  });
  it("sin colección ni deseados, no advierte", () => {
    expect(deleteWorkWarnings({ editions: 1, collection: 0, wishlist: 0 })).toEqual([]);
  });
});
