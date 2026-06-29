import { describe, it, expect } from "vitest";
import {
  canonicalEdition,
  planRedundantEditionCleanup,
  type EditionForCleanup,
  type EditionDupGroupLite,
} from "@/lib/domain/work/cleanupEditions";

const ed = (o: Partial<EditionForCleanup> & { id: number }): EditionForCleanup => ({
  slug: "x", volumes: 0, anilistId: null, ...o,
});

describe("canonicalEdition", () => {
  it("prioriza la que tiene anilistId", () => {
    expect(canonicalEdition([ed({ id: 1 }), ed({ id: 2, anilistId: 9 })]).id).toBe(2);
  });
  it("a igualdad de anilistId, más tomos gana", () => {
    expect(canonicalEdition([ed({ id: 1, volumes: 3 }), ed({ id: 2, volumes: 10 })]).id).toBe(2);
  });
  it("desempata por slug más corto", () => {
    expect(
      canonicalEdition([ed({ id: 1, slug: "i-quot-s" }), ed({ id: 2, slug: "is" })]).id,
    ).toBe(2);
  });
});

describe("planRedundantEditionCleanup", () => {
  const group = (eds: EditionForCleanup[]): EditionDupGroupLite => ({
    publisher: "Ivrea", normTitle: "is", editions: eds,
  });

  it("conserva la canónica y marca el resto para borrar", () => {
    const plan = planRedundantEditionCleanup([
      group([ed({ id: 1, slug: "is", volumes: 16 }), ed({ id: 2, slug: "i-quot-s", volumes: 0 })]),
    ]);
    expect(plan).toEqual([{ id: 2, keptId: 1, publisher: "Ivrea", normTitle: "is" }]);
  });

  it("ignora grupos de una sola edición (nada que limpiar)", () => {
    expect(planRedundantEditionCleanup([group([ed({ id: 1 })])])).toEqual([]);
  });

  it("plan vacío si no hay grupos", () => {
    expect(planRedundantEditionCleanup([])).toEqual([]);
  });
});
