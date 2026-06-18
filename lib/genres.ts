/**
 * Taxonomía CANÓNICA de géneros (cerrada, en español) + mapeo desde los géneros
 * crudos de MangaUpdates/MangaDex (inglés, con duplicados/casing y mezclando
 * demografía). Dos ejes:
 *   - GÉNERO: lista cerrada agrupada por categoría (~40).
 *   - DEMOGRAFÍA: público objetivo (Shonen/Shojo/...), eje aparte.
 * Ver docs/generos-taxonomia.md.
 */

export const DEMOGRAPHICS = [
  "Shonen",
  "Shojo",
  "Seinen",
  "Josei",
  "Kodomo",
] as const;
export type Demographic = (typeof DEMOGRAPHICS)[number];

export const GENRE_CATEGORIES: { category: string; genres: string[] }[] = [
  {
    category: "Romance",
    genres: ["Romance", "Harem", "Reverse Harem", "Boys Love", "Girls Love"],
  },
  {
    category: "Acción/Fantasía",
    genres: [
      "Acción",
      "Aventura",
      "Fantasía",
      "Fantasía oscura",
      "Isekai",
      "Superpoderes",
      "Artes marciales",
      "Magical Girl",
    ],
  },
  {
    category: "Ciencia ficción",
    genres: ["Ciencia ficción", "Cyberpunk", "Mecha", "Space Opera", "Postapocalíptico"],
  },
  {
    category: "Terror/Suspenso",
    genres: ["Terror", "Gore", "Thriller", "Suspenso", "Misterio", "Psicológico"],
  },
  {
    category: "Vida cotidiana",
    genres: ["Slice of Life", "Escolar", "Comedia", "Drama", "Coming of Age"],
  },
  {
    category: "Adultos",
    genres: ["Ecchi", "Erotismo", "Adulto"],
  },
  {
    category: "Especializados",
    genres: [
      "Histórico",
      "Militar",
      "Deportivo",
      "Crimen",
      "Noir",
      "Sobrenatural",
      "Música",
      "Gastronomía",
      "Médico",
      "Animales",
      "Gender Bender",
    ],
  },
];

export const CANONICAL_GENRES: string[] = GENRE_CATEGORIES.flatMap(
  (c) => c.genres,
);

/** Géneros bloqueados (R18): no se mapean ni muestran. */
const BLOCKED = new Set(["loli", "shota", "incest", "lolicon", "shotacon"]);

/** Demografía cruda (lowercase) → canónica. */
const RAW_TO_DEMOGRAPHIC: Record<string, Demographic> = {
  shounen: "Shonen",
  shonen: "Shonen",
  shoujo: "Shojo",
  shojo: "Shojo",
  seinen: "Seinen",
  josei: "Josei",
  kodomo: "Kodomo",
  kids: "Kodomo",
};

/**
 * Género crudo (lowercase) → canónico. El long tail sube a un género canónico
 * (matches más grandes); los duplicados por casing colapsan (sci-fi/sci-fi).
 * Los que NO están acá quedan sin mapear (se loguean para refinar).
 */
const RAW_TO_GENRE: Record<string, string> = {
  // Vida cotidiana
  drama: "Drama",
  tragedy: "Drama",
  comedy: "Comedia",
  "slice of life": "Slice of Life",
  "school life": "Escolar",
  delinquents: "Escolar",
  gyaru: "Escolar",
  "coming of age": "Coming of Age",
  "office workers": "Slice of Life",
  // Acción/Fantasía
  action: "Acción",
  adventure: "Aventura",
  fantasy: "Fantasía",
  magic: "Fantasía",
  "martial arts": "Artes marciales",
  wuxia: "Artes marciales",
  ninja: "Artes marciales",
  samurai: "Artes marciales",
  isekai: "Isekai",
  reincarnation: "Isekai",
  superhero: "Superpoderes",
  "magical girls": "Magical Girl",
  "magical girl": "Magical Girl",
  // Ciencia ficción
  "sci-fi": "Ciencia ficción",
  "science fiction": "Ciencia ficción",
  aliens: "Ciencia ficción",
  "time travel": "Ciencia ficción",
  "virtual reality": "Ciencia ficción",
  "video games": "Ciencia ficción",
  mecha: "Mecha",
  cyberpunk: "Cyberpunk",
  "space opera": "Space Opera",
  "post-apocalyptic": "Postapocalíptico",
  postapocalyptic: "Postapocalíptico",
  // Terror/Suspenso
  horror: "Terror",
  zombies: "Terror",
  gore: "Gore",
  thriller: "Thriller",
  survival: "Suspenso",
  suspense: "Suspenso",
  mystery: "Misterio",
  psychological: "Psicológico",
  philosophical: "Psicológico",
  // Sobrenatural (cluster)
  supernatural: "Sobrenatural",
  monsters: "Sobrenatural",
  "monster girls": "Sobrenatural",
  demons: "Sobrenatural",
  vampires: "Sobrenatural",
  ghosts: "Sobrenatural",
  // Romance
  romance: "Romance",
  harem: "Harem",
  "reverse harem": "Reverse Harem",
  yaoi: "Boys Love",
  "shounen ai": "Boys Love",
  "boys' love": "Boys Love",
  "boys love": "Boys Love",
  yuri: "Girls Love",
  "shoujo ai": "Girls Love",
  "girls' love": "Girls Love",
  "girls love": "Girls Love",
  // Adultos
  ecchi: "Ecchi",
  smut: "Erotismo",
  adult: "Adulto",
  mature: "Adulto",
  // Especializados
  historical: "Histórico",
  military: "Militar",
  sports: "Deportivo",
  crime: "Crimen",
  police: "Crimen",
  mafia: "Crimen",
  music: "Música",
  cooking: "Gastronomía",
  medical: "Médico",
  animals: "Animales",
  "gender bender": "Gender Bender",
  crossdressing: "Gender Bender",
  genderswap: "Gender Bender",
};

const norm = (s: string) => s.trim().toLowerCase();

export function mapRawGenre(raw: string): string | null {
  const k = norm(raw);
  if (BLOCKED.has(k)) return null;
  return RAW_TO_GENRE[k] ?? null;
}

export function mapRawDemographic(raw: string): Demographic | null {
  return RAW_TO_DEMOGRAPHIC[norm(raw)] ?? null;
}

/**
 * Normaliza una lista de géneros crudos a { genres canónicos (dedup, sin
 * demografía ni bloqueados), demographic }. `unmapped` lista los crudos que no
 * matchearon ningún canónico ni demografía (para refinar el mapeo).
 */
export function normalizeGenres(raw: string[]): {
  genres: string[];
  demographic: Demographic | null;
  unmapped: string[];
} {
  const genres = new Set<string>();
  let demographic: Demographic | null = null;
  const unmapped: string[] = [];
  for (const r of raw) {
    const k = norm(r);
    if (!k || BLOCKED.has(k)) continue;
    const demo = RAW_TO_DEMOGRAPHIC[k];
    if (demo) {
      demographic ??= demo;
      continue;
    }
    const g = RAW_TO_GENRE[k];
    if (g) genres.add(g);
    else unmapped.push(r);
  }
  return { genres: [...genres], demographic, unmapped };
}
