# ADR-012: Backfill de colección legada → Collection (F2) — política por bucket

- **Estado**: **Aprobado** (F2 — política; F2.2 = ejecución, pendiente)
- **Fecha**: 2026-07-29
- **Relacionado**: [ADR-010](010-slice8-collection-projection.md) (Slice 8: `OwnershipPosition` + `Acquisition`), [ADR-011](011-collection-read-side.md) (read-side unificado, F1). Reutiliza el substrato de correspondencia autoritativa `lib/collection-read/mapping/correspondence.ts`.
- **No implementa** F2.2, ni crea/borra datos, ni introduce dual-write. Define **política**; la ejecución es un slice posterior.

---

## 1. Contexto

Coexisten dos ejes de **posesión** asimétricos (ADR-011):

- **Legado `OwnedVolume`**: `Manga(userId, anilistId)` → `TrackedEdition(key)` → `OwnedVolume(volume)`. Posesión **booleana**. Es hoy la fuente completa de la UI de colección.
- **Collection (Slice 8)**: `OwnershipPosition(userId, volumeId)` + `Acquisition`, apuntando al eje nuevo `PublisherEdition → Volume`. Posesión por **cantidad**. Hoy parcial (solo hechos `PICKED_UP`).

**F2** es el backfill que traslada la verdad de posesión del legado a Collection, para que ésta converja como única fuente. El problema central: `OwnershipPosition.volumeId` es **FK RESTRICT a un `Volume` existente** — no se puede registrar posesión hacia un destino que no existe. Por lo tanto, backfillear un `OwnedVolume` exige que exista un **destino determinístico** en el catálogo. F2 debe decidir **qué casos son migrables automáticamente y cuáles requieren tratamiento explícito**, sin fabricar datos ni romper invariantes.

## 2. Evidencia técnica

Se construyó un **dry-run read-only** (F2 PR-1, commit `71db66b`) que reutiliza la correspondencia autoritativa de F1 y clasifica cada `OwnedVolume` en cinco buckets mutuamente excluyentes y exhaustivos. Se ejecutó en dos entornos:

- **Staging** (branch Neon `staging`): exit 0, `Σ buckets == total` (true), duración ~6 s.
- **Producción** (branch Neon `production`): exit 0, `Σ buckets == total` (true), duración ~4.8 s.

Propiedades verificadas (idénticas en ambos):
- **Invariante de cardinalidad**: `Σ(RESOLVABLE, AMBIGUOUS, ORPHAN_NO_EDITION, ORPHAN_NO_VOLUME, EDITION_KEY_MISMATCH) == total`. `assertCardinality` no lanzó.
- **Cero escrituras**, respaldado por: (a) análisis estático — el camino de ejecución sólo invoca `findMany` (`user`, `ownedVolume`, `publisherEdition`), sin `create/update/delete/upsert/$executeRaw`; (b) integration test `collection-backfill-scan` que afirma conteos de tabla idénticos antes/después; (c) ausencia de cualquier executor/apply en el camino (F2.2 no existe aún).
- **Runtime**: paginación por cursor sobre `User`, trabajo por-usuario con estado agregado acotado (sin cargar la colección completa en memoria); orden determinista.
- **Comportamiento del algoritmo**: la clasificación deriva únicamente de claves técnicas (`seriesKey`, `editionKey`, `number`) provenientes del substrato de correspondencia; **no** usa títulos, slugs, similaridad ni heurísticas.

## 3. Observación sobre la muestra (no fundamenta la política)

Se deja constancia explícita:

- Producción está **pre-launch**.
- La colección total de producción es **58 `OwnedVolume` distribuidos en 2 usuarios**.
- `staging` es una branch Neon **derivada de producción**; su colección no divergió → **mismo conjunto de datos** (los resultados coincidieron exactamente, incluidos los ejemplos). No hay una segunda fuente independiente.
- Por lo tanto la muestra es **estadísticamente no representativa**.

Los porcentajes obtenidos durante el dry-run son **observacionales y no normativos**. Su función es describir el estado de los datos en el momento de la medición, no definir el comportamiento correcto del sistema. En consecuencia **quedan registrados sólo como evidencia del estado pre-launch** y **no** se usan para justificar la política: este ADR **no cita** `%RESOLVABLE`, `%ORPHAN` ni la distribución observada como fundamento de ninguna decisión, y **no** condiciona F2.2 a un umbral de frecuencia.

## 4. Política de buckets (justificada por semántica, no por frecuencia)

Cada `OwnedVolume` se clasifica por la **existencia y unicidad de un destino determinístico** en el eje nuevo. El tratamiento se define por lo que el bucket **significa**, con independencia de cuántos casos caigan en él.

| Bucket | Significado | Tratamiento | Justificación |
|---|---|---|---|
| **RESOLVABLE** | Existe **exactamente un** `Volume` de catálogo para la tripla `(seriesKey, editionKey, number)` derivada. | **Migración automática** (único caso). | Hay un destino **único y determinístico**; escribir `OwnershipPosition` preserva el invariante "una sola fuente por volumen" (ADR-011) y respeta la FK RESTRICT hacia un `Volume` existente. Es el único caso donde la automatización no puede elegir mal. |
| **AMBIGUOUS** | Hay **≥2** destinos candidatos para la tripla. | **No automático**; requiere resolución explícita. | Elegir automáticamente ataría la posesión a un `Volume` posiblemente incorrecto. La ambigüedad se **preserva y se expone**, no se aplana; correctitud > cobertura. |
| **ORPHAN_NO_EDITION** | **No existe** `PublisherEdition` para `(seriesKey, editionKey)`. | **No automático**; queda para estabilización de catálogo. | No hay edición a la cual adjuntar; incorporarla sería una **mutación de catálogo**, fuera del alcance de un backfill de colección. Fabricar la edición arriesga datos incorrectos. |
| **ORPHAN_NO_VOLUME** | La `PublisherEdition` existe pero **no tiene** un `Volume` con ese `number`. | **No automático en F2**; materialización de `Volume` diferida (estabilización de catálogo / paso separado explícitamente gateado). | Es el caso pivotal: backfillear exigiría **materializar un `Volume`** (write de catálogo). Dónde vive esa materialización es una decisión de catálogo, no de colección; la FK RESTRICT impide apuntar a un `Volume` inexistente. F2 **no** materializa volúmenes. |
| **EDITION_KEY_MISMATCH** | El ancla (`seriesKey`) existe en catálogo pero bajo **otra** `editionKey` que la del `OwnedVolume`. | **No automático**; requiere reconciliación explícita. | Mapear a través de un mismatch de clave arriesga adjuntar la posesión a la **edición equivocada** (p. ej. otra editorial). Requiere corrección de correspondencia/identidad, no un backfill ciego. |

**Interacción documentada (no es driver de política):** `deriveCatalogKey` aplica la precedencia `anilistId > workId` (prefiere `anilistId > 0` sobre `-workId`). Un `OwnedVolume` de ancla negativa cuya edición ya tiene `anilistId` puede caer en ORPHAN_NO_EDITION. Es comportamiento esperado y coherente con esta política (tratamiento no-automático); se registra para trazabilidad, no como justificación.

## 5. Decisión

1. **La migración automática (F2.2) aplica únicamente cuando existe un destino determinístico único** — es decir, **solo el bucket RESOLVABLE**.
2. **Todo caso ambiguo, huérfano o con mismatch requiere tratamiento explícito** (resolución manual/moderación, estabilización de catálogo, o un paso separado y gateado). Nunca se migra por defecto ni por conveniencia estadística.
3. **El fundamento es la preservación de invariantes y la seguridad del proceso, no métricas observacionales**: unicidad del destino, FK RESTRICT hacia `Volume` existente, "una sola fuente por volumen" (ADR-011), y prohibición de fabricar datos de catálogo dentro del backfill.
4. **F2.2 debe ser idempotente y de solo-avance**: lee, migra sólo RESOLVABLE, saltea el resto, y es re-ejecutable sin efectos duplicados. F2.2 deberá implementar un mecanismo de idempotencia **estable por usuario y volumen**. El legado permanece como **backstop** (ADR-011) hasta la convergencia total.
5. **No hay dual-write ni borrado del legado en F2**: F2 sólo **establece presencia** en Collection para los casos seguros; retirar `OwnedVolume` es F3 (fuera de alcance).

Este ADR define únicamente la **política de clasificación y migración**. No prescribe la implementación concreta del executor, batching, tamaño de página, paralelismo, estrategia de reintento, persistencia del progreso ni otros detalles operativos. Esos aspectos pertenecen a **F2.2** y deberán respetar las restricciones establecidas en este documento.

## 6. Consecuencias

**Habilita:**
- **F2.2**: un executor de escritura que migra únicamente los `OwnedVolume` RESOLVABLE a `OwnershipPosition`, idempotente y resumible, dejando intacto el resto y conservando el backstop legado.
- Un contrato claro y auditable: cada `OwnedVolume` no migrado tiene un motivo semántico explícito (su bucket).
- **Garantía de calidad del catálogo**: la política garantiza que ningún backfill automático pueda degradar la calidad del catálogo canónico mediante asociaciones no determinísticas o la creación implícita de datos de catálogo.

**Riesgos / deuda que permanece:**
- **ORPHAN_NO_VOLUME** queda sin resolver hasta decidir dónde vive la materialización de `Volume` (estabilización de catálogo / Fase B). Mientras tanto esas posesiones siguen servidas por el backstop legado.
- **AMBIGUOUS** y **EDITION_KEY_MISMATCH** requieren herramientas de reconciliación explícita aún no construidas.
- **El retiro del modelo legado (F3) requiere que exista una política explícita para todos los buckets.** No implica necesariamente que todos ellos hayan desaparecido, sino que cada caso restante tenga un tratamiento definido fuera del modelo legado.

**Evidencia futura que podría complementar (sin cambiar la política):**
- Cuando exista una **base de usuarios representativa** (post-launch), re-ejecutar el dry-run permitirá **dimensionar y priorizar** cada bucket (p. ej. si ORPHAN_NO_VOLUME justifica un esfuerzo de completar catálogo). Esa cuantificación informará **prioridades operativas**, nunca la política de seguridad aquí definida.

## Alternativas consideradas

- **Unión/OR permanente de ambos ejes.** Descartada: viola el "una sola fuente por volumen" de ADR-011 y perpetúa la ambigüedad.
- **Materializar automáticamente los `Volume` faltantes durante el backfill (resolver ORPHAN_NO_VOLUME al vuelo).** Descartada en F2: mezcla mutación de catálogo con backfill de colección y arriesga fabricar ediciones/volúmenes incorrectos; pertenece a estabilización de catálogo.
- **Matching best-effort para AMBIGUOUS/MISMATCH (títulos/similaridad).** Descartada: no determinístico; el scan evita deliberadamente slugs/títulos/similaridades.
- **Migrar todos los casos automáticamente y corregir posteriormente.** Descartada: una **asociación incorrecta** (posesión atada al `Volume`/edición equivocados) es más costosa de **detectar y reparar** que una **posesión pendiente de migración**, que permanece visible vía el backstop legado y con un motivo semántico explícito. El costo asimétrico favorece no migrar ante la duda.
- **Gatear F2.2 por un umbral de `%RESOLVABLE`.** Descartada: la muestra no es representativa y —por decisión de este ADR— la política es de seguridad, no de frecuencia.
