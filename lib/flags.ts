/**
 * Flags de runtime. `ANILIST_OFF` apaga la dependencia de AniList: la app corre
 * solo con el catálogo local (`Work`/ediciones).
 *
 * Se prende solo en STAGING durante la migración a catálogo local: automático en
 * los deploys de la rama `staging` (Vercel expone `VERCEL_GIT_COMMIT_REF`), o a
 * mano con la env `ANILIST_OFF=1`. Prod (rama `main`) queda con AniList ON hasta
 * el cutover. Ver docs/plan-catalogo-local.md.
 */
export const ANILIST_OFF =
  process.env.ANILIST_OFF === "1" ||
  process.env.VERCEL_GIT_COMMIT_REF === "staging";
