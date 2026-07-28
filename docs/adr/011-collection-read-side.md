# ADR-011: Read-side de colección — Collection autoritativo con backstop `OwnedVolume` (Slice 9 / F1)

- **Estado**: **Aceptado** — Slice 9 = **solo F1** (read-side seam)
- **Fecha**: 2026-07-27
- **Relacionado**: [ADR-010](010-slice8-collection-projection.md) (Slice 8, Collection: `OwnershipPosition` + `Acquisition`); diseño completo en [docs/retail-slice-9-unified-collection-read-side.md](../retail-slice-9-unified-collection-read-side.md)
- **No modifica** Slice 8. **No introduce** dual-write, tablas nuevas ni feature flags.

---

## Contexto

La aplicación necesita **un único punto de lectura** para la colección del usuario mientras coexisten dos stores
**asimétricos**:

- **Legado `OwnedVolume`**: eje `Manga(userId, anilistId)` → `TrackedEdition(key:string)` → `OwnedVolume(volume:Int)`.
  Posesión **booleana**. Hoy es la fuente **completa** que alimenta toda la UI de colección (`lib/collection.ts`).
- **Collection (Slice 8)**: `OwnershipPosition(userId, catalogVolumeId)` + `Acquisition`. Posesión por **cantidad**.
  Hoy **parcial**: solo hechos `PICKED_UP` proyectados desde Retail.

"Unificar" no es fusionar dos iguales: es presentar el legado como base transitoria, dar autoridad a Collection
donde exista, y converger hasta que Collection sea la única fuente de *posesión*. El usuario nunca debe notar la
coexistencia. Aclaración de alcance: eliminar `OwnedVolume` = mover la **verdad de posesión**; `TrackedEdition`/
`Manga` (tracking/lectura/serie) **no** son posesión y sobreviven como capa aparte.

---

## Decisión (resumida)

Adoptar la **Opción D**: **Collection autoritativo, `OwnedVolume` como backstop transitorio por volumen**, con la
regla de lectura:

```text
Si existe OwnershipPosition para (userId, volumeId):
    usar Collection, INCLUSO si quantity = 0.
Si no existe OwnershipPosition:
    usar OwnedVolume como fallback transitorio.
```

Se **descarta** toda regla de OR/unión permanente. La selección es **por volumen** (no atómica por usuario), una
sola fuente responde por cada volumen, y ante contradicción **Collection gana y suprime** al legado para ese volumen.
La corrección descansa en la **invariancia de absorción** (ver §Invariantes). La autoridad se **deriva del dato**
(existe o no la fila `OwnershipPosition`), por lo que **no** se requiere marcador de migración, tabla ni flag.

Reglas complementarias cerradas:
- **Backfill** (fase posterior) = **establecedor de presencia, nunca aditivo** (no-op si ya hay posición).
- **Correspondencia ambigua → nunca se adivina** (se sirven los ítems independientes y el desajuste se registra).
- **Volumen no-mapeable → lo sirve el legado** (degradación elegante).
- **Discrepancias no cambian la salida visible**: se registran para reconciliación.
- **`Disposal` se secuencia antes** del cutover de escritura (precondición dura de la invariancia).

---

## Alcance de Slice 9 (F1) — read-side seam

**Incluye** (esta slice):
- API pública de lectura del read-side.
- Adapters para Collection y `OwnedVolume` (puerto común `OwnershipSource`).
- Correspondencia entre ambos ejes (función pura sobre columnas existentes).
- Core puro de composición con la **Opción D**.
- Reconciliación **observable** (reporte, sin tabla nueva).
- Integración progresiva de los consumidores de lectura actuales hacia el facade.
- Tests del read-side (correspondencia, merge, facade, reconciliación).

**No incluye** (slices independientes, cada una con su ADR/plan):
- Backfill legado → Collection.
- `Disposal` (reversa).
- Cutover de escritura a Collection.
- Modo Collection-only (dejar de leer el legado).
- Eliminación de `OwnedVolume`.

En F1 el comportamiento observable es **idéntico al actual**: Collection está casi vacío (solo pickups de Retail),
por lo que casi todos los volúmenes son *Collection-miss* y los sirve el legado. Escrituras **sin cambios**
(legado = escritor único de marcas manuales; Collection = Retail-only). **Sin dual-write.**

---

## Arquitectura (módulo)

Módulo único `lib/collection-read/` (nombra la **capacidad estable** "leer la colección", no la condición
transitoria de coexistencia). Hexagonal; **importa** a ambas fuentes y **nadie** lo importa salvo la capa app;
ninguna fuente importa a la otra; Retail no participa.

```text
lib/collection-read/
  facade          ← servicio de aplicación; orquesta y shapea a los DTOs existentes (CollectionItem/SeriesView)
  ports           ← OwnershipSource (interfaz de dominio: listOwned / ownedFor)
  adapters/       ← legacyOwnershipAdapter (→ lib/collection.ts) · collectionOwnershipAdapter (→ lib/collection-context/read.ts)
  mapping         ← correspondencia pura entre ejes (Volume ↔ coordenada legada); ambigüedad → "sin correspondencia"
  merge           ← composición pura, Opción D (selección por volumen, Collection gana)
  reconciliation  ← reporte observable de discrepancias / cobertura (sin tabla)
```

API pública (nombres provisionales; lo fijo es la **forma**): `getUserCollection`, `getUserSeries`,
`getPublicCollection`, `getPublicSeries` (preservan los DTOs actuales → migración transparente) + capacidades
nativas de Collection `getVolumeOwnership`, `getOwnershipHistory` (para tomos legacy-only degradan a
`quantity: owned?1:0` e historia vacía).

> **Nota de implementación (F1 entregado):** esta descripción era **exploratoria**. La entrega evolucionó durante
> los checkpoints 5–7 hacia un DTO **ownership-only** en vez de remodelar `CollectionItem`/`SeriesView`, y hacia una
> migración **por-consumidor** en vez de un swap de fachada. La forma real entregada se documenta en
> **§Implementación entregada (F1)**, que prevalece sobre este párrafo.

---

## Implementación entregada (F1)

Refleja el **comportamiento implementado** (no la propuesta inicial). Detalle por checkpoint en
[docs/retail-slice-9-unified-collection-read-side.md](../retail-slice-9-unified-collection-read-side.md) §13–§21.

- **DTO ownership-only.** La fachada (`createOwnershipReader(sources).getUserOwnership(userId): Promise<OwnershipView>`
  + proyección `ownedItems(view)`) produce `OwnershipItem = { id, source, owned, quantity, seriesKey, editionKey,
  number, ambiguous }` — **solo posesión**, sin metadata (títulos/portadas/`totalVolumes`/lectura). NO remodela
  `CollectionItem`/`SeriesView`.
- **Identidad persistida del DTO:** `id = "collection:<volumeId>" | "legacy:<ownedVolumeId>"` (nunca la tripla
  heurística de correspondencia). Ambiguos ⇒ ids distintos.
- **Autoridad `quantity = 0`:** un `matched` con `quantity = 0` **suprime** el tomo legado poseído (salida
  `owned:false`); Opción D aplicada por volumen.
- **Ambigüedad:** colisión de tripla ⇒ **nunca se adivina**; se sirven todas las unidades independientes (2 de
  Collection + las legadas), marcadas `ambiguous`, **sin deduplicación**.
- **Reconciliación observable:** `buildReconciliationReport` + `ReconciliationSink<L> = (report) => void |
  Promise<void>`, inyectable y opcional; la fachada lo `await`ea en `try/catch` ⇒ **best-effort** (el fallo del sink
  NO rompe la lectura; los errores de merge/adapters propagan **fail-fast** antes del sink). Sin tabla nueva (F1).
- **Primer consumidor migrado:** el stat **"Tomos poseídos"** de la Share pública (`app/u/[slug]` vía
  `getPublicCollection`), a través del composition root `lib/collection-read/root.ts`. Conteo = unidades con
  `owned === true` (posición, **no** Σ ejemplares). Metadata/grilla siguen del **camino legado** (convivencia
  temporal). El **porcentaje** visual usa `progressPercentage(ownedVolumes, totalVolumes)` con el **mismo** numerador
  unificado: `total <= 0 → 0` y **clamp de presentación a 100** (no altera el conteo real).
- **Observabilidad productiva:** **aún no conectada** por diseño (sin sink en producción); la capacidad existe y está
  validada solo en tests.
- **Superficie pública app-facing:** `ownershipReader`/`buildOwnershipReader` (root), `ownedItems` y los DTOs
  `OwnershipView`/`OwnershipItem` (facade). El resto (`correspondence`, `merge`, adapters, `ports`, `errors`,
  `reconciliation`) son building blocks **internos del módulo**.

---

## Invariantes

> **Invariancia de absorción del legado.**
> ```
> ∀ (userId u, volumeId v):
>     existe OwnershipPosition(u, v)
>        ⟹  nació de un hecho autoritativo (p.ej. pickup)
>         ∨  el backfill absorbió previamente la verdad legada de (u, v)
> ```
> **Corolarios:** la existencia de la fila = marcador implícito de autoridad; `quantity = 0` = afirmación **válida
> de no-posesión** (no "Collection no sabe"); regla de lectura `read(u,v) = position(u,v)` si existe, si no
> `legacy(u,v)`; **precondición dura de `Disposal`**: para toda posición que `Disposal` pueda llevar a 0, el
> corolario de absorción ya debe cumplirse.

**Invariantes de la coexistencia (F1):**
- Una sola fuente responde por volumen (nunca OR).
- Correspondencia ambigua no se colapsa ni se adivina.
- Las discrepancias se registran; no alteran la salida visible.
- El conjunto de volúmenes *Collection-miss* decrece **monótonamente** con el backfill (fases posteriores).

---

## Gates entre fases

**F1 → F2 (habilitar backfill):** seam en prod con regla D + **test de equivalencia verde** (Collection casi
vacío ⇒ salida = legado directo); reporte de **cobertura de correspondencia** (F0) estable.

**F2 → Disposal/cutover:** **invariancia de absorción cumplida para todas las posiciones afectadas** (nada capaz de
producir `q=0` antes de absorber la verdad legada de cada volumen que quede bajo autoridad de Collection); backfill
idempotente verificado; reconciliación sin violaciones de invariancia; `Disposal` implementada y testeada.

**Collection-only → eliminación de `OwnedVolume`:** conjunto de *Collection-miss relevantes* vacío;
**no-mapeables resueltos** (ver §"No-mapeable aceptable"); **gate de estabilidad** cumplido; export y vistas
públicas verificadas Collection-only.

### Gate de estabilidad (decisión cerrada)

```text
3 corridas completas consecutivas sin nuevas discrepancias críticas
```
- La secuencia se **reinicia** tras cualquier cambio en el algoritmo de mapping, backfill o reparación.
- Debe existir al menos **una corrida completa posterior** al último deploy o reparación relevante.
- Una corrida **parcial o detenida por presupuesto no cuenta**.
- Las discrepancias **conocidas y formalmente aceptadas** se distinguen de las **nuevas**.
- El gate **no reemplaza** los demás criterios funcionales de cada fase.

### No-mapeable aceptable (decisión cerrada)

No se define por porcentaje agregado (podría ocultar casos relevantes). Un registro no-mapeable es aceptable
**solo si**: (1) está inventariado individualmente; (2) su causa está clasificada; (3) no existe correspondencia
única y determinista; (4) el sistema no intenta adivinar el mapping; (5) sigue visible vía `OwnedVolume` durante la
coexistencia; (6) no bloquea una función crítica del usuario; (7) tiene una **resolución final explícita**
(corrección/ampliación del catálogo · conservación como excepción histórica · exclusión aprobada y documentada).

Objetivo para pasar a Collection-only: **`0` no-mapeables sin resolución**. Solo pueden permanecer excepciones
**aprobadas explícitamente** que no puedan representarse razonablemente en el catálogo actual, de bajo impacto,
inventariadas y con decisión documentada sobre su tratamiento final.

---

## Roadmap posterior (fuera de este ADR)

- **F0** — Reporte de cobertura de correspondencia (no destructivo). *Puede adelantarse; su ADR/plan es liviano.*
- **F2** — Backfill legado → Collection (canal `LEGACY_IMPORT`, establecedor de presencia). **ADR/plan propio.**
- **F3** — `Disposal` (reversa) + cutover de escritura a Collection; congela `OwnedVolume`. **ADR/plan propio.**
- **F4** — Modo Collection-only (el facade deja de consultar el legado para posesión).
- **F5** — Eliminación de `OwnedVolume` (drop de tabla + baja del adapter legado). `TrackedEdition`/`Manga` siguen.

---

## Consecuencias

**Buenas:**
- Punto único de lectura; la coexistencia es invisible para el usuario.
- Una sola fuente por volumen: sin muddle booleano-vs-cantidad, sin doble conteo.
- Autoridad derivada del dato ⇒ sin marcador de migración, tabla ni flag.
- Regla correcta ante contradicción, robusta a la llegada de `Disposal`.
- Convergencia monótona y legible; el backstop legado encoge hasta poder borrarse.
- Slice 8 intacto; F1 sin dual-write, sin cambios de escritura, comportamiento idéntico al actual.
- Arquitectura hexagonal aislada; Retail no participa (acoplamiento mínimo).

**Malas / costos:**
- La seguridad se **desplaza** del OR-en-lectura al par **backfill correcto + reconciliación** (F1 trae la
  reconciliación observable como guardia; el riesgo real aparece recién con backfill/`Disposal`).
- La **correspondencia** sigue siendo necesaria en lectura durante toda la coexistencia (heurística en el eje de
  edición); es la pieza más delicada y más testeada.
- Dos cargas por render (legado + Collection) + cómputo de correspondencia (mitigable; datos ya cargados).
- La invariancia de absorción es una **precondición dura** que acopla el orden de las fases (backfill antes de
  `Disposal`); un error de secuencia podría suprimir una verdad legada no absorbida.
- No-mapeables gestionados **caso por caso** (inventario + resolución explícita): más trabajo de curación que un
  umbral agregado, a cambio de no ocultar casos relevantes.

---

## Decisiones deliberadamente fuera de este ADR (diferidas a sus slices)

- **Semántica y mecánica exacta del backfill** (idempotencia, resumibilidad, key determinística, canal) → ADR/plan de F2.
- **Modelo de `Disposal`/reversa** (cómo se representa una baja: acquisition negativa, modelo aparte, etc.) → ADR/plan de F3.
- **Mecánica del cutover de escritura** y si requiere un kill-switch de reversibilidad → ADR/plan de F3.
- **Política final por-caso de cada no-mapeable** (qué se corrige en catálogo, qué se conserva, qué se excluye) → gestión de F4/F5.
- **`N` distinto de 3** o criterios de "discrepancia crítica" por tipo → afinado en F2+ si la operación lo exige.
- **Destino de `TrackedEdition`/`Manga`** (tracking/lectura) → trabajo separado, no forma parte de la eliminación de posesión.

---

## Alternativas consideradas (y por qué se descartaron)

- **Unión permanente (OR por volumen).** Muestra poseído si cualquiera de las fuentes lo afirma. **Descartada:**
  entrelaza ambas fuentes de forma permanente, mezcla semánticas booleano/cantidad en cada lectura, y —tras
  `Disposal`— mostraría como poseído un tomo del que el usuario se deshizo (regla incorrecta ante contradicción).
  Su única ventaja (defensa en profundidad ante un backfill con bug) se cubre con la reconciliación observable.
- **Fallback por-volumen sin invariancia (Opción B).** Idéntica a D en salida, pero sin la garantía de absorción se
  arriesga a que un `q=0` suprima una verdad legada no absorbida. **Descartada** en favor de D (misma regla + la
  invariancia que la hace segura).
- **Atómico por-usuario (Opción C).** Un usuario migrado se lee 100% de Collection; elimina la correspondencia en
  lectura. **Descartada:** exige marcador de migración por-usuario (roza "sin flags/tablas"), backfill atómico
  (un usuario no puede quedar a medias) y convierte cualquier tomo no-mapeable en un **bloqueo por-usuario**. D
  degrada con gracia (el legado sirve lo no-mapeable) sin marcador.

---

## Checkpoints de implementación propuestos para F1

Cada checkpoint frena para revisión (patrón de los slices previos). Sin dual-write, sin tocar Slice 8, sin escritura.

1. **Correspondencia (dominio puro).** (a) **Extracción de `publisherKey`** a un módulo puro compartido
   (`lib/publisher-key.ts`), del que dependen **tanto** la escritura legada (`lib/collection.ts`) **como** la
   correspondencia — **fuente única**, no dos mapas sincronizados por test. (b) Pipeline en tres pasos:
   `deriveCatalogKey`/`deriveLegacyKey` → **`buildCorrespondenceIndex`** (agrupa por tripla, detecta colisiones;
   reutilizable por reconciliación, cobertura, backfill y auditoría **sin** correr la resolución) →
   **`resolveCorrespondence(index)`** (clasifica en matched/collectionOnly/legacyOnly/unmappableCatalog/ambiguous;
   ambigüedad → nunca adivina). Unit tests del dominio + test de contrato de `publisherKey`. Frenar.
   **NO** avanzar a adapters ni fachada hasta aprobar este checkpoint.
2. **Puerto + core de merge (dominio puro).** `OwnershipSource` y `mergeOwnership` con la Opción D (selección por
   volumen, Collection gana, `q=0` = no poseído). Casos de verdad como unit tests. Frenar.
3. **Adapter Collection.** `collectionOwnershipAdapter` sobre `lib/collection-context/read.ts` (Slice 8, sin tocar),
   normalizando al puerto. Integración. Frenar.
4. **Adapter legado.** `legacyOwnershipAdapter` sobre `lib/collection.ts`, normalizando al puerto. Integración. Frenar.
5. **Facade + DTOs.** Compone adapters + merge y shapea a `CollectionItem`/`SeriesView`; añade
   `getVolumeOwnership`/`getOwnershipHistory`. **Test de equivalencia** (Collection vacío ⇒ salida = legado directo).
   Frenar.
6. **Reconciliación observable.** Reporte de discrepancias/cobertura (sin tabla), distinguiendo nuevas de aceptadas.
   Frenar.
7. **Integración progresiva de consumidores.** Migrar los lectores actuales (`app/collection`, `app/u/[slug]`,
   `Dashboard`, `app/api/export`, público/compartir, `collectionService`) al facade, uno por uno, verificando
   equivalencia en cada paso. Frenar.
8. **Cierre F1.** `npm run check` + harness completo; doc de slice + estado del ADR a Aceptado; sin push. Frenar.
