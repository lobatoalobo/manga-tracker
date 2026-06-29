# Taxonomía de mutaciones (mapeo del espacio real)

Paso analítico, no de diseño: mapear las mutaciones existentes a **familias de
operación** (geometría) y ver si el Mutation Framework cubre el espacio o si aparece
una forma nueva (señal arquitectónica). Fuente: ~36 scripts de `scripts/*` que
escriben + las operaciones de `lib/*`.

## Las familias

| # | Familia | Geometría | Idempotencia | Circuit-breaker | Invariante clave | Estado |
|---|---|---|---|---|---|---|
| 1 | **Graph rewrite** (merge) | reescribe FKs + reconcilia identidad + borra 1 nodo | por clave (direccional) | `maxDeletes: 1` | `sameSeries`/`titlesAgree` | ✅ `mergeWork` |
| 2 | **Cascade prune** (delete) | borra nodo + toda su data dependiente | por clave | `maxDeletes: 1` | `workDomainKey` | ✅ `deleteWork` |
| 3 | **Set reduction** (cleanup) | descubre set sucio en runtime, borra subset | inherente (re-detecta) | `maxDeletes: N` | `canonicalEdition` | ✅ `cleanRedundantEditions` |
| 4 | **Attribute enrich/backfill** | `update` bulk de campos en nodos existentes; **sin cambio de topología** | inherente (overwrite) | `maxUpdates: N` | **no pisar campos curados** | ✅ `normalizeGenres` |
| 5 | **External sync/reconcile** | converge local ↔ fuente externa: create + update + delete juntos | convergencia | mixto (c/u/d) | curated + identidad externa | ⏳ no migrada |
| (6) | **Reset/bulk-state** | wipe + reinicializa estado (notifs, preventa, staging) | n/a | `maxDeletes` alto | — (entornos no-prod) | ⏳ variante destructiva |

## El hallazgo: el espacio NO estaba cerrado en 3

Las 3 familias validadas son **todas estructurales/destructivas** (rewrite, prune,
reduction). Pero la **mayoría** de las mutaciones reales (~20 de 36) son **familia 4
(enrich/backfill)** — un solo verbo `.update`, geometría distinta: no toca topología,
el "plan" es una lista de *patches de campos*, idempotente por overwrite, sin deletes.
Y `crawl`/`recrawl-ivrea`/`import-whakoom` son **familia 5 (sync)** — la más compleja:
create+update+delete en una pasada para igualar una fuente externa.

Scripts por familia (4 y 5, las nuevas):

- **Enrich (4)**: `backfill-*` (authors/synopsis/works), `*-covers` (covers-tomo1,
  enrich-covers, ivrea-covers, whakoom-covers, migrate-covers-r2), `curate-genres`,
  `normalize-genres`, `enrich-whakoom`, `classify-publisher`, `reading-links`,
  `translate-synopses`, `fix-whakoom-counts`, `fix-broken-maps`, `fix-entities`.
- **Sync (5)**: `crawl`, `recrawl-ivrea`, `refresh-ivrea-empty`, `import-whakoom`,
  `auto-map`, `fix-ivrea-urls`.

## ¿Hay señal de rediseño? No — pero sí de consolidación

La **forma** del framework absorbe las 5 sin rediseño:

- `affected: {creates, updates, deletes}` **ya** anticipa la familia 5 (sync). No fue
  casualidad.
- El `MutationPlan<P>` genérico aguanta tanto un patch-list (4) como un 3-way diff (5).
- El circuit-breaker pasa de `maxDeletes` a `maxUpdates` sin tocar el core (es
  operacional, no semántico).

Lo que SÍ aparece es un **invariante nuevo de la familia enrich**: *"no pisar campos
editados a mano (curados)"*. Hoy está disperso y re-implementado en **5 archivos**
(`enrichWorks`, `whakoomImport`, `ivreaProximas`, `vizImport`, `authorMerge`). Es el
próximo `titlesAgree`/`workDomainKey`: un invariante que debe vivir UNA vez en
`lib/domain/work/*` y que la familia 4/5 consume.

## Resultado: familia 4 migrada (`normalizeGenres`) — encaja sin rediseño

Representante: `normalizeGenres` (rawGenres → genres canónicos + demografía). Bulk,
sin I/O externo, PATCH-only. Hallazgos:

- **PATCH-only en el mismo chasis**: el plan es una lista de patches de campos
  (`GenrePatch[]`); preview hace **field diff**, no graph diff. Cero ramas nuevas.
- **`maxUpdates` es operacional, no fino**: en enrich de catálogo completo la 1ª
  corrida toca muchas obras → el breaker es un TECHO de cordura, no un guard 1:1 como
  `maxDeletes`. Confirma que el circuit-breaker mide magnitud, no semántica.
- **Invariante curated consolidado**: era el primer invariante TRANSVERSAL
  (cross-entity attribute protection), disperso en 5 archivos. Ahora vive una vez en
  `lib/domain/work/curated.ts` (`isCurated`/`dropCuratedFields`/`markCurated`) y lo
  usan la mutación nueva + `enrichWorks`/`whakoomImport`/`authorMerge`. Es un
  *mutation constraint primitive* del dominio, no del framework.

### La pregunta de fondo: ¿el modelo distingue mutación estructural de semántica?

**Sí — y la distinción YA estaba en el modelo, no hizo falta una "mutation type
algebra".** Se expresa con dos campos que la operación declara y el framework no
interpreta:

- `irreversible`: estructural/destructiva (merge/delete/cleanup) = `true`; semántica
  (enrich) = `false`. Primer caso con `irreversible: false`.
- la forma de `affected`: las estructurales tienen `deletes`; las semánticas solo
  `updates`; la familia 5 (sync) usará los tres.

El framework sigue siendo **operacional** (cuenta y limita), el dominio aporta el
**significado** (irreversibilidad, curated). No hace falta nueva abstracción: el
espacio queda **cerrado en 5 familias sobre un solo chasis**. El único "unknown
unknown" que resta es la familia 5 (sync, 3-way diff vs fuente externa); si algo va a
tensionar el preview determinista, es ahí.

## Cierre del framework + el borde formal (decisión)

**El Mutation Framework se cierra acá.** Cubre el espacio de **mutaciones internas
deterministas** (familias 1–4 + variante reset): el sistema es la autoridad única, el
input es explícito y el `preview` es **función pura del estado actual de la DB**. Eso
ya está probado, consistente y generalizado. La familia 5 **NO se construye como
extensión del core** — sería otro problema y degradaría la propiedad más valiosa
lograda (previsibilidad total).

El borde que mantiene esto finito:

| | **Mutation system** (este framework) | **Ingestion / reconciliation system** (aparte, no construido) |
|---|---|---|
| Autoridad | la DB es la verdad única | una fuente EXTERNA es (parte) autoridad |
| Input | explícito, determinista | no determinista (red, parcial, cambiante) |
| `preview` | función pura del estado interno | no puede serlo (depende de la fuente externa) |
| Identidad | dada | hay que RESOLVERLA ("existe pero no coincide") |
| Familias | 1–4 (+reset) | 5 (sync/crawl/import) |

**El contrato del borde**: una corrida de ingestión RESUELVE la verdad externa hasta
un plan determinista y **emite mutaciones discretas que pasan por el framework** (ej.
un crawl que decide "fusionar estas dos obras" → invoca `mergeWork`). La ingestión se
sienta ARRIBA del core de mutaciones; **el framework nunca sale al mundo** y **la
ingestión nunca bypassea la seguridad del framework** para lo que escribe. Ese
contrato es lo que evita que la arquitectura se vuelva infinita: el no-determinismo
queda confinado a la capa de ingestión y nunca entra al core.

Hoy `crawl`/`import` mezclan reconciliación + escritura. Cuando se formalice la
familia 5, se separa: *ingestión resuelve → emite mutaciones → framework ejecuta*.
No ahora — esto es solo el borde, no código.
