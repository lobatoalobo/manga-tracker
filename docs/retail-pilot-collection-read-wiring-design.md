# Fase 1 — Diseño técnico: cablear el read-side de colección a `/collection`

> **Objetivo:** que un tomo retirado en preventa (que crea un `OwnershipPosition` en el modelo Collection) **aparezca en la `/collection` del comprador**, sin romper la vista para los usuarios existentes (equivalencia con el modelo legado). Diseño; **sin implementar**.

## 0. Hallazgo que condiciona el diseño
El facade unificado `lib/collection-read/` (`getUserOwnership`) aporta **solo el eje de posesión semántica deduplicada** (qué tomos, poseídos o no, fusionando legado↔Collection). **NO aporta metadata**: títulos, portadas, autor, `upcoming`, `totalVolumes`, ni estado de lectura viven **únicamente** en el modelo legado (`Manga`/`TrackedEdition`), y para un tomo *collection-only* (pickup nuevo, sin fila legada) la metadata debe salir del **catálogo** (`Volume → PublisherEdition → Work`).

Por eso **NO es un reemplazo drop-in** de `getCollectionItems` (formas distintas: el legado agrupa por edición con `ownedVolumes: number[]` + metadata; el facade emite un `OwnershipItem` por tomo, sin metadata). El precedente ya en prod (Share, `getPublicCollection`, `lib/collection.ts:186`) confirma la estrategia: **mantener el item legado para grilla/stats y usar el facade solo para el eje de posesión**.

## 1. Estrategia elegida: **hidratación aditiva sobre la base legada**
Partir de la salida exacta de `getCollectionItems` (rica, agrupada por edición) y **agregar** solo los tomos *collection-only* (poseídos en Collection y ausentes del legado), hidratando su metadata desde el catálogo. Ventaja clave: **equivalencia por construcción** (si el usuario no tiene `OwnershipPosition`, no se agrega nada → salida idéntica a hoy) y **misma forma de salida** (`CollectionItem[]`) → `CollectionGrid` y `getCollectionStats` no cambian.

*(Alternativa descartada para el piloto: cutover total dirigido por el facade — reconstruir todos los items desde `OwnershipItem` re-joineando metadata. Es el Slice 9 completo; pierde estado de lectura/metadata rica salvo re-join total; mayor blast radius. Se difiere.)*

## 2. Archivos que cambiarían y responsabilidades
| Archivo | Cambio | Responsabilidad |
|---|---|---|
| **`lib/collectionUnified.ts`** *(nuevo)* | Nueva función `getCollectionItemsUnified(userId): Promise<CollectionItem[]>` | Orquesta: (a) `legacyItems = getCollectionItems(userId)`; (b) posesión unificada vía `ownershipReader().getUserOwnership(userId)` + `ownedItems()`; (c) detectar *collection-only* (poseídos cuya tripla no está en el legado); (d) hidratar su metadata del catálogo; (e) mergear al listado legado (agregando números a la edición existente o creando una nueva `EditionView`); devuelve `CollectionItem[]` con la **misma forma** que el legado. |
| **`lib/collectionUnified.ts`** (mismo) | Helper `hydrateCollectionOnly(volumeIds): Promise<Map<...>>` | Query catálogo `Volume` (por `volumeId`) → `PublisherEdition` (publisher, `key`, `totalVolumes`, `workId`/`anilistId`) → `Work` (title, author, cover). Construye `EditionView`/`CollectionItem` para los tomos nuevos (estado de lectura por defecto; `totalVolumes` de la edición del catálogo). Reusa enriquecimiento existente de `@/lib/catalog` (portada nacional, upcoming, autor) donde aplique. |
| **`app/collection/page.tsx`** | Reemplazar `getCollectionItems(session.user.id)` (`:19`) por `getCollectionItemsUnified(session.user.id)` | Único punto de reemplazo del piloto. `getCollectionStats(items)` (`:23`), filtros (`:25-34`) y `CollectionGrid` (`:91`) quedan **sin cambios** (misma forma). |
| **`lib/featureFlags.ts`** | Nuevo flag `UNIFIED_COLLECTION` (default off) | Gate de rollout/rollback: `/collection` usa la unificada solo si está prendido; si no, cae a `getCollectionItems`. |
| **`tests/collection-unified.integration.test.ts`** *(nuevo)* | Tests de integración | Ver §9. |

**No cambian:** `services/collectionService.ts` (`getCollectionStats` consume la misma forma), `components/CollectionGrid.tsx`, `lib/collection-read/**` (se consume tal cual), el esquema (todas las tablas ya existen → **sin migración**).

**Fuera de alcance del piloto (siguen en legado):** `components/Dashboard.tsx`, `lib/shopping.ts`, `app/api/export/route.ts`, `getSeriesNotifList` — se migran incrementalmente después para acotar blast radius.

## 3. Flujo completo de lectura (unificado)
```
getCollectionItemsUnified(userId)
 ├─ legacyItems = getCollectionItems(userId)             // rico, agrupado por edición (Manga/TrackedEdition/OwnedVolume) + covers/upcoming/autor
 ├─ ownership   = ownershipReader().getUserOwnership(userId)   // lib/collection-read: legacy adapter + collection adapter → correspondence → merge (Opción D)
 │     owned    = ownedItems(ownership)                  // solo owned; matched dedup: Collection autoritativo, legado suprimido
 ├─ legacyTriples = { (anilistId, edition.key, volNum) por cada tomo de legacyItems }
 ├─ collectionOnly = owned.filter(i => i.source==="collection" && (i.seriesKey,i.editionKey,i.number) ∉ legacyTriples)
 ├─ meta = hydrateCollectionOnly( collectionOnly.map(volumeId) )   // catálogo Volume→Edition→Work
 ├─ mergedItems = legacyItems + agrupar(collectionOnly, meta) por edición  // agrega números a edición existente o crea EditionView nueva
 └─ return mergedItems                                    // CollectionItem[] — misma forma que el legado
```

## 4. Interacción con `lib/collection-read`
- Entrada: `ownershipReader()` (`root.ts:30`) → `getUserOwnership(userId)` (`facade.ts:70`) → `ownedItems(view)` (`facade.ts:132`).
- El facade ya hace la **deduplicación** internamente (adapters legacy+collection → `resolveCorrespondence` → `mergeOwnership` Opción D): `matched` emite la unidad Collection y **suprime** el tomo legado homólogo; `collectionOnly`/`legacyOnly`/`ambiguous` se sirven según regla. Nosotros **no reimplementamos** dedup; lo consumimos.
- La clasificación *collection-only* para hidratar se computa en el wiring por **diferencia de triplas** contra el legado (no requiere tocar el facade). *(Opción futura: exponer la categoría por item en el DTO para no recomputar; no necesaria para el piloto.)*

## 5. Estrategia de deduplicación (anti-duplicado)
Regla exacta, en dos niveles:
1. **Nivel posesión (facade, ya existente):** un tomo presente en ambos modelos con la misma tripla `(seriesKey, editionKey, number)` es `matched` → el facade emite **una** unidad (Collection) y suprime la legada.
2. **Nivel wiring (aditivo):** partimos de `legacyItems` (que incluye el tomo `matched` como fila legada con su metadata) y **solo agregamos** los `collection-only` (triplas ausentes del legado). Como `matched` está en el legado, **no se agrega de nuevo** → sin duplicado. Un tomo nunca aparece dos veces: o está en el legado, o es collection-only agregado una vez.
- `ambiguous` (colisión de tripla, raro; improbable en un tomo de retail nuevo y limpio): **no se hidrata** en v1 (se mantiene solo la vista legada existente para no adivinar) → decisión conservadora documentada.

## 6. Garantía de equivalencia con el modelo legado
- **Por construcción:** `getCollectionItemsUnified` = `getCollectionItems` **+** collection-only. Para todo usuario **sin** `OwnershipPosition` (todos los actuales, pre-piloto), el adapter Collection devuelve `[]` → `collectionOnly = []` → salida **idéntica** a `getCollectionItems`.
- **Respaldo de test:** el invariante "facade == legado con Collection vacío" ya está probado (`tests/collection-read-equivalence.integration.test.ts`). Se suma un test que verifica que `getCollectionItemsUnified` == `getCollectionItems` cuando no hay posiciones, y que con una posición collection-only aparece exactamente un ítem nuevo sin alterar el resto.

## 7. Impacto sobre `/collection`
- Cambia **una línea** (`:19`) tras el flag. La grilla y los filtros (`region`, `totalVolumes`, `ownedVolumes.length`) siguen operando sobre `CollectionItem[]`.
- Los tomos de preventa retirados aparecen agrupados en su edición (nueva o existente). Para ediciones collection-only sin `TrackedEdition`, el **estado de lectura** es el por defecto y `totalVolumes` sale de `PublisherEdition`.
- Simplificación conocida: `quantity>1` en Collection colapsa a "poseído" en la grilla (la grilla es booleana por tomo). Aceptable para el piloto.

## 8. Impacto sobre stats y share
- **Stats (`getCollectionStats`):** **sin cambios de código**. Al recibir el `CollectionItem[]` unificado, `series`/`editions`/`ownedVolumes`/`totalVolumes`/`percentage` incluyen automáticamente los tomos nuevos. (Nota: `totalVolumes` de las ediciones collection-only proviene del catálogo.)
- **Share (`getPublicCollection`, `app/u/[slug]`):** ya usa el facade para el escalar `ownedVolumes` (`lib/collection.ts:186`) y el legado para `items`/`totalVolumes`. Queda **consistente** con `/collection` unificada. Opcional (fuera del piloto): migrar también los `items` de la share a la unificada para paridad total; no requerido.

## 9. Estrategia de testing
- **Unit/puro:** `hydrateCollectionOnly` (mapeo Volume→Edition→Work → EditionView; fallbacks de portada/título ausentes).
- **Integración (`tests/collection-unified.integration.test.ts`):**
  1. **Equivalencia:** usuario con solo legado → `getCollectionItemsUnified` == `getCollectionItems`.
  2. **Collection-only visible:** usuario con un `OwnershipPosition` de un `volumeId` sin legado → aparece exactamente un ítem nuevo con metadata del catálogo.
  3. **Matched sin duplicado:** tomo en legado **y** Collection (misma tripla) → aparece una sola vez.
  4. **Multi-edición/serie:** agrupación correcta; `getCollectionStats` sobre el resultado da conteos esperados.
  5. **Ambiguous:** no rompe; se mantiene la vista legada.
- **Regresión:** `npm run check` + `node scripts/identity-it.mjs` (incluye equivalence + retail + collection).
- **QA en staging:** Fase 9 del `docs/retail-pilot-qa-plan.md` (el comprador ve el tomo tras el pickup; sin duplicados; stats/share coherentes).

## 10. Performance esperada
- Consultas por carga de `/collection`: `getCollectionItems` (1 query + 3 lookups de enriquecimiento, ya existentes) **+** facade `getUserOwnership` (2 queries: `OwnedVolume` + `OwnershipPosition`) **+** `hydrateCollectionOnly` (1 query por el set de volumeIds nuevos). Neto ≈ **+3 queries**, todas indexadas y acotadas por el tamaño de la colección del usuario.
- Redundancia menor: `OwnedVolume` se lee dos veces (en `getCollectionItems` vía `Manga.include` y en el legacy adapter del facade). Aceptable para el piloto; optimización futura = un solo lector de posesión.
- Sin N+1: la hidratación es una query batch por `volumeId IN (...)`.

## 11. Riesgos
| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Cambio en el read path de `/collection` afecta a todos los usuarios | media | alto | **Aditivo + equivalencia por construcción** + **feature flag** `UNIFIED_COLLECTION` (rollout gradual) + test de equivalencia + QA staging |
| Metadata faltante para collection-only (cover/título/totalVolumes) | baja | medio | Fallbacks (título del snapshot/edición; portada placeholder); nunca romper la grilla |
| Doble conteo (matched) | baja | medio | Dedup en dos niveles (§5); test explícito |
| `ambiguous` mal servido | muy baja | bajo | v1 no hidrata ambiguous (conservador) |
| Estado de lectura ausente para ediciones nuevas | esperado | bajo | Por defecto; el usuario puede setearlo; documentado |
| Perf (+3 queries) | baja | bajo | Batch + índices; medir en staging |

## 12. Rollback
- **Feature flag:** apagar `UNIFIED_COLLECTION` → `/collection` vuelve a `getCollectionItems` inmediatamente, sin deploy (si el flag es runtime) o con un cambio mínimo.
- **Código:** al ser una **función nueva** + una línea conmutada, el rollback de código es revertir el PR (o el promote del deployment previo, por el proceso de release documentado).
- **Datos:** ninguno — es solo lectura; no escribe nada. `OwnershipPosition` ya existe y no se toca.
- **Sin migración** → sin rollback de esquema.

## 13. Resumen
Cablear "colección visible" = **hidratación aditiva**: base legada (rica) + tomos collection-only hidratados del catálogo, con dedup reusando el facade. Preserva equivalencia por construcción, mantiene la forma de salida (stats/grilla intactos), no toca esquema, y se protege con feature flag. Es una slice de **solo lectura**, de blast radius acotado a `/collection` en el piloto.
