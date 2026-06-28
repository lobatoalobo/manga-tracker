/**
 * Heurística para clasificar `Work.type` (MANGA vs COMIC) sin una fuente de
 * categoría confiable (Whakoom no la expone; MU/MD indexan cómics → no sirven).
 * Pensada para Panini, que mezcla manga japonés con cómic Marvel/DC.
 *
 * `looksLikeComic` es CONSERVADORA: matchea marcas inequívocas de cómic
 * occidental (personajes/sellos Marvel/DC + editoras indie). Lo que no matchea
 * queda MANGA (default). Los bordes se revisan a mano (override en el editor).
 * Ver memoria panini-classify.
 */

// Marcas inequívocas de cómic occidental (lowercase, match por substring).
const COMIC_TERMS = [
  // Marvel — personajes / equipos
  "spider-man", "spiderman", "spider-boy", "spider-gwen", "spider-cero", "spider-verse",
  "x-men", "x-treme", "x-force", "avengers", "wolverine", "deadpool", "venom", "carnage",
  "hulk", "thor", "iron man", "iron-man", "capitán américa", "captain america",
  "daredevil", "moon knight", "doctor strange", "ghost rider", "punisher",
  "cuatro fantásticos", "4 fantasticos", "fantastic four", "guardianes de la galaxia",
  "black panther", "pantera negra", "capitana marvel", "capitán marvel", "captain marvel",
  "silver surfer", "eternos", "eternals", "shang-chi", "miles morales", "gambit",
  "hawkeye", "scarlet witch", "ms. marvel", "black widow", "black bolt", "black cat",
  "kraven", "green goblin", "the sentry", "valkyria: jane foster", "spine-tingling",
  "la mole", "hellbender", "wandavision", "nova:", "blade", "morbius", "thanos",
  // Marvel — sellos / eventos / colecciones
  "marvel", "imperio:", "heroes reborn", "blood hunt", "dark web", "king in black",
  "devil's reign", "secret war", "civil war", "guerras del infinito", "war of the realms",
  "guerra de los reinos", "midnight sons", "planet hulk", "world war hulk", "a.x.e",
  "judgment day", "g.o.d.s", "camino a imperio", "universo marvel", "señores del imperio",
  "ultimate invasion", "ultimate universe", "ultimates", "heroes return", "must-have",
  // DC
  "batman", "superman", "wonder woman", "mujer maravilla", "aquaman", "the flash",
  "green lantern", "linterna verde", "joker", "harley quinn", "teen titans",
  "jóvenes titanes", "liga de la justicia", "justice league", "nightwing", "catwoman",
  "darkseid", "shazam", "metahumano", "deathstroke", "anatomía de un metahumano",
  // Indie / otras occidentales que publica Panini
  "spawn", "hellboy", "walking dead", "witchblade", "cyber force", "ballistic",
  "gaturro", "warcraft", "the boys", "invincible", "transformers", "g.i. joe",
  "tomb raider", "america's got powers", "convergencia", "g.o.d.s.",
  // Marvel/indie con título no obvio (autor occidental)
  "logan", "vota a loki", "warlock", "we stand on guard", "spider-woman", "storm:",
];

// Excepciones: títulos que matchean un término pero SON manga (ej. el manga
// oficial de Star Wars, o adaptaciones japonesas). El check de `\bmanga\b` cubre
// "Star Wars Manga"; acá van los que no lo dicen en el título.
const MANGA_OVERRIDES = [
  "star wars manga",
];

// Autores de cómic occidental/argentino: su obra es COMIC aunque el título no
// tenga una marca Marvel/DC (clave para editoriales indie como Utopía/Ovni).
const COMIC_AUTHORS = [
  "mark millar", "rick remender", "gerard way", "paco roca", "neil gaiman",
  "brian k. vaughan", "garth ennis", "joe kelly", "jamie hewlett", "simon spurrier",
  "bastien", "manu larcenet", "gustavo duarte", "juan díaz canales", "luciano saracino",
  "ariel olivetti", "enrique alcatena", "salvador sanz",
];

/**
 * ¿Parece un cómic occidental? Por título (marcas Marvel/DC/indie) o por autor
 * (lista de autores de cómic). El autor desambigua los indie que el título no
 * delata (Tokyo Ghost, Saga, Umbrella Academy…), incluso si matchean MU/MD.
 */
export function looksLikeComic(title: string, author?: string | null): boolean {
  const t = title.toLowerCase();
  if (/\bmanga\b/.test(t)) return false; // "Star Wars Manga", "… Manga"
  if (MANGA_OVERRIDES.some((m) => t.includes(m))) return false;
  if (COMIC_TERMS.some((term) => t.includes(term))) return true;
  if (author) {
    const a = author.toLowerCase();
    if (COMIC_AUTHORS.some((x) => a.includes(x))) return true;
  }
  return false;
}
