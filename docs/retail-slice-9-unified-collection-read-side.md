# Slice 9 — Read-side unificado de colección (propuesta de diseño)

- **Estado**: Diseño **cerrado** → formalizado en [ADR-011](adr/011-collection-read-side.md) (Slice 9 = solo F1)
- **Fecha**: 2026-07-27
- **Depende de**: Slice 8 (Collection: `OwnershipPosition` + `Acquisition`, ADR-010). No la modifica.
- **Decisión arquitectónica**: Opción D (Collection autoritativo + backstop `OwnedVolume` por volumen). Las cuatro
  decisiones abiertas del §12 quedaron cerradas en el ADR-011 (alcance = F1, módulo `lib/collection-read/`, gate de
  estabilidad = 3 corridas, no-mapeable por-caso). Este doc conserva el análisis completo; el ADR es el registro normativo.

---

## 1. Contexto y el problema real

La aplicación debe tener **un único punto de lectura** para la colección del usuario. Durante la
migración coexisten dos fuentes que **no son simétricas**:

| | **Legado (`OwnedVolume`)** | **Collection (Slice 8)** |
|---|---|---|
| Eje de identidad | `Manga(userId, anilistId)` → `TrackedEdition(key:string)` → `OwnedVolume(volume:Int)` | `OwnershipPosition(userId, catalogVolumeId)` + `Acquisition` |
| Ancla | AniList id (y `-workId` para obras locales) + `key` de editorial (string) | `Volume` del catálogo (`PublisherEdition` → `Work`) |
| Semántica de posesión | **Booleana** (tenés el tomo N, o no) | **Cantidad** (0..n; puede ser >1) |
| Cobertura hoy | **Completa**: alimenta toda la UI de colección (series, ediciones, lectura, tomos, export, compartir) | **Parcial**: solo hechos `PICKED_UP` proyectados desde Retail |
| Rol | Fuente primaria actual | Objetivo de la migración |
| Trae además de posesión | Sí: `readingStatus`, `readingVolume`, tracking de ediciones, `totalVolumes` | No: solo posesión + ledger histórico |

**Consecuencia de diseño (la que ordena todo el resto):** "unificar" **no** es "fusionar dos iguales".
Es **presentar el legado como base, superponer Collection donde los ejes se corresponden, y converger con
el tiempo** hasta que Collection sea la única fuente de *posesión*. El usuario nunca debe notar la coexistencia.

**Aclaración de alcance sobre "eliminar `OwnedVolume`":** `OwnedVolume` (el set de tomos poseídos) es lo
que Collection reemplaza. `TrackedEdition` / `Manga` (estado de lectura, ediciones trackeadas, título,
portada) **no** son posesión y **no** los reemplaza Slice 8; sobreviven como capa de *tracking/serie*
(su migración, si ocurre, es trabajo aparte). Eliminar `OwnedVolume` = mover la **verdad de posesión** a
`OwnershipPosition`, dejando que `TrackedEdition` derive su set de tomos poseídos desde el read-side unificado.

---

## 2. El puente entre ejes (la correspondencia) — el núcleo de la slice

Para deduplicar y unir, un `Volume` del catálogo debe poder mapearse a la coordenada legada
`(anilistId | -workId, editionKey, tomo)` y viceversa. Con las columnas **ya existentes** (sin tablas nuevas):

```
catalog Volume(id, number, editionId)
   └─ PublisherEdition(anilistId?, workId?, publisher)
        ├─ join de serie:  anilistId  (o  -workId  cuando anilistId es null → obra local,
        │                                convención que el legado YA usa: lib/collection.ts)
        ├─ join de edición: publisher → editionKey   (heurística PURCHASE_PUBLISHER_KEY / chooseRow)
        └─ join de tomo:    Volume.number == OwnedVolume.volume
```

Propiedades que el diseño debe asumir explícitamente:

- **Es parcial.** No todo `Volume` tiene `PublisherEdition.anilistId`/`workId`; no toda `TrackedEdition`
  tiene una `PublisherEdition`/`Volume` del catálogo (imports manuales, ediciones sin catálogo).
- **Es heurística en el eje de edición.** `publisher → key` (`purchaseKey`/`chooseRow`) **no es biyectiva**.
- **Regla dura ante ambigüedad:** si la correspondencia no es unívoca, se trata como **"sin correspondencia"**
  (las dos entradas se muestran de forma independiente y el desajuste se **registra**), nunca se adivina.
- **Preferir identidades fuertes** cuando existan (`workId`, `whakoomId`) sobre el string de editorial.

La correspondencia se implementa como **función pura** sobre datos de catálogo ya cargados, centralizada en
**un** lugar. Es la pieza más testeada de la slice.

---

## 3. API pública (§ pedido 1)

La API se moldea por los **consumidores** (lo que la app ya renderiza), no por los stores. Así la coexistencia
es invisible: las pantallas siguen recibiendo los mismos DTOs (`CollectionItem`, `SeriesView`) que hoy produce
`lib/collection.ts`.

```
getUserCollection(userId)            → CollectionItem[]     // reemplaza getCollectionItems (base de /collection)
getUserSeries(userId, seriesRef)     → SeriesView | null    // reemplaza getSeries (ficha de serie)
getPublicCollection(shareSlug)       → { name, items, favoriteId } | null   // compartir (solo lectura)
getPublicSeries(shareSlug, seriesRef)→ { ownerName, series } | null

// Capacidades NATIVAS de Collection que el legado no puede responder (valor nuevo, retro-compatible):
getVolumeOwnership(userId, volumeRef)  → { owned: boolean, quantity: number, source: "collection"|"legacy"|"both" }
getOwnershipHistory(userId, volumeRef) → AcquisitionView[]  // ledger; vacío para tomos legacy-only
```

**Justificación:**
- Las primeras cuatro **preservan los DTOs existentes** → los consumidores (`app/collection`, `app/u/[slug]`,
  `Dashboard`, `app/api/export`, `collectionService`) no cambian de forma; solo cambian el *import* de origen.
  Esa es exactamente la propiedad que hace la migración transparente.
- `getVolumeOwnership` / `getOwnershipHistory` exponen lo que **solo** Collection tiene (cantidad, dupes,
  procedencia por adquisición). El legado es booleano y sin historia: para tomos legacy-only devuelven
  `quantity: owned ? 1 : 0` y `history: []`, sin romper el contrato.
- Las estadísticas (`getCollectionStats`, `editionProgress` en `collectionService.ts`) siguen operando sobre
  `CollectionItem[]` **sin cambios**, porque el read-side les entrega la misma forma.

Los nombres son provisionales; lo fijo es la **forma** (mismos DTOs) y las **dos capacidades nuevas**.

---

## 4. Arquitectura (§ pedido 2) — Hexagonal, un módulo

Facade de aplicación + puerto/adaptadores + núcleo puro de merge. Un solo módulo nuevo, provisionalmente
`lib/collection-read/` (application read-model). **Importa** a ambas fuentes; **nadie** lo importa salvo la capa
app. Ninguna fuente importa a la otra ni al facade → las flechas de dependencia quedan sanas y Retail no participa.

```
app/* (pages, export, share)
      │  (única capa que llama al read-side)
      ▼
lib/collection-read/            ← Facade / servicio de aplicación (orquesta, shapea a CollectionItem/SeriesView)
      ├─ port  OwnershipSource  ← interfaz de dominio (puerto)
      ├─ adapter  legacyOwnershipAdapter      →  lib/collection.ts        (OwnedVolume/TrackedEdition/Manga)
      ├─ adapter  collectionOwnershipAdapter  →  lib/collection-context/read.ts (OwnershipPosition/Acquisition)
      ├─ domain  correspondence(...)          ← función pura (Volume ↔ coordenada legada), lib/domain/collection-read
      └─ domain  mergeOwnership(...)           ← función pura (dedup + unión + overlay de cantidad)
```

**Responsabilidades:**
- **Puerto `OwnershipSource`** (dominio): `listOwned(userId) → NormalizedOwnership[]`, `ownedFor(userId, ref)`.
  Normaliza cada fuente a un hecho de posesión común `{ correspondenceKey, owned, quantity, source }`.
- **Adaptadores** (infra): cada uno traduce **su** store al puerto. El legacy adapter reusa `lib/collection.ts`;
  el collection adapter reusa `lib/collection-context/read.ts` (Slice 8, **sin tocar**). Un adaptador no conoce al otro.
- **`correspondence`** (dominio puro): mapea identidades entre ejes; ante ambigüedad devuelve "sin correspondencia".
- **`mergeOwnership`** (dominio puro): recibe los hechos normalizados de ambas fuentes + la correspondencia y
  produce la vista unificada. Prisma-free, 100% testeable en unit.
- **Facade** (aplicación): carga de ambos adaptadores, corre el merge puro, y **shapea** al DTO que el consumidor
  espera. Es el único acoplamiento entre contextos, y vive en la capa de orquestación (igual criterio que el seam
  de Slice 8 en `handoffActions.ts`).

Esto respeta DDD (lenguaje ubicuo: Collection/OwnershipPosition/Acquisition), Hexagonal (puerto+adaptadores+core
puro), Vertical Slice (una feature: leer la colección unificada) y Modular Monolith (un módulo, sin servicios nuevos).

---

## 5. Estrategia de lectura (§ pedido 3) — **Opción D: Collection autoritativo, legado como backstop por volumen**

**Regla definitiva** (reemplaza toda estrategia de unión permanente):

```text
Si existe OwnershipPosition para (userId, volumeId):
    usar Collection, INCLUSO si quantity = 0.
Si no existe OwnershipPosition:
    usar OwnedVolume como fallback transitorio.
```

Por cada render de colección, el facade:

1. **Lee ambas** fuentes por `userId` (la query legada actual `getCollectionItems`, ya optimizada, y la lectura
   Collection indexada por `userId` `getUserPositions`, Slice 8).
2. Calcula la **correspondencia** sobre los datos de catálogo ya cargados (§2). Sigue siendo necesaria durante la
   coexistencia: es lo que permite saber, para un tomo legado, si Collection **ya tiene** su `Volume`
   correspondiente (y entonces el legado no se consulta para ese volumen).
3. **Selecciona la fuente por volumen** (no fusiona valores): Collection-hit → Collection; Collection-miss → legado.

Reglas de **cuándo** manda cada fuente:
- **Collection es autoritativo.** Si existe la fila `OwnershipPosition` para `(userId, volumeId)`, su respuesta es
  la que se usa — **también cuando `quantity = 0`** (afirmación válida de *no posesión*, típicamente post-`Disposal`;
  **no** significa "Collection no sabe"). El legado **no participa** para ese volumen.
- **El legado es un backstop transitorio.** Solo responde donde Collection **calla** (no hay fila): la mayoría de
  los volúmenes durante la coexistencia, más el andamiaje de serie/edición/lectura que Collection no modela
  (`TrackedEdition`), fuera del alcance de posesión.
- **No hay OR.** El set de posesión mostrado se arma **eligiendo una fuente por volumen**, nunca combinando la
  respuesta de ambas para un mismo volumen.

No hay lectura "condicional por flag": la autoridad se **deriva del dato** (existe o no la fila `OwnershipPosition`).
No necesita marcador de migración, tabla nueva ni feature flag (ver §12 restricciones y la invariancia del §7).

---

## 6. Duplicados (§ pedido 4)

Un `Volume` que existe en ambas fuentes (correspondencia unívoca) se muestra **una sola vez**, porque bajo D
**una sola fuente responde por volumen**:

- **Clave de selección** = la identidad de correspondencia (no el id de fila de cada store). Por cada clave, si
  Collection tiene fila → responde Collection y el legado se **descarta** para ese volumen; si no, responde el legado.
  El mismo tomo nunca se cuenta dos veces porque nunca lo aportan las dos fuentes a la vez.
- **Prioridad = Collection, absoluta ante contradicción.** Ya no es "prioridad solo como store": si Collection tiene
  fila, **su respuesta gana y suprime** la del legado para ese volumen (incluida `quantity = 0`). Esto es correcto,
  no peligroso, por la invariancia de absorción del §7 (una fila Collection ya absorbió la verdad legada).
- **Por qué Collection gana:** es el modelo hacia adelante (ledger-backed, con historia, alimentado por Retail y
  objetivo de la migración) y, por la invariancia, cada fila suya es autoritativa. El legado es el que se apaga.

---

## 7. Contradicciones, invariancia de autoridad y discrepancias (§ pedido 5)

El legado es **booleano** y Collection es **cantidad**. Ante contradicción, **Collection gana** (§6). La
corrección de esa regla descansa en una invariancia:

> **Invariancia de absorción del legado.** Una `OwnershipPosition` para `(userId, volumeId)` solo puede existir si
> (a) nació de un hecho autoritativo (p.ej. un pickup de Retail), **o** (b) el backfill ya absorbió la verdad legada
> de ese volumen. Por lo tanto, **la existencia de la fila es el marcador implícito de autoridad**, y un
> `quantity = 0` es una afirmación válida de *no posesión*, nunca un "Collection no sabe".

Consecuencias:
- **Cantidad / dupes / historia:** las aporta **solo** Collection (para volúmenes Collection-hit). Un volumen
  servido por el legado es booleano: "poseído" ⇒ se presenta como 1, sin historia.
- **Qué ve el usuario:** "poseído / no poseído" de forma estable, sin señales de discrepancia. La coexistencia es
  invisible: **las discrepancias no cambian la salida visible**.
- **Qué se registra:** todo **desajuste** entre lo que Collection afirma y lo que el legado tenía (p.ej. un volumen
  Collection-hit con `quantity = 0` cuyo legado correspondiente estaba marcado como poseído, o una correspondencia
  que no cierra) lo captura un **reporte de reconciliación** (mismo espíritu que la auditoría de Slice 8, **sin tabla
  nueva**). Alimenta el backfill, verifica la invariancia y expone huecos de mapeo de catálogo. **No** es un error
  de cara al usuario ni altera la lectura.

Convergencia = por **backfill** (§8 Fase 2): a medida que absorbe verdad legada, el conjunto de volúmenes
Collection-miss (los que aún sirve el legado) **se reduce de manera monótona** hasta vaciarse.

---

## 8. Plan de migración incremental (§ pedido 6) — hasta eliminar `OwnedVolume`

El read-side es estable en todo el recorrido: **siempre aplica la regla D** (Collection-hit → Collection;
Collection-miss → legado); lo que cambia debajo es *cuántos volúmenes son Collection-hit* (crece monótonamente).
No hay dual-write en ninguna fase (siempre hay un único escritor de posesión).

**Fase 0 — Cobertura de correspondencia (no destructiva).**
Reporte: cuántas filas `OwnedVolume` mapean a un `Volume` del catálogo; enumerar huecos (obras/ediciones sin
catálogo, keys ambiguas). Métrica-gate para las fases siguientes. No escribe nada.

**Fase 1 — Read-side seam (esta slice).**
Introducir el facade que aplica la regla D y **migrar todos los consumidores de lectura** hacia él. Comportamiento
idéntico al actual porque Collection está casi vacío (solo pickups de Retail) ⇒ casi todos los volúmenes son
Collection-miss ⇒ los sirve el legado. **Escrituras sin cambios** (el legado sigue siendo escritor único de las
marcas manuales; Collection sigue siendo Retail-only). **Sin dual-write.** Esto es lo que este documento pide
diseñar; las fases 2+ son slices posteriores que el seam habilita.

**Fase 2 — Backfill legado → Collection (una vez, idempotente, resumible).**
Proyectar cada `OwnedVolume` **mapeable** como una `Acquisition` de canal `LEGACY_IMPORT` a través del `apply` de
Slice 8 (acquisitionKey determinística, p.ej. `legacy:<userId>:<volumeId>`; **sin tabla nueva**, la procedencia va
en `channel`). **Decisión crítica — el backfill es *establecedor de presencia*, no *aditivo*:** el hecho legado es
"posee ≥1 de este tomo"; si ya hay una posición (p.ej. por un pickup previo), el backfill es **no-op**, no
incrementa. Así `quantity` sigue reflejando copias reales (un tomo comprado por Retail y además marcado a mano = 1
copia, no 2). Tras esta fase Collection contiene todo lo que el legado tenía (y era mapeable); el reporte de
reconciliación se reduce a lo no-mapeable. La salida en pantalla no cambia (los volúmenes recién absorbidos pasan
de "servidos por el legado" a "servidos por Collection" con la misma respuesta; idempotente, seguro).

**Fase 3 — Cutover de escritura (el escritor único se muda a Collection).**
Las escrituras de posesión del usuario (`toggleVolume`, `setAllVolumes`, `setVolumesUpTo`,
`addPurchaseItemToCollection`, `importEdition`) dejan de escribir `OwnedVolume` y pasan a escribir
`Acquisition`/`OwnershipPosition` (canal `MANUAL`, con **reversa** para el destoggle — depende de la capacidad
`Disposal` diferida de Slice 8; ver §9 y §10). Sigue habiendo **un solo escritor** (no dual-write): `OwnedVolume`
queda **congelado / read-only**. Este es el punto en que `OwnedVolume` **deja de recibir escrituras**. Único lugar
donde un interruptor controlado (deploy, o a lo sumo un kill-switch) se justifica por reversibilidad.

**Fase 4 — Simplificación de lectura.**
Verificados backfill + cutover y con reconciliación en drift = 0 durante N ciclos de cron, el facade **deja de
consultar el adaptador legado** para posesión (lee solo Collection). El adaptador legado queda únicamente para la
capa de tracking/serie/lectura (`TrackedEdition`/`Manga`), fuera del alcance de posesión.

**Fase 5 — Eliminación.**
Cumplidas las condiciones (§9), se **borra la tabla `OwnedVolume`** (migración) y se elimina el adaptador de
posesión legado. `TrackedEdition`/`Manga` sobreviven como capa de tracking (su destino es trabajo aparte).

---

## 9. Eliminación del legado (§ pedido 7)

`OwnedVolume` **deja de participar** en tres momentos distintos:
- **Escrituras:** en Fase 3 (cutover) — congelado.
- **Lecturas:** en Fase 4 — el facade lo ignora para posesión.
- **Existencia (drop):** en Fase 5.

**Condiciones antes de borrar (todas):**
1. Backfill completo y verificado idempotente.
2. Cutover de escritura en vivo y estable.
3. Reconciliación con **drift = 0** para filas mapeables durante N ciclos de cron consecutivos.
4. **Filas no-mapeables = 0**: los huecos de catálogo se cerraron (enriquecimiento) o se resolvieron con decisión
   explícita. Nunca se borra una fila cuya verdad no esté representada en Collection.
5. Existe la capacidad de **reversa** (`Disposal`) para que el destoggle funcione post-cutover.
6. Export y vistas públicas verificadas contra lecturas Collection-only.

### 9-bis. Gates entre fases (condiciones de avance)

**Gate F1 → F2 (habilitar backfill):**
- Read-side seam en producción aplicando la regla D, con **test de equivalencia verde** (con Collection casi vacío,
  la salida iguala a la del legado directo).
- Reporte de **cobertura de correspondencia** (Fase 0) disponible y estable: se conoce el universo mapeable y el
  no-mapeable.

**Gate F2 → Disposal/cutover (habilitar escritura sobre Collection y reversa):**
- **Invariancia de absorción cumplida para todas las posiciones afectadas** (§7): antes de que exista cualquier
  operación capaz de producir `quantity = 0` (`Disposal`), el backfill ya absorbió la verdad legada de **todo**
  volumen que vaya a quedar bajo autoridad de Collection. Sin esto, un `0` podría suprimir una verdad legada no
  absorbida. Es la precondición dura de `Disposal`.
- Backfill idempotente verificado; reconciliación sin violaciones de invariancia (no hay Collection-hit `quantity 0`
  cuyo legado correspondiente estuviera poseído sin haber sido absorbido).
- Capacidad de **reversa** (`Disposal`) implementada y testeada (el destoggle post-cutover tiene equivalente).

**Gate Collection-only → eliminación de `OwnedVolume` (Fase 4 → Fase 5):**
- El conjunto de volúmenes **Collection-miss relevantes** (los que aún sirve el legado y portan verdad de posesión)
  está **vacío**: no quedan fallbacks relevantes.
- Los **no-mapeables** están en `0`, o todos caen dentro de una **política aceptada** explícita (§9.4).
- Reconciliación con drift = 0 durante `N` ciclos (§12 decisión abierta 3); export y vistas públicas verificadas
  Collection-only.
- Solo entonces se dropea la tabla y se elimina el adaptador de posesión legado.

---

## 10. Riesgos (§ pedido 8)

| Riesgo | Escenario que rompe | Mitigación |
|---|---|---|
| **Correspondencia parcial/lossy** | `OwnedVolume` no mapeable no se puede backfillear → elimina bloqueada o pérdida de datos | Reporte de cobertura gatea cada fase; **nunca** borrar lo no-mapeado; enriquecimiento de catálogo como prerrequisito de Fase 5 |
| **Mismatch semántico (booleano vs cantidad)** | Doble conteo, o suprimir indebidamente una marca legada | Regla D (una sola fuente por volumen, Collection gana ante contradicción); la supresión es *correcta* por la invariancia de absorción (§7); backfill establecedor-de-presencia (no aditivo) |
| **Collection suprime una verdad legada NO absorbida** (invariancia violada: fila `quantity 0` sin backfill previo del legado correspondiente) | Un tomo legado-poseído desaparece de la vista | Ordenar backfill **antes** de `Disposal`/cutover (gate F2→Disposal); reconciliación detecta Collection-hit `quantity 0` con legado poseído como violación de invariancia, no como salida al usuario |
| **Heurística de key inestable** (`purchaseKey`/`chooseRow` no biyectiva) | Correspondencia errónea → merge incorrecto | Centralizar y testear la correspondencia contra datos reales; preferir `workId`/`whakoomId`; ambigüedad → "sin correspondencia" (mostrar independiente + registrar), no adivinar |
| **Ediciones `anilistId = null` / obras locales** | `Volume` sin AniList no mapea a `Manga(anilistId)` | Usar `workId` y la convención legada `anilistId = -workId` (ya presente en `lib/collection.ts`) como join |
| **Gap de reversa en cutover** | Destoggle legado no tiene equivalente Collection sin `Disposal` | Fase 3 **depende** de entregar reversa primero; secuenciar |
| **Concurrencia backfill + pickups vivos** | Mismo tomo backfilleado y con pickup → cantidad 2 (falso) | Backfill no-op si ya hay posición (establecedor de presencia); keys deterministas por canal |
| **Performance del read unificado** | 2 cargas + correspondencia por render | Batch; reusar la query legada única actual; Collection indexado por `userId`; correspondencia sobre filas ya cargadas |
| **Regresión invisible en Fase 1** | El seam cambia sutilmente la salida vs. el legado directo | Test de equivalencia: con Collection vacío, `getUserCollection` == `getCollectionItems` byte a byte |

---

## 11. Tests que deberían existir (§ pedido 9) — solo qué verificar

**Correspondencia (unit, puro):**
- `Volume` ↔ coordenada legada con `anilistId`; con `-workId` (obra local); vía `workId`/`whakoomId`.
- `publisher → editionKey` (casos de `PURCHASE_PUBLISHER_KEY`); edición ambigua → "sin correspondencia".
- Edición nacional (`anilistId` null) mapea por `workId`; `Volume.number == OwnedVolume.volume`.

**Merge / selección por volumen (unit, puro) — regla D:**
- Solo-legado (Collection-miss) → sirve el legado; solo-Collection (Collection-hit) → sirve Collection.
- Overlap (correspondencia unívoca, ambas con dato) → **Collection gana y suprime el legado** para ese volumen; el
  ítem aparece una sola vez.
- **Collection-hit `quantity 0` → no poseído** (suprime una marca legada contradictoria; es lo correcto bajo la
  invariancia de absorción, §7).
- `quantity > 1` visible en la vista de detalle; no duplica en el set (una fuente por volumen).
- Correspondencia ambigua → **nunca se adivina**: los dos ítems se sirven independientes y el desajuste se registra.
- Volumen no mapeable → lo sirve el legado (degradación elegante).

**Facade (integración):**
- `getUserCollection` idéntico al legado con Collection vacío (equivalencia Fase 1).
- Suma un pickup de Retail sin doble conteo; forma de `SeriesView` intacta; variantes public/share.
- `getVolumeOwnership` / `getOwnershipHistory` para tomo Collection, tomo legacy-only y tomo en ambos.
- Estadísticas (`getCollectionStats`) sobre ítems unificados sin cambios.

**Reconciliación / cobertura (integración):**
- Detecta drift; cuenta no-mapeables; cero falsos positivos en data limpia.

**Backfill (fase posterior):**
- Idempotente, resumible; establecedor-de-presencia (no aditivo); no-op cuando ya hay pickup; salta no-mapeables.

**Cutover / reversa (fase posterior):**
- Toggle escribe Collection; destoggle vía reversa; `OwnedVolume` congelado (no recibe escrituras).

**Guard de eliminación (fase posterior):**
- Se enforman las condiciones del §9; export y vistas públicas correctas con lecturas Collection-only.

---

## 12. Cumplimiento de restricciones + decisiones abiertas para revisar juntos

**Restricciones (cómo las cumple el diseño):**
- **No implementar código** — este doc es solo diseño. ✓
- **No modificar Slice 8** — reusa `read.ts` / `apply` / auditoría; Slice 9 se apoya encima. ✓
- **No dual-write** — el read-side no escribe nada; la migración llega a la eliminación por **cutover de escritor
  único** + backfill único idempotente, nunca escribiendo a los dos stores a la vez. ✓
- **No tablas nuevas** — la correspondencia se **computa**; el backfill usa `Acquisition` con `channel` para la
  procedencia; la reconciliación es un reporte, no una tabla. ✓
- **No feature flags salvo necesidad** — el read-side no necesita flag: la autoridad se **deriva del dato**
  (existe o no la fila `OwnershipPosition`), que funciona como marcador implícito de migración (§7). Se reserva
  **a lo sumo un** kill-switch para el cutover de escritura (Fase 3) por reversibilidad; a evaluar si un deploy alcanza. ✓
- **DDD + Hexagonal + Vertical Slice + Modular Monolith** — puerto `OwnershipSource` + adaptadores + core puro de
  merge + facade de aplicación, un módulo. ✓
- **Minimizar acoplamiento Retail↔Collection** — Slice 9 **no toca Retail** ni el camino de pickup; lee los hechos
  ya proyectados por Collection + el legado. Retail no participa. ✓

**Decisiones CERRADAS:**
- ✅ **Estrategia de composición = Opción D** (Collection autoritativo + legado como backstop por volumen).
  Reemplaza toda regla de OR/unión permanente. Motivos e invariancia en §5–§7.
- ✅ **Merge por volumen**, no atómico por usuario (§5).
- ✅ **Backfill establecedor de presencia, nunca aditivo** (§8 Fase 2).
- ✅ **Reversa/`Disposal` se secuencia antes** del cutover (§8 Fase 3, gate F2→Disposal en §9-bis).

**Decisiones abiertas** — todas **cerradas** y formalizadas en [ADR-011](adr/011-collection-read-side.md):
alcance = solo F1; módulo `lib/collection-read/`; gate de estabilidad = 3 corridas; no-mapeable por-caso.

---

## 13. Checkpoint 1 — diseño detallado (correspondencia)

Corazón del read-side. **Solo dominio puro**; los adapters/fachada son checkpoints posteriores. Dos ajustes sobre
la spec original, aprobados:

**(A) Fuente única de `publisherKey`.** El mapa `PURCHASE_PUBLISHER_KEY` / `publisherKey` se **extrae** a
`lib/publisher-key.ts` (puro, sin deps). **Tanto** la escritura legada (`lib/collection.ts`, que fija
`TrackedEdition.key`) **como** la correspondencia dependen de esa **única** fuente. No se mantienen dos mapas
sincronizados por test: el test anti-drift pasa a validar el **contrato** (`"Ivrea Argentina" → "ivrea"`, etc.),
no a comparar dos copias.

**(B) Split índice ↔ resolución.** El pipeline es de tres pasos:

```text
deriveCatalogKey / deriveLegacyKey   (O(1) por ítem, puros)
        ↓
buildCorrespondenceIndex(catalog, legacy) : CorrespondenceIndex     ← agrupa por tripla, detecta colisiones
        ↓
resolveCorrespondence(index) : CorrespondenceResolution             ← clasifica (una vista del índice)
```

El **índice** es el substrato compartido y reutilizable **sin** correr la resolución completa, por:
- **reconciliación** (recorre `byKey` para hallar discrepancias/colisiones);
- **reporte de cobertura F0** (cuenta legado en `matched` vs total);
- **backfill F2** (worklist = pares `matched`; inventario no-mapeable = legado sin par);
- **auditoría** (cruza posiciones vs legado por el índice).

**Contrato del índice:**

```ts
type CorrespondenceIndexEntry = {
  key: CorrespondenceKey;
  catalog: { volumeId: number }[];   // volúmenes que derivaron esta tripla (≥1)
  legacy: LegacyTomoRef[];           // tomos legados que la derivaron (0..1 por el @@unique del legado; array por totalidad)
};
type CorrespondenceIndex = {
  byKey: ReadonlyMap<string, CorrespondenceIndexEntry>;   // clave string canónica INYECTIVA respecto de la tripla
  unmappableCatalog: readonly { volumeId: number }[];     // deriveCatalogKey === null (sin ancla de serie)
};
```

- **Invariante del índice:** `byKey` agrupa por una codificación **inyectiva** de `(seriesKey, editionKey, number)`
  = `JSON.stringify([seriesKey, editionKey, number])` (escapa comillas/comas/corchetes → inequívoca para cualquier
  `editionKey`, sin depender de un delimitador). La **ambigüedad es SIMÉTRICA**: `catalog.length ≥ 2` (colisión de
  catálogo por `publisherKey` lossy) **o** `legacy.length ≥ 2` (dos `TrackedEdition` que colapsan a la misma tripla)
  ⇒ ambiguo. **No se asume `legacy.length ≤ 1`**: los `@@unique` del legado garantizan la unicidad de la identidad
  *persistida*, no de la tripla *derivada*; nunca se elige un registro (ni de catálogo ni legado) arbitrariamente.
- `resolveCorrespondence(index)` deriva: `matched` (c=1 ∧ l=1) · `collectionOnly` (c=1 ∧ l=0) · `legacyOnly`
  (c=0 ∧ l=1) · `ambiguous` (c≥2 ∨ l≥2) · `unmappableCatalog` (pasa del índice). **Nunca** hay entrada con c=0 ∧ l=0.
- **Orden determinista** heredado del orden de entrada (los adapters cargan con `orderBy`); ni el índice ni la
  resolución re-ordenan ⇒ complejidad total **O(P + L)** (sin sort, sin O(N²), sin dependencia del catálogo global).

**Alcance del Checkpoint 1 (lo único a revisar al cerrarlo):** (1) extracción de `publisherKey`; (2) contrato del
índice (`buildCorrespondenceIndex` + `resolveCorrespondence`); (3) unit tests del dominio. **No** adapters, **no**
fachada, **no** reconciliación todavía.

---

## 14. Checkpoint 2 — puerto `OwnershipSource` + `mergeOwnership` (Opción D)

Separación estricta: la **fuente** obtiene observaciones; la **correspondencia** decide equivalencias/ambigüedad;
el **merge** aplica autoridad de Collection + backstop legado. El core de merge **no** consulta DB, **no** deriva
claves, **no** recomputa correspondencia, **no** conoce Prisma/adapters, **no** registra reconciliación, **no**
decide UI.

**Puerto y observaciones** (`lib/collection-read/ports.ts`):

```ts
type CollectionObservation = CatalogVolumeRef & { quantity: number };  // posición + identidad de catálogo; quantity puede ser 0
type LegacyObservation = LegacyTomoRef;                                 // tomo poseído (booleano; sin cantidad)
interface OwnershipSource<TObservation> { observe(userId: string): Promise<readonly TObservation[]>; }
```

**Merge** (`lib/collection-read/merge.ts`):

```ts
type MergedOwnedUnit =
  | { source: "collection"; volumeId: number; key: CorrespondenceKey | null; owned: boolean; quantity: number; fromAmbiguous: boolean }
  | { source: "legacy"; legacy: LegacyTomoRef; owned: true; quantity: 1; fromAmbiguous: boolean };
type OwnershipResult = { units: MergedOwnedUnit[] };
function mergeOwnership(resolution: CorrespondenceResolution, collection: readonly CollectionObservation[]): OwnershipResult;
```

**Tabla de verdad (Opción D):**

| Categoría | Collection `quantity` | Legado | Unidad(es) | `owned` | `source` |
|---|---|---|---|---|---|
| `matched` | ≥ 1 | poseído → **suprimido** | 1 collection | `true` | collection |
| `matched` | 0 | poseído → **suprimido** | 1 collection | **`false`** | collection |
| `collectionOnly` | ≥ 1 | — | 1 collection | `true` | collection |
| `collectionOnly` | 0 | — | 1 collection | `false` | collection |
| `unmappableCatalog` | ≥ 1 | — | 1 collection (`key: null`) | `true` | collection |
| `unmappableCatalog` | 0 | — | 1 collection (`key: null`) | `false` | collection |
| `legacyOnly` | — | poseído | 1 legacy | `true` (qty 1) | legacy |
| `ambiguous` | cada `q` | cada tomo | N collection + M legacy (`fromAmbiguous`) | col: `q>0`; leg: `true` | ambas |

**Política `quantity = 0`:** afirmación **válida de no posesión** (no "Collection no sabe") **cuando proviene de una
observación real**. Emite `owned: false` y, en `matched`, **suprime** la marca legada (el tomo legado no se emite; lo
representa la unidad de Collection). Es la autoridad de Collection ante contradicción, correcta bajo la invariancia
de absorción (§7).

**Contrato de consistencia resolución ↔ observaciones (biyección estricta).** Un `quantity = 0` autoritativo solo es
legítimo si viene de una observación; una observación **faltante NO** se degrada a 0 (sería convertir una
inconsistencia técnica en una afirmación de dominio falsa que oculta el legado). Precondición validada
exhaustivamente por el core:

```text
set(volumeId de Collection en la resolución) === set(volumeId de collection observations)
    (matched ∪ collectionOnly ∪ unmappableCatalog ∪ lado-catálogo de ambiguous)
cada volumeId aparece EXACTAMENTE una vez en cada lado, y quantity >= 0
```

Violaciones → **error tipado `InvalidMergeInput`** (`lib/collection-read/errors.ts`, `code` ∈ `MERGE_ERROR`), nunca
un resultado parcial ni un `quantity` inventado:
- `MISSING_OBSERVATION` — volumeId requerido sin observación (0 observaciones);
- `DUPLICATE_OBSERVATION` — ≥2 observaciones para el mismo volumeId;
- `EXTRANEOUS_OBSERVATION` — observación cuyo volumeId no aparece en la resolución;
- `NEGATIVE_QUANTITY` — `quantity < 0`.

**Invariantes del merge:** puro/determinista (orden fijo matched→collectionOnly→unmappable→legacyOnly→ambiguous);
no deriva ni recomputa (consume la resolución tal cual); `owned ⟺ quantity>0` en unidades de Collection; unidades
legadas siempre `owned:true`/`quantity:1`; **soundness de supresión** (un tomo legado de `matched` jamás se emite
como unidad legada); ambiguos servidos independientes y marcados, nunca colapsados; cobertura total
(`|collection units| = matched+collectionOnly+unmappable+ambiguous-catalog`;
`|legacy units| = legacyOnly+ambiguous-legacy`).

**Alcance del Checkpoint 2 (a revisar):** (1) puerto `OwnershipSource`; (2) tipos de observación; (3)
`mergeOwnership` + tabla de verdad; (4) unit tests. **No** adapters concretos, **no** fachada, **no** reconciliación.

---

## 15. Checkpoint 3 — adapter Collection (`OwnershipSource<CollectionObservation>`)

`lib/collection-read/adapters/collection.ts`: `collectionOwnershipSource(client)` sobre el modelo de Slice 8.

- **Consulta relacional ÚNICA** (`ownershipPosition.findMany` con `select` anidado
  `OwnershipPosition → Volume → PublisherEdition`, `orderBy: { volumeId: "asc" }`): un solo `select` de
  `volumeId, quantity, volume.number, volume.edition.{anilistId, workId, publisher}`. **Una sentencia = un snapshot**:
  elimina la ventana entre dos lecturas (una carrera legítima que borrara la edición entre queries produciría un
  falso "roto") y no depende de un nivel de aislamiento especial.
- **No reutiliza `getUserPositions`** (no incluye la edición; ampliarlo modificaría Slice 8). La atomicidad de la
  observación pesa más que el reúso; **Slice 8 queda intacto** (el adapter consulta Prisma directamente).
- **Relaciones requeridas** (`Position.volumeId`, `Volume.editionId` no nulos) ⇒ Prisma tipa `volume`/`volume.edition`
  no-null ⇒ cada `CollectionObservation` sale **completa**; **no hay caso de "edición ausente"** que defender, así que
  se **eliminó `CollectionSourceError`/`UNRESOLVED_EDITION`** (quedó sin uso; ya no se documenta como referencia rota).
- **`quantity = 0` NO se filtra** (autoridad de Collection). **Anclas null** (`anilistId`/`workId`) se pasan **fieles**
  (el mapping decidirá `unmappableCatalog`). El adapter **no** fabrica claves ni ejecuta `deriveCatalogKey`.
- **Tests:** `tests/collection-read-collection-adapter.integration.test.ts` (7, base real: observación completa y
  atómica, `quantity=0` no filtrado, anclas null, publisher sin derivar, aislamiento, orden `volumeId asc`, vacío).
  Slice 8 **sin cambios**.

**Alcance del Checkpoint 3 (a revisar):** adapter Collection + sus tests. **No** adapter legado, **no** fachada,
**no** reconciliación, **no** consumidores.

---

## 16. Checkpoint 4 — adapter legado (`OwnershipSource<LegacyObservation>`)

`lib/collection-read/adapters/legacy.ts`: `legacyOwnershipSource(client)` sobre `OwnedVolume → TrackedEdition → Manga`.

- **Identidad estable en la observación:** `LegacyObservation = LegacyTomoRef & { ownedVolumeId }`
  (`ownedVolumeId = OwnedVolume.id`). **No participa de la correspondencia** (`deriveLegacyKey` sólo lee la tripla),
  pero preserva la distinción entre filas persistidas que colapsen en la misma tripla → distinguir colisiones,
  reconciliar, auditar, evitar keys duplicadas en DTOs. Es la mínima identidad estable (el legado ya tiene PK directa).
- **Consulta relacional ÚNICA** (`ownedVolume.findMany`, `orderBy: { id: "asc" }`, `select` anidado de
  `id, volume, edition.{key, manga.anilistId}`). Una fila de `OwnedVolume` **es** un tomo poseído ⇒ devuelve **sólo
  poseídos**. Relaciones requeridas ⇒ observación siempre completa. **No reutiliza** `getCollectionItems` (heavy:
  enriquece vía AniList/covers/authors y mapea a números perdiendo `OwnedVolume.id`); consulta directa, atómica.
- **`Manga.anilistId` se pasa tal cual** (ya codifica positivo = AniList / negativo = `-workId`); `TrackedEdition.key`
  y `OwnedVolume.volume` fieles. No filtra valores sospechosos (`anilistId = 0` pasa; lo decide el mapping).
- **Sin dedup:** una observación por fila, cada una con su `ownedVolumeId`; dos filas colisionadas se devuelven
  distinguibles (la ambigüedad se diagnostica aguas abajo, no se oculta).
- **Límite adapter/dominio:** no consulta Collection, no deriva `publisherKey`, no resuelve correspondencias.
  **No toca la escritura legada** (`lib/collection.ts`): sólo lee. **Orden determinista** `ownedVolumeId asc`.
- **Tests:** `tests/collection-read-legacy-adapter.integration.test.ts` (8, base real): observación completa con
  `ownedVolumeId`, sólo poseídos, `-workId` fiel, `anilistId=0` fiel, sin dedup, aislamiento, orden, vacío.

**Alcance del Checkpoint 4 (a revisar):** adapter legado + sus tests. **No** fachada, **no** reconciliación, **no**
consumidores, **no** backfill.

---

## 17. Checkpoint 4B — propagación tipada del subtipo legado

Ajuste puntual y separado (aprobado): la identidad persistida no es un asunto del DTO; es parte de la observación
del origen y se conserva **tipada** a través de `LegacyObservation → CorrespondenceIndex → CorrespondenceResolution
→ mergeOwnership → OwnershipResult`. El subtipado estructural en runtime no era contrato suficiente.

**Firmas genéricas** (`L extends LegacyTomoRef = LegacyTomoRef`, backward-compatible):

```ts
buildCorrespondenceIndex<L extends LegacyTomoRef = LegacyTomoRef>(catalog: readonly CatalogVolumeRef[], legacy: readonly L[]): CorrespondenceIndex<L>;
resolveCorrespondence<L extends LegacyTomoRef = LegacyTomoRef>(index: CorrespondenceIndex<L>): CorrespondenceResolution<L>;
mergeOwnership<L extends LegacyTomoRef = LegacyTomoRef>(resolution: CorrespondenceResolution<L>, collection: readonly CollectionObservation[]): OwnershipResult<L>;
```

`CorrespondenceIndexEntry<L>.legacy: L[]`; `CorrespondenceResolution<L>` conserva `L` en `matched.legacy` (L),
`legacyOnly` (L[]) y `ambiguous.legacy` (L[]). `deriveLegacyKey` sigue tomando `LegacyTomoRef` ⇒ **`L` no participa
de la clave** de correspondencia.

**Unión discriminada de resultados** (la identidad legada existe SÓLO cuando `source === "legacy"`):

```ts
type CollectionOwnershipUnit = { source: "collection"; volumeId; key; owned; quantity; fromAmbiguous };
type LegacyOwnershipUnit<L extends LegacyTomoRef = LegacyTomoRef> = { source: "legacy"; legacy: L; owned: true; quantity: 1; fromAmbiguous };
type OwnershipUnit<L extends LegacyTomoRef = LegacyTomoRef> = CollectionOwnershipUnit | LegacyOwnershipUnit<L>;
type OwnershipResult<L extends LegacyTomoRef = LegacyTomoRef> = { units: OwnershipUnit<L>[] };
```

Las unidades de Collection **no** adquieren campos legados opcionales. Con `L = LegacyObservation`,
`u.source === "legacy"` ⇒ `u.legacy.ownedVolumeId` es accesible **tipado, sin casts**.

**Impacto en checkpoints 1/2:** sólo **tipos** (genéricos + unión discriminada); **cuerpos de función sin cambios**;
tabla de verdad y reglas de ambigüedad intactas. Tests previos siguen verdes sin casts (usan el default
`L = LegacyTomoRef`); único cambio en el test de merge: renombrar el tipo importado `MergedOwnedUnit → OwnershipUnit`.
Adapters, persistencia, Slice 8 y Retail **sin tocar**.

**Tests:** `tests/collection-read-identity-propagation.test.ts` (6, unit — prueba de compilación por acceso sin cast
+ runtime): `ownedVolumeId` conservado en `matched.legacy`, `legacyOnly`, múltiples en `ambiguous.legacy`, y en las
unidades legadas de `mergeOwnership`; matched sigue sin emitirse como unidad legada; ambigüedad simétrica con
`L = LegacyObservation`.

---

## 18. Checkpoint 5 — fachada + DTOs + equivalencia

`lib/collection-read/facade.ts`: `createOwnershipReader(sources)` — **orquestación** + contrato público. Fronteras:
adapters=observaciones fieles · correspondence=equivalencias/ambigüedad · merge=autoridad/backstop · facade=orquesta
y transforma a DTOs. La fachada **no** consulta Prisma directo (usa los `OwnershipSource` inyectados), no reimplementa
mapping/merge, no oculta ambigüedades, no muta, no hace backfill, no registra reconciliación, no conoce UI.

- **Firma:** `createOwnershipReader(sources: OwnershipReadSources).getUserOwnership(userId): Promise<OwnershipView>`;
  proyección explícita `ownedItems(view): OwnershipItem[]`.
- **Dependencias inyectadas:** `OwnershipReadSources = { collection: OwnershipSource<CollectionObservation>;
  legacy: OwnershipSource<LegacyObservation> }` (Prisma-free; los adapters llevan el client).
- **DTO** `OwnershipItem = { id, source, owned, quantity, seriesKey, editionKey, number, ambiguous }`;
  `OwnershipView = { items }`.
- **Identidad estable del DTO:** `id = "collection:<volumeId>" | "legacy:<ownedVolumeId>"` (identidad **persistida**,
  nunca la tripla heurística). Ambiguos ⇒ ids distintos (por volumeId/ownedVolumeId). `seriesKey`/`editionKey` son
  metadata descriptiva (de la clave de correspondencia para Collection; de la coordenada legada para el legado).
- **`owned:false`:** se **preserva** (no se filtra en el core); "solo poseídos" es la operación explícita `ownedItems`.
- **`fromAmbiguous`:** se **expone** como `ambiguous: boolean` (visible, no oculto).
- **`unmappableCatalog`:** DTO de Collection con `seriesKey/editionKey = null`, `owned` por `quantity`; presente.
- **Collection vacío:** todos los items son legado (equivalente al legado).
- **Errores:** propaga fail-fast (adapters/merge); sin captura, sin resultado parcial, sin degradación.
- **Orden contractual determinista:** serie → edición → tomo → source → id (total; nulls al final).
- **Tests:** unit `tests/collection-read-facade.test.ts` (8, fuentes stub): Collection vacío→legado, matched suprime
  legado, `quantity=0`→owned:false no filtrado, `ownedItems` explícito, unmappable null, ambigüedad expuesta + ids
  distintos, orden contractual, determinismo. Integración `tests/collection-read-equivalence.integration.test.ts`
  (3): con Collection vacío, la **proyección semántica** `{seriesKey, editionKey, number, owned}` (ordenada) de la
  fachada **iguala** la de `getCollectionItems` — comparando identidad/serie/edición/número/posesión/orden, no
  detalles accidentales (portadas/autor/upcoming/títulos). Harness: `DATABASE_URL` apunta a la base efímera para que
  el `prisma` global de `getCollectionItems` lea la misma DB.

**Alcance del Checkpoint 5 (a revisar):** fachada + DTOs + equivalencia + tests. **No** consumidores concretos, **no**
reconciliación persistente, **no** backfill.

---

## 19. Checkpoint 6 — reconciliación observable

`lib/collection-read/reconciliation.ts`: reporte **puro** derivado de `CorrespondenceResolution` (+ cantidades del
`OwnershipResult`). Frontera: correspondence/merge **producen** la verdad semántica; la reconciliación la **observa y
describe**. No cambia el resultado, no repara, no hace backfill, no adivina, no captura/degrada errores del merge, no
escribe tabla (F1), no depende de logging/métricas (el sink lo inyecta la app).

- **Firma:** `buildReconciliationReport<L>(resolution: CorrespondenceResolution<L>, result: OwnershipResult<L>):
  ReconciliationReport<L>`. Genérico (conserva `L` ⇒ identidades legadas con `ownedVolumeId`).
- **Punto del pipeline:** en la fachada, **después** del merge; se deriva de `(resolution, result)` y se publica al
  sink; **no** toca `items`.
- **Sink:** `ReconciliationSink<L> = (report) => void | Promise<void>`, inyectable vía
  `OwnershipReadSources.reconciliationSink` (opcional). La fachada lo **espera** (`await`) para que un rechazo
  asíncrono también quede dentro del `try/catch` (un `void sink(report)` dejaría el rechazo como *unhandled*). Si no
  se inyecta, ni siquiera se construye el reporte ⇒ la lectura no depende de observabilidad; **no** se exporta un
  no-op explícito (la ausencia YA significa "sin observabilidad", un no-op sería código muerto).
- **Categorías/contadores:** `matched`, `collectionOnly`, `legacyOnly`, `unmappableCatalog`, `ambiguous` (grupos),
  `collectionZeroQuantity` (posiciones Collection con `quantity = 0`), `authorityContradictions` (subconjunto:
  `matched` con `quantity = 0` ⇒ Collection suprime un tomo legado poseído, salida visible `owned:false`).
- **Identidad conservada** de los casos problemáticos (no sólo conteos): `ambiguities` (key + `volumeIds` + `legacy:
  L[]`), `authorityContradictions` (`volumeId` + key + `legacy: L`), `unmappableCatalog` (`volumeId`),
  `collectionZeroQuantity` (`volumeId`). Con `L = LegacyObservation`, `ownedVolumeId` accesible sin casts.
- **Nuevas vs aceptadas:** **diferido a F2** (distinguirlas exige un baseline persistido de aceptadas; F1 no escribe
  tabla). El reporte conserva las identidades ⇒ una F2 futura puede diferenciar contra ese baseline.
- **No altera la salida:** el reporte se deriva aparte; `items` se computa igual con o sin sink (test de igualdad).
- **Fallo del sink:** aislado (`try/catch` en la fachada) ⇒ la lectura **nunca** falla por observabilidad
  (best-effort). Los errores del **merge** propagan fail-fast, antes del sink (no se capturan).
- **Reutilizable** por cobertura (conteos), auditoría (contradicciones/ambigüedades) y F2 (identidades).
- **Tests:** `tests/collection-read-reconciliation.test.ts` (9): conteos por categoría, sin-problemas→0, `quantity=0`
  identificado, contradicción de autoridad con identidad legada conservada, ambigüedades/unmappable con identidad;
  integración con la fachada: publica en el sink, salida idéntica con/sin sink, sink que lanza no rompe la lectura.

**Alcance del Checkpoint 6 (a revisar):** reconciliación observable + tests. **No** migración de consumidores, **no**
reconciliación persistente, **no** backfill.

> **Ajuste post-revisión (aislamiento de sinks asíncronos):** la firma del sink pasó a `void | Promise<void>` y la
> fachada lo `await`ea dentro del `try/catch` (un sink `async` usado como callback `void` dejaría el rechazo fuera
> del aislamiento). Se agregaron tests: sink síncrono que lanza, sink asíncrono que rechaza, la fachada espera al
> sink, salida idéntica con sink exitoso/fallido/ausente, y error previo de adapter/merge que propaga fail-fast sin
> ser capturado como fallo de observabilidad. Coste de latencia aceptado para F1 (sink opcional, sin infra real).

---

## 20. Checkpoint 7 — primer consumidor migrado (stat "Tomos poseídos" de la Share pública)

**Hallazgo que condiciona el checkpoint:** `OwnershipView` es **ownership-only** — no transporta metadata (títulos,
portadas, autor, label/publisher/región, `totalVolumes`, estado de lectura). Ningún consumidor puede migrarse "de DTO
completo" contra F1; solo puede migrarse la **dimensión de posesión**. Por eso el primer consumidor es una superficie
donde la posesión es un **agregado puro** (un entero), sin re-join por volumen ni straddle de metadata.

**Consumidor elegido:** el stat **"Tomos poseídos"** de la Share pública (`app/u/[slug]`), vía `getPublicCollection`.
Solo lectura, anónima, sin mutaciones adyacentes, bajo tráfico, fallo cosmético y visible, rollback de 1 línea.

- **Composition root** `lib/collection-read/root.ts`: **solo cableado** (sin lógica de dominio, sin reconstruir claves,
  sin mapear DTOs, sin estado global mutable). `buildOwnershipReader(client, sink?)` = `createOwnershipReader({
  collection: collectionOwnershipSource(client), legacy: legacyOwnershipSource(client), reconciliationSink })`;
  `ownershipReader(sink?)` = `buildOwnershipReader(prisma, sink)` sobre el Prisma global (client explícito para tests).
- **Punto de derivación ÚNICO** (`getPublicCollection`, `lib/collection.ts`): `ownedVolumes =
  ownedItems(await ownershipReader().getUserOwnership(user.id)).length`, devuelto como campo nuevo `ownedVolumes`.
  **Rollback** = reemplazar por la suma legada `items.reduce((s, i) => s + i.edition.ownedVolumes.length, 0)`.
- **Semántica del conteo:** cantidad de unidades con `owned === true` (una posición cuenta **una** vez, NO Σ
  ejemplares: `quantity: 3` cuenta 1). Guarda anti-`sum(quantity)` testeada.
- **Frontera:** metadata, portadas, autores, ediciones y grilla siguen viniendo del **camino legado** (`items`);
  convivencia temporal aceptada (una lectura unificada extra: 2 `findMany` de los adapters, además de la lectura rica).
- **Consistencia stat ↔ porcentaje:** el numerador unificado (`data.ownedVolumes`) alimenta **los tres** consumidores
  de la Share — `generateMetadata`, el stat "Tomos" y la barra. La barra usa `progressPercentage(ownedVolumes,
  totalVolumes)` (`services/collectionService.ts`): denominador legado (`totalVolumes`), `total <= 0 → 0` (sin
  div/0), y **clamp de presentación a 100** (una divergencia legítima por ambigüedad puede dar `owned > total`; el
  clamp NO altera el conteo real ni el dominio). `getCollectionStats.percentage` (legado) queda intacto para
  `app/collection` (no migrada).
- **Tests:** integración `tests/collection-read-share-stat.integration.test.ts` (equivalencia estricta con AniList /
  `-workId` / varias ediciones / aislamiento; `quantity=0` no cuenta; `quantity>1` cuenta una; autoridad de
  Collection con reporte capturado; ambigüedad sin dedup con reporte; metadata legada intacta; contrato de
  `getPublicCollection`; consistencia stat↔porcentaje incl. clamp y `total=0`) + unit puro
  `tests/collection-read-share-percentage.test.ts` (`progressPercentage`). La reconciliación se prueba con un **sink
  capturador inyectado**.
- **Observabilidad productiva:** aún **inactiva por diseño** en F1 (sin sink conectado en producción); la capacidad
  existe y está validada solo en tests.

**Alcance del Checkpoint 7:** stat de la Share + composition root + consistencia visual + tests. **No** grilla, **no**
`app/collection`, export, dashboard, notificaciones, faltantes ni metadata.

---

## 21. Checkpoint 8 — cierre técnico de F1

Estabilización y cierre del arco (sin migrar otro consumidor). Validación completa verde (`npm run check` + harness
de integración). Higiene: se quitaron dos exports muertos (`OwnedUnitSource`, `noopReconciliationSink`). Se confirmó:
Collection autoritativo + legado solo fallback (sin unión permanente), sin dual-write, sin backfill, sin cambios en la
escritura legada, Slice 8 intacta, ningún consumidor accede directo a `correspondence`/`merge` (el único migrado entra
por el composition root + `ownedItems`). Superficie pública app-facing = `ownershipReader`/`buildOwnershipReader` +
`ownedItems` + DTOs `OwnershipView`/`OwnershipItem`; el resto son building blocks internos del módulo (usados por la
fachada/root y unit tests). Documentación (ADR-011 + este doc) alineada con lo implementado. Commit(s) de F1 tras
aprobación.
