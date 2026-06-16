import { describe, it, expect } from "vitest";
import { authorMatches } from "@/lib/authorMatch";

describe("authorMatches", () => {
  it("tolera romanización (Eiichiro ≈ Eiichirou)", () => {
    expect(
      authorMatches(["Eiichirou Oda", "Tatsuma Eijiri"], "Eiichiro Oda"),
    ).toBe(true);
  });

  it("tolera concatenación de nombre (AidaIro ≈ Iro Aida)", () => {
    expect(authorMatches(["AidaIro"], "Iro Aida")).toBe(true);
  });

  it("matchea exacto", () => {
    expect(authorMatches(["Masami Tsuda"], "Masami Tsuda")).toBe(true);
  });

  it("bloquea homónimos de distinto autor", () => {
    // "Adabana" de NON vs el hentai homónimo de otro autor.
    expect(authorMatches(["Chirotata"], "Non")).toBe(false);
    expect(authorMatches(["Takehiko Inoue"], "Naoki Urasawa")).toBe(false);
  });

  it("matchea apellido corto compartido (Non)", () => {
    expect(authorMatches(["NON", "Eric Montesinos"], "Non")).toBe(true);
  });

  it("conservador: sin datos de un lado, no bloquea", () => {
    expect(authorMatches([], "Eiichiro Oda")).toBe(true);
    expect(authorMatches(["Eiichirou Oda"], null)).toBe(true);
  });
});
