import {
  planGenreNormalization,
  type GenreEnrichPlan,
  type GenreEnrichReadPort,
  type GenreEnrichWritePort,
} from "@/lib/domain/work/genres";
import { defineMutation } from "@/lib/mutations";

export type NormalizeGenresInput = Record<string, never>;

/**
 * Normaliza géneros a la taxonomía canónica (familia 4 — enrich/backfill). Primera
 * mutación SEMÁNTICA del sistema: refina atributos sin tocar topología. De ahí:
 *  - `irreversible: false` (vs true de merge/delete/cleanup) — el flag DISTINGUE
 *    mutación estructural de semántica sin que el framework conozca dominio.
 *  - el circuit-breaker es `maxUpdates` (no `maxDeletes`); para enrich de catálogo
 *    completo es un TECHO de cordura (la 1ª corrida toca muchas), no un guard fino.
 *  - sin idempotency key: inherente por overwrite.
 *  - respeta campos curados (guard en el dominio).
 */
export const normalizeGenres = defineMutation<
  NormalizeGenresInput,
  GenreEnrichPlan,
  GenreEnrichReadPort,
  GenreEnrichWritePort
>({
  name: "normalizeGenres",
  definitionVersion: 1,
  kind: "ENRICH",
  policy: {
    maxUpdates: 10000, // techo de cordura para bulk enrich (no es simétrico a maxDeletes)
    requiresConfirmation: "prod",
  },

  async preview(ctx) {
    const rows = await ctx.read.loadCandidates();
    const plan = planGenreNormalization(rows);
    const withDemo = plan.filter((p) => p.data.demographic !== undefined).length;
    const human = plan.length
      ? `Normaliza géneros en ${plan.length} obra(s) (${withDemo} con demografía); ` +
        `respeta campos curados.`
      : "Nada para normalizar.";
    return {
      affected: { creates: 0, updates: plan.length, deletes: 0, entities: ["Work"] },
      irreversible: false,
      summary: { domain: "normalizeGenres", human },
      plan,
    };
  },

  async execute(ctx, _input, plan) {
    if (!ctx.write) throw new Error("normalizeGenres.execute requiere write-port (tx)");
    const n = await ctx.write.applyPatches(plan);
    return { affected: { creates: 0, updates: n, deletes: 0, entities: ["Work"] } };
  },
});
