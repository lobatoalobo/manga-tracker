/**
 * Mapa canónico editorial → `key` de edición trackeada, y helpers de región. **Fuente ÚNICA** compartida entre la
 * escritura legada (`lib/collection.ts` fija `TrackedEdition.key` con esto) y la correspondencia del read-side
 * unificado (`lib/collection-read/mapping`, ADR-011 / Slice 9). Puro, sin dependencias.
 *
 * Por qué una sola fuente: la correspondencia entre los dos ejes de colección usa la tripla
 * `(serie, editionKey, tomo)` como ÚNICA identidad compartida (no hay id fuerte común entre `OwnedVolume` y el
 * `Volume` del catálogo). Si la escritura legada y la correspondencia derivaran `editionKey` con mapas distintos,
 * un mismo tomo dejaría de reconocerse en ambos ejes y la coexistencia Collection↔OwnedVolume se rompería. Por eso
 * no se mantienen dos mapas sincronizados: ambos consumidores importan de acá.
 */

export const PURCHASE_PUBLISHER_KEY: Record<string, string> = {
  "Ivrea Argentina": "ivrea",
  "Panini Argentina": "panini",
  "Ovni Press": "ovni",
  "Kemuri Ediciones": "kemuri",
  "Utopía Editorial": "utopia",
  "Larp Editores": "larp",
  "Distrito Manga": "distrito",
  "Planeta Cómic": "planeta",
  "VIZ Media": "viz",
};

/** Región de la edición según la editorial (VIZ = internacional). */
export function publisherRegion(publisher: string | null | undefined): "AR" | "INT" {
  return publisher && /viz/i.test(publisher) ? "INT" : "AR";
}

/**
 * `key` de `TrackedEdition` para una edición respaldada por catálogo (caso "row" del legado): editorial conocida
 * del mapa, o fallback nacional `"ar"`. Es EXACTAMENTE la key que la escritura legada fija para un tomo comprado
 * cuya serie tiene `PublisherEdition`, por lo que la correspondencia la reproduce para reconocer el mismo tomo.
 * El fallback viz-aware por texto libre (caso sin row) vive en el legado, fuera de este eje.
 */
export function publisherKey(publisher: string): string {
  return PURCHASE_PUBLISHER_KEY[publisher] ?? "ar";
}
