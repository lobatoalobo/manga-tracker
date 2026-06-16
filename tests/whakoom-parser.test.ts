import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseWhakoomEdition, parseWhakoomDate } from "@/lib/providers/whakoom";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );

describe("parseWhakoomEdition", () => {
  it("lee el formato con nombre anidado en <span itemprop> (el bug)", () => {
    // Página real de Ovni que el parser viejo salteaba (publisher/autor vacíos).
    const ed = parseWhakoomEdition(
      fixture("whakoom-ovni-nested-1vol.html"),
      "https://www.whakoom.com/ediciones/637087/x",
    );
    expect(ed).not.toBeNull();
    expect(ed!.title).toBe("5 Seconds Before a Witch Falls in Love");
    expect(ed!.publisher).toBe("Ovni Press");
    expect(ed!.author).toBe("Zeniko Sumiya");
    expect(ed!.volumes).toBe(1); // edición de 1 tomo (sin número en el link)
    expect(ed!.whakoomId).toBe("637087"); // id de la edición desde la URL
    expect(ed!.volumesList).toHaveLength(1);
    expect(ed!.volumesList[0]).toMatchObject({ number: 1 });
    expect(ed!.volumesList[0].comicId).toBeTruthy();
  });

  it("lee el formato con texto directo y varios tomos numerados", () => {
    const ed = parseWhakoomEdition(
      fixture("whakoom-direct-multivol.html"),
      "https://www.whakoom.com/ediciones/1/x",
    );
    expect(ed).not.toBeNull();
    expect(ed!.title).toBe("Blue Period"); // saca el "(Panini …)" del og:title
    expect(ed!.publisher).toBe("Panini Comics Argentina");
    expect(ed!.author).toBe("Tsubasa Yamaguchi");
    expect(ed!.volumes).toBe(3); // máximo número de tomo
    expect(ed!.whakoomId).toBe("1");
    expect(ed!.volumesList.map((v) => v.number)).toEqual([1, 2, 3]);
  });

  it("devuelve null si no hay título", () => {
    expect(parseWhakoomEdition("<html></html>", "u")).toBeNull();
  });

  it("extrae la sinopsis del bloque Argumento (obras no-AniList)", () => {
    const html = `
      <meta property="og:title" content="Sacerdotisa de la Oscuridad (Utopía)" />
      <div class="wiki-text"><h2>Argumento</h2><p>Shun Sugawa en su niñez defiende a una compa&#241;era.</p></div>
    `;
    const ed = parseWhakoomEdition(html, "https://www.whakoom.com/ediciones/626848/x");
    expect(ed!.synopsis).toBe("Shun Sugawa en su niñez defiende a una compañera.");
  });

  it("synopsis es null si no hay Argumento", () => {
    const ed = parseWhakoomEdition(
      `<meta property="og:title" content="X" />`,
      "https://www.whakoom.com/ediciones/1/x",
    );
    expect(ed!.synopsis).toBeNull();
  });

  it("extrae la fecha de publicación (preventa → badge Pronto)", () => {
    const html = `
      <meta property="og:title" content="Ichi the Witch #1 (Ivrea)" />
      <div class="info-item"><h3>Fecha de publicación</h3><p itemprop="" content=""> Julio 2026</p></div>
    `;
    const ed = parseWhakoomEdition(html, "https://www.whakoom.com/ediciones/693897/x");
    expect(ed!.releaseDate).toEqual(new Date(2026, 6, 1)); // julio = mes 6
  });
});

describe("parseWhakoomDate", () => {
  it("'Julio 2026' → 1 de julio de 2026", () => {
    expect(parseWhakoomDate("Julio 2026")).toEqual(new Date(2026, 6, 1));
  });
  it("decodifica entidades y tildes ('Setiembre')", () => {
    expect(parseWhakoomDate("Setiembre 2025")).toEqual(new Date(2025, 8, 1));
  });
  it("año suelto → enero de ese año", () => {
    expect(parseWhakoomDate("2027")).toEqual(new Date(2027, 0, 1));
  });
  it("texto no reconocido → null", () => {
    expect(parseWhakoomDate("próximamente")).toBeNull();
  });
});
