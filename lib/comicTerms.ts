/**
 * Términos que delatan un cómic occidental (Marvel/DC/Star Wars/etc.) colado en
 * el catálogo de manga. Compartido por la curación (lib/curation) y los filtros
 * de mapeos (lib/catalog), sin acoplar esos módulos entre sí.
 */
export const COMIC_TERMS = [
  "marvel", "dc comics", "spider-man", "spiderman", "spider man", "batman",
  "superman", "wonder woman", "mujer maravilla", "x-men", "x men", "wolverine",
  "deadpool", "avengers", "vengadores", "justice league", "liga de la justicia",
  "hulk", "thor", "iron man", "capitan america", "captain america", "the flash",
  "green lantern", "linterna verde", "aquaman", "daredevil", "punisher",
  "castigador", "venom", "carnage", "harley quinn", "teen titans",
  "jovenes titanes", "suicide squad", "escuadron suicida", "watchmen", "sandman",
  "hellboy", "walking dead", "star wars", "fantastic four", "4 fantasticos",
  "cuatro fantasticos", "guardians of the galaxy", "guardianes de la galaxia",
  "black panther", "pantera negra", "doctor strange", "ant-man", "black widow",
  "moon knight", "ghost rider", "silver surfer", "miles morales", "absolute batman",
  "dark knight", "gotham", "justice society", "green arrow", "shazam",
  "thanos", "black bolt", "blood hunt", "dark web", "devil's reign", "x-force",
  "x-statix", "spider-gwen", "spider-verse", "gwen stacy", "black cat", "a.x.e",
  "sabretooth", "gambit", "cyclops", "jean grey", "galactus", "doctor doom",
  "red hood", "nightwing", "catwoman", "darkseid", "black adam", "namor",
  "eternals", "inhumans", "she-hulk", "winter soldier", "luke cage", "iron fist",
  "jessica jones", "kraven", "kingpin", "morbius", "america's got powers",
  "camino a imperio", "anatomia de un metahumano",
];

/** Devuelve el término que coincide (para mostrar el porqué) o null. */
export function looksLikeComic(title: string): string | null {
  const t = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const term of COMIC_TERMS) if (t.includes(term)) return term;
  return null;
}
