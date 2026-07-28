import { describe, it, expect } from "vitest";
import { progressPercentage } from "@/services/collectionService";

/**
 * Porcentaje de progreso público (ADR-011 / Slice 9 / Checkpoint 7). Comparte el numerador con el stat
 * "Tomos poseídos" (ownership unificado); denominador legado (`totalVolumes`). Clamp de PRESENTACIÓN a 100.
 */
describe("progressPercentage · Share pública", () => {
  it("equivalencia normal: mismo numerador que el stat", () => {
    expect(progressPercentage(5, 10)).toBe(50);
    expect(progressPercentage(10, 10)).toBe(100);
    expect(progressPercentage(3, 4)).toBe(75);
  });

  it("redondea (no floor): 1/3 → 33, 2/3 → 67", () => {
    expect(progressPercentage(1, 3)).toBe(33);
    expect(progressPercentage(2, 3)).toBe(67);
  });

  it("autoridad de Collection: numerador 0 → 0 (coherente con el stat 0)", () => {
    expect(progressPercentage(0, 1)).toBe(0);
    expect(progressPercentage(0, 10)).toBe(0);
  });

  it("ambigüedad: ownedVolumes > totalVolumes → clamp de presentación a 100 (nunca supera 100)", () => {
    expect(progressPercentage(3, 1)).toBe(100); // 300% crudo → 100 display
    expect(progressPercentage(11, 10)).toBe(100);
    expect(progressPercentage(2, 1)).toBe(100);
  });

  it("totalVolumes = 0 → 0, sin división por cero", () => {
    expect(progressPercentage(0, 0)).toBe(0);
    expect(progressPercentage(5, 0)).toBe(0); // aunque haya poseídos, sin denominador → 0
    expect(Number.isFinite(progressPercentage(5, 0))).toBe(true);
  });

  it("totalVolumes negativo (defensivo) → 0", () => {
    expect(progressPercentage(1, -3)).toBe(0);
  });
});
