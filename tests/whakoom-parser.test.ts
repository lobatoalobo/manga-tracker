import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseWhakoomEdition } from "@/lib/providers/whakoom";

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
});
