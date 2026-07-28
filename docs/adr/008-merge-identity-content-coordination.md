# ADR-008: Coordinación entre Identidad y Contenido durante una fusión

- **Estado**: Aceptado (bloqueante para implementar Fusionar — resuelve T1 del Design Spec).
- **Fecha**: 2026-07.
- **Relacionado**: ADR-002 (Mutation Framework), ADR-006 (Community Contributions — el catálogo solo cambia por Apply), ADR-009 (integridad de referencias), Design Spec de Fusionar (`docs/identity-merge-design-spec.md`).
- **Ámbito**: la coordinación de la futura operación **Fusionar** entre el bounded context de **Identidad** (namespace: handles, estados, redirecciones, referencias) y el de **Catálogo** (`Work`, ediciones, hechos de contenido).

---

## Contexto

Fusionar declara que dos identidades ACTIVE son la misma. Por el índice parcial único
`CatalogIdentity(designatedWorkId) WHERE state='ACTIVE'`, dos identidades ACTIVE designan **Works
distintos**. Por lo tanto **toda fusión implica reconciliar dos Works** — responsabilidad de Catálogo,
no del namespace. Una fusión "solo namespace" es incoherente: dejaría el Work absorbido sin identidad
activa que lo designe, violando "todo contenido activo-designado tiene exactamente una identidad
activa".

El schema real impone restricciones: `CatalogIdentity.designatedWorkId` es `NOT NULL` con FK
**RESTRICT** hacia `Work`; el `Work` absorbido **no puede borrarse** mientras una fila lo referencie; y
no existe semántica de `Work` absorbido/inactivo. Esta es la **tensión T1** del Design Spec.

El principio de frontera (ADR-006, ADR-002) es que Catálogo gobierna el contenido y el Registro el
namespace, y que ninguno debe invadir al otro.

---

## Problema

1. ¿Quién coordina una operación que toca dos bounded contexts sin permitir estados intermedios ilegales?
2. ¿Qué contrato mínimo expone Catálogo?
3. ¿Qué pasa con el `Work` absorbido, dado el schema actual (NOT NULL + RESTRICT)?
4. ¿Cuál es la frontera transaccional y qué debe estar completo antes de que el Registro redirija la identidad absorbida?

---

## Decisión

### D1 — Coordinación por un **caso de uso de aplicación** (Alternativa A), en **una** transacción

Un caso de uso `mergeIdentities` abre **una** transacción Prisma y compone, en orden:

1. validación/preparación de Catálogo;
2. **absorción de contenido** (write-port de Catálogo);
3. **fusión del namespace** (write-port del Registro);
4. resultado global.

El Registro y Catálogo exponen **write-ports específicos** que aceptan el `TransactionClient`
compartido; **ninguno** accede a Prisma de forma genérica ni invoca al otro. El dominio permanece
separado por contexto; el acoplamiento es únicamente la **frontera transaccional** en la capa de
aplicación — el mismo patrón que ya usa el arco Apply.

### D2 — Contrato mínimo de Catálogo: `absorbWorkInto`

Un write-port específico (nombre provisional; el proyecto puede preferir otro del lenguaje ubicuo de
Catálogo):

```text
absorbWorkInto(tx, survivingWorkId, absorbedWorkId, mergePlan) → CatalogAbsorptionResult
```

- **Parámetros:** el `TransactionClient`, ambos Works, y un `mergePlan` con las decisiones de
  contenido **ya tomadas por Adjudicación/moderación**.
- **Decisiones que deben venir tomadas (Adjudicación, no Catálogo):** qué Work sobrevive; en v1, que la
  política de contenido sea **"re-parentar ediciones, sin combinar hechos descriptivos"** (ver alcance v1).
- **Validaciones que Catálogo SÍ puede hacer:** ambos Works existen; distintos; el absorbido no está ya
  absorbido; (si aplica) compatibilidad estructural.
- **Hechos que MUEVE (mecánico, sin juicio):** re-parenta las ediciones del absorbido al sobreviviente
  (`UPDATE PublisherEdition SET workId = survivingWorkId WHERE workId = absorbedWorkId`).
- **Hechos que COMBINA:** en **v1, ninguno.** El Work sobreviviente conserva sus hechos descriptivos;
  los del absorbido quedan como historia en el Work absorbido (detached). La reconciliación de hechos
  descriptivos requiere **juicio** y queda **diferida** (deuda; ver Consecuencias).
- **Conflictos que NO puede resolver:** hechos contradictorios que requieran juicio → devuelve
  `CONTENT_CONFLICT_REQUIRES_JUDGMENT` (rechazo que aborta toda la tx). Catálogo **valida y ejecuta**
  reglas de contenido, pero **no decide** cómo resolver contradicciones — eso es Adjudicación.
- **Relaciones entrantes:** las ediciones se re-parentan; otras relaciones de Catálogo hacia el Work
  absorbido (si aparecieran) deben re-parentarse o bloquear la absorción (a definir por Catálogo).
- **Devuelve** `CatalogAbsorptionResult`: `ABSORBED` | `CONTENT_CONFLICT_REQUIRES_JUDGMENT` |
  `STALE` (el estado observado del contenido cambió) | `ABSORBED_WORK_NOT_FOUND`. El caso de uso traduce
  un resultado no-`ABSORBED` a un rechazo de la fusión global (rollback).

### D3 — `Work` absorbido: **marcado + detached** (Alternativa 2+4)

El `Work` absorbido **no se borra** (perpetuidad + FK RESTRICT). Se **marca** con un puntero de Catálogo
`Work.absorbedIntoId Int?` (self-FK nullable) hacia el sobreviviente y queda **detached** (0 ediciones
tras el re-parentado). Esto: preserva trazabilidad y rollback; evita la reaparición como activo
(consultas y un futuro guard de Conferir filtran `absorbedIntoId IS NOT NULL`); no requiere borrar filas.

### D4 — Frontera transaccional y regla de completitud

- El **caso de uso** abre, confirma y revierte **una** transacción Prisma; ambos write-ports reciben ese
  `TransactionClient`.
- **Orden obligatorio dentro de la tx:** (a) absorción de contenido (re-parentar ediciones, marcar
  `absorbedIntoId`), (b) mover referencias externas al sobreviviente, (c) transición de la identidad
  absorbida a `REDIRECTED`. La regla *"no puede persistirse una absorción de contenido sin la fusión del
  namespace, ni una fusión del namespace sin que el contenido quede en estado válido"* se cumple porque
  **todo ocurre en la misma transacción**: o commitea el conjunto o no queda nada.
- El movimiento de referencias **antes** del cambio de estado es además **forzado declarativamente** por
  ADR-009 (la FK compuesta impide flipear a `REDIRECTED` mientras haya referencias apuntando a la
  identidad como ACTIVE).

---

## Estado final esperado (fusión exitosa)

- **Work sobreviviente:** sin cambios de identidad; gana las ediciones re-parentadas; conserva sus hechos.
- **Work absorbido:** `absorbedIntoId = survivingWorkId`; 0 ediciones; conservado como historia detached.
- **Identidad sobreviviente:** `ACTIVE`, sin redirect, sigue designando su Work.
- **Identidad absorbida:** `REDIRECTED`, `redirectsToId = sobreviviente`; conserva `designatedWorkId`
  (histórico, ahora apunta a un Work absorbido); **deja de designar contenido activo en el instante
  exacto en que su `state` pasa a `REDIRECTED`** (el índice parcial de designación deja de aplicarle).
- **Auditoría/recuperación:** `absorbedIntoId` + `redirectsToId` + procedencia de la decisión de fusión
  (ADR-009 / Design Spec) permiten reconstruir y sientan la base para un futuro Partir/undo.

---

## Consecuencias

**Buenas:**
- Bounded contexts preservados: el dominio de cada contexto no invade al otro; se componen en la app.
- Atomicidad y rollback triviales (una transacción).
- Autoridad clara: Adjudicación decide (sobreviviente, política de contenido); cada write-port valida lo
  suyo; ninguno inventa juicio.
- Simetría para un futuro Partir (misma composición app + dos write-ports).

**Malas / costos:**
- La tx cruza dos bounded contexts a nivel de aplicación (aceptable: composición, no acoplamiento de dominio).
- Requiere un cambio de schema de **Catálogo** (`Work.absorbedIntoId`) y un write-port nuevo de Catálogo.
- **Reconciliación de hechos descriptivos diferida:** en v1 el Work absorbido conserva sus hechos y no se
  fusionan con el sobreviviente. Si esos hechos eran mejores, se pierden de la vista activa (mitigable
  después con el sistema de procedencia). Es deuda explícita, no un bug.
- **Ediciones re-parentadas** pueden dejar al sobreviviente con dos ediciones del mismo publisher; el
  slug de comunidad `cc:w{workId}:...` de una edición re-parentada queda con el `workId` viejo (clave
  única estable, pero semánticamente desactualizada). Dedup/normalización de ediciones = follow-up de Catálogo.

## Riesgos

- Reaparición del contenido absorbido como activo si un **Conferir** posterior designa el Work absorbido:
  el marcado `absorbedIntoId` lo hace **detectable**; el **guard en Conferir** (rechazar conferir sobre un
  Work absorbido) queda como follow-up de bajo riesgo (escenario raro), habilitado por el marcado.
- Si el contrato de Catálogo `absorbWorkInto` no está listo, Fusionar no puede coordinar coherentemente
  (dependencia dura).

## Invariantes preservados

- Todo contenido activo-designado tiene exactamente una identidad activa (el absorbido deja de estar
  activo-designado al redirigirse; su Work queda detached, no activo-designado).
- Perpetuidad y no-reuso de handles y de Works (nada se borra).
- Frontera de bounded contexts (namespace ≠ contenido).

## Impacto técnico previsto

- **Catálogo:** `Work.absorbedIntoId Int?` (self-FK) + migración; write-port `absorbWorkInto` (dominio +
  infra de Catálogo); (follow-up) guard de Conferir contra Works absorbidos; (follow-up) dedup de ediciones.
- **Aplicación:** caso de uso `mergeIdentities` que compone Catálogo + Registro en una tx.
- **Identidad:** ver ADR-009 y Design Spec (redirectsToId, procedencia, movimiento de referencias).

## Preguntas no bloqueantes

- ¿La reconciliación de hechos descriptivos se hace en una operación de Catálogo aparte o vía el sistema
  de procedencia futuro? (No bloquea Fusionar v1.)
- ¿El guard de Conferir contra Works absorbidos entra en el mismo lote que Fusionar o después? (Bajo riesgo.)
- ¿Se normaliza el slug de las ediciones re-parentadas? (Cosmético.)

## Criterio de reversión

Si en la práctica la transacción cruzando dos bounded contexts genera acoplamiento inmanejable (p. ej.
Catálogo y Registro necesitan esquemas de lock incompatibles), se revierte hacia la **Alternativa C**
(consolidación de contenido en un paso previo de Catálogo, con Fusionar puramente de namespace), asumiendo
el costo de un estado intermedio explícito y verificado. Se escribiría un ADR nuevo que supersede a este.

---

## Alternativas consideradas (y por qué se descartaron)

- **B — Registro como coordinador (invoca Catálogo dentro de su ejecución):** rechazada. Rompe la
  frontera de bounded contexts (el Registro tocaría `Work`/`PublisherEdition`), vuelve al Registro una
  operación-dios y acopla su infra a tablas de Catálogo. Contradice el contrato "Registro = custodio del
  namespace".
- **C — Proceso previo de Catálogo, luego Fusionar solo namespace:** rechazada para v1. Introduce un
  **estado intermedio ilegal** entre la consolidación de contenido y la fusión de namespace (dos
  transacciones): entre ambas, el Work quedaría consolidado pero la identidad aún activa designando un
  Work vaciado. Queda como **fallback** documentado (criterio de reversión).
- **D — Saga / consistencia eventual con compensación:** rechazada. Introduce ventanas de inconsistencia
  observable en un invariante de integridad (no de disponibilidad), compensaciones complejas y
  difícilmente testeables, para una operación que **cabe en una sola transacción** Postgres. Innecesaria.

### Sub-alternativas del `Work` absorbido (§D3)
- **1. Borrado físico:** rechazada. Viola perpetuidad y la FK RESTRICT (la identidad absorbida lo referencia).
- **3. Redirección de contenido independiente (subsistema de redirect para Works):** rechazada como
  sobre-ingeniería; el marcado `absorbedIntoId` cubre trazabilidad y no-reaparición sin un subsistema nuevo.
- **5. Reutilización del mismo Work por ambas identidades:** rechazada. Viola el índice parcial de
  designación (un Work, una identidad activa) y crearía doble designación activa.
- **Elegida: 2+4** (marcado `absorbedIntoId` + detached): preserva invariantes, trazabilidad y rollback;
  previene reaparición; sin borrado.
