/**
 * Scan de backfilleabilidad (F2 PR-1): clasifica, SIN escribir, cada tomo legado (`OwnedVolume`) según si puede
 * mapearse de forma INEQUÍVOCA al eje nuevo `PublisherEdition → Volume`. PURO (sin DB, sin reloj, sin azar): reutiliza
 * la correspondencia AUTORITATIVA de `lib/collection-read/mapping/correspondence.ts` (misma tripla
 * `(seriesKey, editionKey, number)`, mismo `publisherKey`). NO agrega heurísticas, slugs, títulos, ids internos ni
 * fallbacks. Ante duda → ambiguo/huérfano, nunca RESOLVABLE.
 *
 * Buckets mutuamente excluyentes y exhaustivos sobre el universo de `OwnedVolume`:
 *  - RESOLVABLE            : `matched` (1 legado ↔ 1 Volume)
 *  - AMBIGUOUS            : colisión de tripla (`c≥2` o `l≥2`) → nunca adivina
 *  - ORPHAN_NO_EDITION    : `legacyOnly` y NO existe ninguna PublisherEdition para el ancla de serie
 *  - EDITION_KEY_MISMATCH : `legacyOnly`, hay edición(es) para el ancla pero ninguna con `publisherKey === editionKey`
 *  - ORPHAN_NO_VOLUME     : `legacyOnly`, hay edición con key coincidente pero falta la fila `Volume` de ese `number`
 *
 * Invariante: RESOLVABLE + AMBIGUOUS + ORPHAN_NO_EDITION + EDITION_KEY_MISMATCH + ORPHAN_NO_VOLUME = total.
 */
import {
  buildCorrespondenceIndex,
  deriveCatalogKey,
  resolveCorrespondence,
  type CatalogVolumeRef,
} from "@/lib/collection-read/mapping/correspondence";
import type { LegacyObservation } from "@/lib/collection-read/ports";

export type BackfillBucket =
  | "RESOLVABLE"
  | "AMBIGUOUS"
  | "ORPHAN_NO_EDITION"
  | "EDITION_KEY_MISMATCH"
  | "ORPHAN_NO_VOLUME";

export const BACKFILL_BUCKETS: readonly BackfillBucket[] = [
  "RESOLVABLE",
  "AMBIGUOUS",
  "ORPHAN_NO_EDITION",
  "EDITION_KEY_MISMATCH",
  "ORPHAN_NO_VOLUME",
] as const;

/** Referencia mínima de una PublisherEdition candidata: alcanza para saber existencia de edición y de key por ancla. */
export type CatalogEditionRef = { anilistId: number | null; workId: number | null; publisher: string };

/** Coordenada de diagnóstico. Sin PII: sólo la tripla de catálogo. */
export type ExampleCoord = { seriesKey: number; editionKey: string; number: number };

const EXAMPLE_LIMIT = 5;

export type UserScanResult = {
  counts: Record<BackfillBucket, number>;
  total: number;
  examples: Record<BackfillBucket, ExampleCoord[]>; // hasta EXAMPLE_LIMIT por bucket, ordenados
  hasUnresolvable: boolean;
};

export type ScanAggregate = {
  total: number;
  counts: Record<BackfillBucket, number>;
  examples: Record<BackfillBucket, ExampleCoord[]>;
  affectedUsers: number; // usuarios con ≥1 OwnedVolume
  usersWithUnresolvable: number; // usuarios con ≥1 tomo no-RESOLVABLE
};

const emptyCounts = (): Record<BackfillBucket, number> => ({
  RESOLVABLE: 0,
  AMBIGUOUS: 0,
  ORPHAN_NO_EDITION: 0,
  EDITION_KEY_MISMATCH: 0,
  ORPHAN_NO_VOLUME: 0,
});
const emptyExamples = (): Record<BackfillBucket, ExampleCoord[]> => ({
  RESOLVABLE: [],
  AMBIGUOUS: [],
  ORPHAN_NO_EDITION: [],
  EDITION_KEY_MISMATCH: [],
  ORPHAN_NO_VOLUME: [],
});

const coordOf = (o: LegacyObservation): ExampleCoord => ({
  seriesKey: o.anilistId,
  editionKey: o.editionKey,
  number: o.volume,
});

/** Orden total y determinístico de coordenadas (para ejemplos reproducibles). */
export const cmpCoord = (a: ExampleCoord, b: ExampleCoord): number =>
  a.seriesKey - b.seriesKey || a.editionKey.localeCompare(b.editionKey) || a.number - b.number;

/** Ordena, deduplica coordenadas idénticas (mismo tomo poseído por varios usuarios) y acota a `EXAMPLE_LIMIT`. */
function topExamples(coords: ExampleCoord[]): ExampleCoord[] {
  const sorted = [...coords].sort(cmpCoord);
  const out: ExampleCoord[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && cmpCoord(prev, c) === 0) continue; // dedup consecutivo
    out.push(c);
    if (out.length >= EXAMPLE_LIMIT) break;
  }
  return out;
}

/**
 * Clasifica los `OwnedVolume` de UN usuario. Todo ya cargado por los adapters (la función es pura):
 *  - `legacy`         : tomos legados del usuario (observaciones del adapter legado)
 *  - `catalogVolumes` : Volumes candidatos por las anclas de ese usuario
 *  - `editions`       : PublisherEditions candidatas por las anclas (para refinar los huérfanos)
 */
export function scanUser(
  legacy: readonly LegacyObservation[],
  catalogVolumes: readonly CatalogVolumeRef[],
  editions: readonly CatalogEditionRef[],
): UserScanResult {
  const counts = emptyCounts();
  const raw = emptyExamples();

  // Anclas con edición y con key presente, derivadas con la MISMA regla autoritativa (deriveCatalogKey), pasando la
  // edición como un ref de volumen "sin número". Edición sin ancla (seriesKey null) no puede corresponder a ningún
  // ancla legado (Manga.anilistId nunca es null) → se ignora.
  const anchorHasEdition = new Set<number>();
  const anchorEditionKeys = new Map<number, Set<string>>();
  for (const e of editions) {
    const k = deriveCatalogKey({ volumeId: 0, number: 0, anilistId: e.anilistId, workId: e.workId, publisher: e.publisher });
    if (k === null) continue;
    anchorHasEdition.add(k.seriesKey);
    const set = anchorEditionKeys.get(k.seriesKey) ?? new Set<string>();
    set.add(k.editionKey);
    anchorEditionKeys.set(k.seriesKey, set);
  }

  const index = buildCorrespondenceIndex<LegacyObservation>(catalogVolumes, legacy);
  const res = resolveCorrespondence<LegacyObservation>(index);

  const put = (o: LegacyObservation, bucket: BackfillBucket) => {
    counts[bucket]++;
    raw[bucket].push(coordOf(o));
  };

  // matched → RESOLVABLE (cada uno tiene exactamente 1 legado).
  for (const m of res.matched) put(m.legacy, "RESOLVABLE");
  // ambiguous → todos los tomos legados de la colisión.
  for (const a of res.ambiguous) for (const lo of a.legacy) put(lo, "AMBIGUOUS");
  // legacyOnly → refinar en los tres huérfanos.
  for (const lo of res.legacyOnly) {
    const s = lo.anilistId;
    if (!anchorHasEdition.has(s)) put(lo, "ORPHAN_NO_EDITION");
    else if (!anchorEditionKeys.get(s)?.has(lo.editionKey)) put(lo, "EDITION_KEY_MISMATCH");
    else put(lo, "ORPHAN_NO_VOLUME");
  }

  const examples = emptyExamples();
  for (const b of BACKFILL_BUCKETS) examples[b] = topExamples(raw[b]);

  const total = legacy.length;
  return { counts, total, examples, hasUnresolvable: total - counts.RESOLVABLE > 0 };
}

export function emptyAggregate(): ScanAggregate {
  return {
    total: 0,
    counts: emptyCounts(),
    examples: emptyExamples(),
    affectedUsers: 0,
    usersWithUnresolvable: 0,
  };
}

/** Acumula el resultado de un usuario. Usuarios sin colección (`total === 0`) NO cuentan como afectados. */
export function accumulate(agg: ScanAggregate, r: UserScanResult): void {
  if (r.total === 0) return;
  agg.affectedUsers++;
  if (r.hasUnresolvable) agg.usersWithUnresolvable++;
  agg.total += r.total;
  for (const b of BACKFILL_BUCKETS) {
    agg.counts[b] += r.counts[b];
    if (r.examples[b].length) agg.examples[b] = topExamples([...agg.examples[b], ...r.examples[b]]);
  }
}

/** Suma de buckets del agregado. */
export function bucketSum(agg: ScanAggregate): number {
  return BACKFILL_BUCKETS.reduce((s, b) => s + agg.counts[b], 0);
}

/** Verifica la invariante de cardinalidad. Lanza (falla explícito) si no cuadra. */
export function assertCardinality(agg: ScanAggregate): void {
  const sum = bucketSum(agg);
  if (sum !== agg.total) {
    throw new Error(`Invariante de cardinalidad rota: Σbuckets=${sum} ≠ total=${agg.total}`);
  }
}

/** Reporte determinístico en texto. Sin PII (los ejemplos son sólo coordenadas de catálogo). */
export function formatReport(agg: ScanAggregate, durationMs: number): string {
  const pct = (n: number) => (agg.total > 0 ? ((n / agg.total) * 100).toFixed(2) : "0.00");
  const sum = bucketSum(agg);
  const lines: string[] = [];
  lines.push("=== Dry-run de backfilleabilidad (read-only) ===");
  lines.push(`OwnedVolume analizados: ${agg.total}`);
  lines.push(`Usuarios afectados: ${agg.affectedUsers}  (con ≥1 no-resoluble: ${agg.usersWithUnresolvable})`);
  lines.push("");
  for (const b of BACKFILL_BUCKETS) {
    lines.push(`  ${b.padEnd(20)} ${String(agg.counts[b]).padStart(9)}  ${pct(agg.counts[b]).padStart(6)}%`);
  }
  lines.push(`  ${"Σ".padEnd(20)} ${String(sum).padStart(9)}   (== total: ${sum === agg.total})`);
  lines.push("");
  lines.push("Ejemplos por bucket (coordenadas de catálogo; sin PII):");
  for (const b of BACKFILL_BUCKETS) {
    if (agg.examples[b].length === 0) continue;
    lines.push(`  ${b}:`);
    for (const e of agg.examples[b]) lines.push(`    seriesKey=${e.seriesKey} editionKey=${e.editionKey} number=${e.number}`);
  }
  lines.push("");
  lines.push(`Duración: ${durationMs} ms`);
  return lines.join("\n");
}
