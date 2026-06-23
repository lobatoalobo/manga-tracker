import { describe, it, expect } from "vitest";
import {
  authorKey,
  titleCase,
  rewriteAuthorField,
} from "@/lib/authorMerge";

describe("authorKey", () => {
  it("colapsa orden y mayúsculas en la misma clave", () => {
    expect(authorKey("ASANO Inio")).toBe(authorKey("Inio Asano"));
    expect(authorKey("INIO ASANO")).toBe(authorKey("Inio Asano"));
    expect(authorKey("TORIYAMA Akira")).toBe(authorKey("Akira Toriyama"));
  });

  it("colapsa vocal larga del romaji (Itou ≈ Ito)", () => {
    expect(authorKey("ITOU Junji")).toBe(authorKey("Junji Ito"));
    expect(authorKey("Yuu Watase")).toBe(authorKey("Yu Watase"));
  });

  it("distingue autores distintos", () => {
    expect(authorKey("Naoki Urasawa")).not.toBe(authorKey("Takehiko Inoue"));
  });
});

describe("titleCase", () => {
  it("normaliza mayúsculas", () => {
    expect(titleCase("FRANK MILLER")).toBe("Frank Miller");
    expect(titleCase("inio asano")).toBe("Inio Asano");
    expect(titleCase("ASANO Inio")).toBe("Asano Inio");
  });
});

describe("rewriteAuthorField", () => {
  const set = new Set(["asano inio", "inio asano", "INIO ASANO".toLowerCase()]);

  it("reescribe la variante al canónico", () => {
    expect(rewriteAuthorField("ASANO Inio", set, "Inio Asano")).toBe("Inio Asano");
  });

  it("preserva co-autores y solo toca la variante", () => {
    expect(rewriteAuthorField("ASANO Inio, Otro Autor", set, "Inio Asano")).toBe(
      "Inio Asano, Otro Autor",
    );
  });

  it("dedupe si el canónico ya estaba presente", () => {
    expect(
      rewriteAuthorField("ASANO Inio & Inio Asano", set, "Inio Asano"),
    ).toBe("Inio Asano");
  });

  it("devuelve null si no hay match", () => {
    expect(rewriteAuthorField("Otro Autor", set, "Inio Asano")).toBeNull();
  });

  it("devuelve null si no cambia nada (ya canónico)", () => {
    expect(rewriteAuthorField("Inio Asano", set, "Inio Asano")).toBeNull();
  });
});
