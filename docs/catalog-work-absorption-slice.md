# Slice de Catálogo — "Absorber un Work dentro de otro"

Dependencia congelada en **ADR-008** para la futura Fusionar. Pertenece al bounded context
**Catálogo** (Work/Edition), **no** a Identity. SOLO absorción de contenido. No fusiona identidades,
no toca `CatalogIdentity`, no abre su propia transacción.

## Semántica

`absorbWorkInto(tx, survivingWorkId, absorbedWorkId, mergePlan) → CatalogAbsorptionResult`:
- conserva el Work **sobreviviente** como contenido activo;
- **re-parenta** las ediciones del absorbido al sobreviviente;
- **marca** el absorbido con `absorbedIntoId = survivingWorkId` (detached);
- impide que el absorbido vuelva a ser contenido activo;
- **no borra** el absorbido (perpetuidad);
- **no** decide cómo reconciliar hechos/ediciones contradictorios → eso requiere juicio.

## Alcance v1 (ADR-008)

Re-parenta ediciones. **No combina hechos descriptivos** (título/autor/sinopsis/fechas): los del
absorbido quedan archivados en el Work absorbido (detached). No hace dedup de ediciones, no Partir, no
deshacer, no cadenas, no compactación, no borrado, no auditoría, no coordinación con Identity.

## Modelo del Work absorbido

`absorbedIntoId != null` **ES** la fuente normativa del estado "absorbido" (sin columna duplicada).
Self-FK `Work.absorbedIntoId → Work.id` **ON DELETE RESTRICT** (perpetuidad: no se borra un
sobreviviente con absorbidos apuntándolo). CHECK `absorbedIntoId IS NULL OR absorbedIntoId <> id`
(no-autoabsorción, crudo → Prisma no modela CHECK, **drift documentado**). Índice en `absorbedIntoId`
(para "absorciones entrantes" y resolución).

## MergePlan mínimo

`{ version: 1 }` — **vacío/versionado** a propósito. La única estrategia v1 es "re-parentar ediciones,
sin combinar hechos", así que el plan no lleva datos; reserva el slot para estrategias futuras sin
estructura especulativa. Lo provee el futuro coordinador (Adjudicación); habilita validar la versión.

## Mapa de invariantes

| Invariante | Dónde |
|---|---|
| Work activo ⇔ `absorbedIntoId = null` | `isActiveWork` (dominio) + estado normativo |
| Work absorbido ⇔ `absorbedIntoId = survivingWorkId` | write-port |
| No autoabsorción | CHECK (base) + `SAME_WORK` (write-port) |
| Sobreviviente no absorbido | `INVALID_SURVIVOR_STATE` |
| Absorbido no absorbido en otro Work | `INVALID_ABSORBED_STATE` |
| v1 no encadena (absorbido sin absorciones entrantes) | `INVALID_ABSORBED_STATE` |
| Ediciones re-parentadas atómicamente | una tx (del coordinador/test) |
| Absorbido conservado (no borrado) | FK Restrict + sin `delete` |
| No se modifica Identity | el port no toca `CatalogIdentity` |

## Frontera transaccional

El write-port **recibe** un `TransactionClient` y **no** abre/confirma/revierte su propia tx. El futuro
caso de uso de Fusionar compondrá, en UNA tx: **absorción de contenido (esto) + fusión del namespace
(Registro de Identidad)**. Para probarlo, el test controla la tx (`prisma.$transaction(tx =>
absorbWorkInTx(tx, cmd))`). **No** hay caso de uso público que absorba contenido de forma independiente.

Orden de mutación (dentro de la tx): lock de ambos Works (`FOR UPDATE`, ordenado por id) → revalidar →
detectar conflicto → **re-parentar ediciones** → **marcar `absorbedIntoId`**. Re-parentar antes de
marcar evita que el absorbido quede marcado con ediciones todavía colgando.

## Resultados semánticos (alcanzables)

`EXECUTED` (con `reparentedEditions`), `ALREADY_ABSORBED` (idempotencia por estado; sin `decisionId` —
el protocolo de decisión es del futuro coordinador), y `REJECTED` con motivo: `SAME_WORK`,
`WORK_NOT_FOUND` (con `missing: survivor|absorbed`), `INVALID_SURVIVOR_STATE`, `INVALID_ABSORBED_STATE`,
`CONTENT_CONFLICT_REQUIRES_JUDGMENT` (con `conflicts: [{publisher, language}]`). **`WOULD_CREATE_
ABSORPTION_CYCLE` NO figura**: en v1 (ambos activos, sin cadenas) un ciclo queda subsumido por los
chequeos de estado — no es alcanzable.

## Conflictos que requieren juicio

Como `@@unique([publisher, slug])` es global, re-parentar `workId` **nunca** viola una constraint de
base. El conflicto es **semántico**: si sobreviviente y absorbido comparten un **slot de edición
`(publisher, language)`** (la identidad de edición de comunidad es `(publisher, workId, language)`),
tras la absorción el sobreviviente tendría dos ediciones del mismo slot → **duplicado que requiere
juicio**. Catálogo lo **detecta y rechaza** (`CONTENT_CONFLICT_REQUIRES_JUDGMENT`, devolviendo los
slots en conflicto) pero **no lo resuelve**. Un merge limpio (publishers/idiomas no solapados, p. ej.
Ivrea + VIZ) procede sin conflicto.

**Hechos descriptivos:** v1 no los combina y **no detecta contradicciones** entre ellos — el repo aún
no tiene modelo de procedencia/preferencia de hechos. Es una **limitación declarada**: el contrato v1
se restringe a "re-parentar ediciones + marcar", y la reconciliación de hechos descriptivos queda como
precondición del futuro coordinador (Adjudicación debe asegurar que los Works son realmente el mismo).

## Concurrencia (verificada en Postgres real)

`SELECT … FOR UPDATE` sobre ambos Works, ordenado por id (anti-deadlock), + revalidación bajo lock,
`READ COMMITTED`. Carreras probadas: mismo absorbido → dos sobrevivientes (uno EXECUTED, uno rechazado);
mismo absorbido → mismo sobreviviente (EXECUTED + ALREADY_ABSORBED); A→B vs B→A (una gana, la otra
`INVALID_SURVIVOR_STATE`, **sin ciclo**); dos absorbidos → mismo sobreviviente (ambos EXECUTED); sin
deadlocks; estado final siempre consistente.

## Guard de Conferir contra Works absorbidos (ADR-008 §16)

Implementado como **pre-check amable**: Conferir lee `Work.absorbedIntoId` y rechaza con
`DESIGNATED_CONTENT_ABSORBED` si el Work está absorbido. **No** es garantía autoritativa declarativa: una
constraint declarativa exigiría denormalizar el estado del Work dentro de `CatalogIdentity` (composite
FK, como ADR-009) — no es un cambio pequeño y obligaría a tocar la persistencia de Conferir. Queda como
**deuda diferida**: la garantía autoritativa la dará el futuro coordinador de Fusionar (que, en una tx,
absorbe contenido y redirige la identidad bajo lock; además, mientras la identidad del absorbido sigue
activa, el índice parcial de designación ya impide una segunda identidad activa sobre ese Work).

## Relación futura con Fusionar (sin implementarla)

```ts
await prisma.$transaction(async (tx) => {
  const cat = await catalogMergeWriter.absorbWorkInto(tx, catalogCommand);
  if (cat.kind !== "EXECUTED" && cat.kind !== "ALREADY_ABSORBED") return /* resultado semántico */;
  const idn = await identityRegistro.mergeInTx(tx, mergeDecision); // NO implementado aún
  return /* resultado global */;
});
```
- **Permiten continuar:** `EXECUTED`, `ALREADY_ABSORBED`.
- **Obligan a abortar:** cualquier `REJECTED` (el coordinador traduce a su resultado de Fusionar).
- **Información para el coordinador:** `reparentedEditions`, `missing`, `conflicts`.
- **Rollback total:** una excepción o un `return` que no persiste dentro de la `$transaction` revierte
  todo; Catálogo no commitea nada por su cuenta.

Catálogo **no** depende de Identity (sin import inverso).

## Deuda deliberada

- Combinación/reconciliación de hechos descriptivos (v1 no combina; no detecta contradicciones — falta
  modelo de procedencia).
- Dedup de ediciones; slug de comunidad `cc:w{workId}:…` queda desactualizado tras re-parentar (cosmético).
- Partir, deshacer absorción, cadenas, compactación, borrado físico, auditoría general.
- Guard autoritativo declarativo de Conferir (hoy amable).

## Resultados reales

- `npm run check`: **531 passed | 41 skipped**, tsc limpio.
- Integración Postgres real (`npm run test:identity-it`): **41 passed** (identidad 29 + Catálogo 12),
  exit 0, PostgreSQL 18.4 efímero. La migración `20260723000000` aplica limpia (self-FK + CHECK).
- Unitarios de Catálogo: 14 (dominio 4 + write-port 10) + 1 guard de Conferir.
