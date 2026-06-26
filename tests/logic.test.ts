import { describe, it, expect } from "vitest";
import { workCardFlags, publisherKey, authorNameMatches, romajiKey } from "@/lib/catalog";
import { volumeCap, isPlausibleVolume, publishedVolumes } from "@/lib/volumes";
import { looksLikeComic } from "@/lib/contentType";
import { parseStatus } from "@/lib/providers/mangaupdates";
import { chooseIvreaEdition, type EdLite } from "@/lib/ivreaProximas";

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

describe("looksLikeComic (manga vs cómic en Panini)", () => {
  it("cómics Marvel/DC = comic", () => {
    for (const t of ["Spider-Man", "X-Men Legends", "Capitán América", "Los Cuatro Fantásticos", "Batman/Deadpool", "Marvel Omnibus: Eternos"])
      expect(looksLikeComic(t)).toBe(true);
  });
  it("manga = NO comic", () => {
    for (const t of ["Berserk", "Naruto", "Jujutsu Kaisen", "Zom 100", "One-Punch Man"])
      expect(looksLikeComic(t)).toBe(false);
  });
  it("'... Manga' en el título fuerza manga (Star Wars Manga)", () => {
    expect(looksLikeComic("Star Wars Manga")).toBe(false);
  });
});

describe("publishedVolumes (capar sobre-conteo por tomo futuro)", () => {
  it("Drama Queen: 3 contados, próximo tomo #2 → 1 publicado", () => {
    expect(publishedVolumes(3, 2)).toBe(1);
  });
  it("Dai Dark: 9 contados, próximo tomo #6 → 5 publicados", () => {
    expect(publishedVolumes(9, 6)).toBe(5);
  });
  it("sin tomo futuro no cambia el conteo", () => {
    expect(publishedVolumes(7, null)).toBe(7);
  });
  it("nunca SUBE el conteo (próximo lejano)", () => {
    expect(publishedVolumes(3, 9)).toBe(3);
  });
  it("ya correcto es idempotente (1 tomo, próximo #2)", () => {
    expect(publishedVolumes(1, 2)).toBe(1);
  });
});

describe("romajiKey (puente VIZ-EN ↔ Ivrea-ES por romaji)", () => {
  it("'Rojiura (ITO Junji)' y 'ROJIURA' colapsan igual (bug Alley/El Callejón)", () => {
    expect(romajiKey("Rojiura (ITO Junji)")).toBe(romajiKey("ROJIURA"));
    expect(romajiKey("Rojiura (ITO Junji)")).toBe("rojiura");
  });
  it("romaji multi-palabra colapsa con may/min (Ma no Kakera)", () => {
    expect(romajiKey("Ma no Kakera")).toBe(romajiKey("MA NO KAKERA"));
  });
  it("series distintas NO colapsan", () => {
    expect(romajiKey("Tomie")).not.toBe(romajiKey("Uzumaki"));
  });
  it("una serie NO colapsa con su secuela (Citrus vs Citrus+)", () => {
    expect(romajiKey("Citrus+")).not.toBe(romajiKey("Citrus"));
  });
});

describe("authorNameMatches (autor por nombre, no substring)", () => {
  it("'ONE' NO matchea 'BONES' ni 'Kurone' (bug Carole/Konosuba)", () => {
    expect(authorNameMatches("ONE", "BONES, Shinichiro Watanabe")).toBe(false);
    expect(authorNameMatches("ONE", "Natsume Akatsuki, Kurone Mishima")).toBe(false);
  });
  it("'ONE' matchea al autor ONE", () => {
    expect(authorNameMatches("ONE", "ONE")).toBe(true);
    expect(authorNameMatches("ONE", "ONE, Yusuke Murata")).toBe(true);
  });
  it("matchea nombre completo sin importar orden / formato", () => {
    expect(authorNameMatches("Naoki Urasawa", "NAOKI URASAWA")).toBe(true);
    expect(authorNameMatches("Tsubasa Yamaguchi", "Yamaguchi, Tsubasa")).toBe(true);
  });
  it("'Hiro' (1 token) NO matchea autores distintos que contienen Hiro", () => {
    expect(authorNameMatches("Hiro", "Hiro Kiyohara")).toBe(false); // Another
    expect(authorNameMatches("Hiro", "HIRO MASHIMA")).toBe(false); // Fairy Tail
    expect(authorNameMatches("Hiro", "ARIKAWA Hiro")).toBe(false); // Library Wars
    expect(authorNameMatches("Hiro", "Hiro")).toBe(true); // Akebi's (autor real "Hiro")
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

describe("chooseIvreaEdition (mapeo tarjeta /proximas/ → edición)", () => {
  const nge: EdLite[] = [
    { id: 60, slug: "evangelion", title: "Neon Genesis Evangelion" },
    { id: 964, slug: "neon-genesis-evangelion-edicion-deluxe", title: "Neon Genesis Evangelion - Edición Deluxe" },
    { id: 963, slug: "neon-genesis-evangelion-collector-s-edition", title: "Neon Genesis Evangelion - Collector's Edition" },
  ];

  it("reedición 'ED. DELUXE' va a la Deluxe, no a la común (slug genérico)", () => {
    // El card linkea a /titulo/evangelion/ (común) pero el título dice Deluxe.
    const ed = chooseIvreaEdition("NEON GENESIS EVANGELION ED. DELUXE", "evangelion", nge);
    expect(ed?.id).toBe(964);
  });

  it("card corto matchea el título largo (JoJolion)", () => {
    const eds: EdLite[] = [
      { id: 917, slug: "jojo-s-bizarre-adventure-part-viii-jojolion", title: "Jojo's Bizarre Adventure - Part VIII: JoJolion" },
      { id: 5, slug: "bleach", title: "Bleach" },
    ];
    expect(chooseIvreaEdition("JOJOLION", null, eds)?.id).toBe(917);
  });

  it("Bleach Remix no cae en Bleach (regresión)", () => {
    const eds: EdLite[] = [
      { id: 213, slug: "bleach", title: "Bleach" },
      { id: 1386, slug: "bleach-remix", title: "Bleach Remix" },
    ];
    expect(chooseIvreaEdition("BLEACH REMIX", "bleach", eds)?.id).toBe(1386);
  });

  it("tomo normal de Bleach va a Bleach (no a Remix)", () => {
    const eds: EdLite[] = [
      { id: 213, slug: "bleach", title: "Bleach" },
      { id: 1386, slug: "bleach-remix", title: "Bleach Remix" },
    ];
    expect(chooseIvreaEdition("Bleach", "bleach", eds)?.id).toBe(213);
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
