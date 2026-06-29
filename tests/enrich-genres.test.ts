import { describe, it, expect } from "vitest";
import { isCurated, dropCuratedFields, markCurated } from "@/lib/domain/work/curated";
import { planGenreNormalization, type GenreRow } from "@/lib/domain/work/genres";

describe("curated (invariante transversal de protección de atributos)", () => {
  it("isCurated detecta campos protegidos", () => {
    expect(isCurated(["author"], "author")).toBe(true);
    expect(isCurated(["author"], "genres")).toBe(false);
  });
  it("dropCuratedFields descarta solo los campos curados", () => {
    expect(dropCuratedFields({ author: "X", genres: ["a"] }, ["author"])).toEqual({ genres: ["a"] });
  });
  it("markCurated agrega sin duplicar", () => {
    expect(markCurated(["author"], "author", "coverImage")).toEqual(["author", "coverImage"]);
  });
});

describe("planGenreNormalization (enrich PATCH-only)", () => {
  const row = (o: Partial<GenreRow> & { id: number }): GenreRow => ({
    title: "T", genres: [], rawGenres: [], demographic: null, curated: [], ...o,
  });

  it("backupea el crudo y normaliza (primera pasada)", () => {
    const plan = planGenreNormalization([row({ id: 1, genres: ["Shounen", "Action"] })]);
    expect(plan).toHaveLength(1);
    expect(plan[0].data.rawGenres).toEqual(["Shounen", "Action"]); // backup del crudo
    expect(plan[0].data.genres).toBeDefined(); // géneros canónicos (taxonomía: lib/genres)
  });

  it("idempotente: si ya está normalizado, no genera patch", () => {
    // rawGenres ya respaldado y genres/demographic ya canónicos → sin cambios.
    const norm = planGenreNormalization([row({ id: 1, genres: ["Aventura"], rawGenres: ["Action"] })]);
    const again = planGenreNormalization([
      row({ id: 1, genres: norm[0].data.genres ?? [], rawGenres: ["Action"], demographic: norm[0].data.demographic ?? null }),
    ]);
    expect(again).toEqual([]);
  });

  it("RESPETA campos curados: no incluye genres si está curado", () => {
    const plan = planGenreNormalization([
      row({ id: 1, genres: ["Shounen", "Action"], curated: ["genres"] }),
    ]);
    // genres protegido → no se patchea; queda solo backup/demographic
    expect(plan[0]?.data.genres).toBeUndefined();
  });

  it("ignora obras sin géneros", () => {
    expect(planGenreNormalization([row({ id: 1 })])).toEqual([]);
  });
});
