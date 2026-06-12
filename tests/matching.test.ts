import { describe, it, expect } from "vitest";
import { authorMatches } from "@/lib/authorMatch";
import { crumbSearch } from "@/lib/crumb";
import { ovniSearchUrl, isOvniUrl } from "@/lib/ovni";

describe("authorMatches (anti-homónimos)", () => {
  it("coincide cuando comparten un token sustancial", () => {
    expect(authorMatches(["Takehiko Inoue"], "Takehiko Inoue")).toBe(true);
    // robusto a ruido pegado al nombre
    expect(
      authorMatches(["Tsubasa Yamaguchi"], "Yamaguchi, Tsubasa - sinopsis…"),
    ).toBe(true);
  });

  it("bloquea autores claramente distintos (caso homónimo)", () => {
    // "Real" de Inoue vs otra obra "Real" de otro autor
    expect(authorMatches(["Takehiko Inoue"], "Keiichi Arawi")).toBe(false);
  });

  it("es conservador: sin datos de autor no bloquea", () => {
    expect(authorMatches(["Takehiko Inoue"], null)).toBe(true);
    expect(authorMatches([], "Cualquiera")).toBe(true);
  });
});

describe("URLs de tienda", () => {
  it("crumbSearch arma el filtro de Crumb", () => {
    expect(crumbSearch("Sakamoto Days")).toBe(
      "https://www.crumb.com.ar/productos/?filter=Sakamoto%20Days&order=0&view=1",
    );
  });

  it("ovniSearchUrl arma la búsqueda de OvniPress", () => {
    expect(ovniSearchUrl("Houkago Edge")).toBe(
      "https://www.ovnipress.net/search/?q=Houkago%20Edge",
    );
  });

  it("isOvniUrl detecta links de OvniPress", () => {
    expect(isOvniUrl("https://www.ovnipress.net/productos/x")).toBe(true);
    expect(isOvniUrl("https://www.whakoom.com/ediciones/1/x")).toBe(false);
    expect(isOvniUrl(null)).toBe(false);
  });
});
