/**
 * Flags de runtime. `ANILIST_OFF` apaga la dependencia de AniList: la app corre
 * solo con el catálogo local (`Work`/ediciones). Se prende por entorno (env
 * `ANILIST_OFF=1`) para poder tenerlo ON en staging y OFF en prod durante la
 * migración a catálogo local (ver docs/plan-catalogo-local.md).
 */
export const ANILIST_OFF = process.env.ANILIST_OFF === "1";
