# Slice de identidad — "Asociar una referencia externa a una Identity existente"

Segunda vertical del subsistema de identidad (ver Glosario Normativo, contratos de Adjudicación /
Registro / Identity, y [identity-confer-slice.md](identity-confer-slice.md)). SOLO **Asociar**.
Fusionar/Partir/Retirar/redirección **no** existen todavía.

## Semántica

Hacer que una referencia `(provider, externalId)` pase a resolver hacia una Identity existente, por
decisión de Adjudicación. La referencia **pertenece al namespace** (no es estado local de Identity,
no la define, es evidencia subordinada). NO crea Identity ni contenido.

## Flujo y capas

```
solicitud → Adjudicación (adjudicateAssociateExternalReference) emite la Decisión
  → Registro (makeAssociateRegistro().associate): idempotencia por decisionId → existencia del
    destino → estado válido → unicidad de referencia → insert atómico (1 fila)
  → Resultado (EXECUTED | ALREADY_SATISFIED | ALREADY_ASSOCIATED | REJECTED)
```

- **Dominio** (`lib/domain/identity/associate.ts`): Decisión, huella, `isAssociableState`, unión de
  Resultado, invariantes, costura de Adjudicación. Puro.
- **Infra / Registro** (`lib/infra/identity/associateRegistro.ts`): validación de namespace, insert
  atómico, resolución de conflicto **decisionId-primero** fuera de la tx.
- **Caso de uso** (`lib/identity/associateExternalReference.ts`): cablea Adjudicación → Registro. No
  cruza `runMutation` (contrato de retorno semántico).

## Decisiones semánticas

**Destino por estado.** ACTIVE → acepta (si la referencia está libre). REDIRIGIDA/RETIRADA →
`INVALID_IDENTITY_STATE` (regla **futura** documentada; hoy solo existe ACTIVE, no se simula). El
Registro **reporta**, no substituye el destino por su terminal (eso sería juzgar): Adjudicación debe
nombrar el handle terminal.

**Replay vs. estado ya satisfecho (distinción clave).**
- `ALREADY_SATISFIED` = replay de la **misma** decisión (huella coincide) → idempotencia **de decisión**.
- `ALREADY_ASSOCIATED` = la referencia **ya resolvía al mismo destino, por OTRA decisión** →
  idempotencia **por estado**. Son resultados **distintos** a propósito: separan "reintenté lo mismo"
  de "el mundo ya estaba así por otra vía" (auditoría, decisiones redundantes).

**Conflicto de referencia.** `(provider,externalId)` ligada: mismo destino → `ALREADY_ASSOCIATED`;
otro destino → `REFERENCE_ALREADY_BOUND`.

**Huella.** `{v:1, h:targetHandle, p:provider, e:externalId}` — destino + referencia. Distinta de la
de Conferir (contenido+clase+conjunto de refs); comparten formato, no contenido.

## Invariantes (mapa)

| Invariante | Alcance | Dónde |
|---|---|---|
| Identity no recibe/almacena la referencia; sin método de asociación | local | `isAssociableState` predicado; refs en tabla propia |
| Decisión completa (decisionId, destino, referencia) | decisión | `associateExternalReferenceDecision` |
| Destino existe (no-colgado) | global | pre-check + FK `identityId → CatalogIdentity` |
| Destino válido por estado | local (del destino) | `isAssociableState` (solo ACTIVE) |
| Unicidad de referencia | global | pre-check + `@@unique(provider, externalId)` |
| Idempotencia de decisión | global | `decisionId?` unique + huella |
| Atomicidad | global | 1 fila (referencia+decisión+huella) |

## Procedencia / persistencia

`IdentityExternalReference` gana `decisionId String? @unique` + `decisionFingerprint String?`
(migración `20260722010000`, **sin aplicar**, gated). Las **referencias semilla** de Conferir quedan
con NULL (múltiples NULL permitidos por Postgres). La asociación es **una sola fila** → decisión,
referencia y estado-para-replay son atómicos por construcción.

## Corrección introducida en Conferir (contradicción revelada)

Esta slice reveló una **contradicción concreta** de concurrencia que también afectaba a Conferir: una
**misma decisión** colisiona a la vez en varios constraints únicos (`decisionId`, designación,
referencia) y Postgres reporta *cualquiera*. La resolución de conflicto que ramificaba por el
constraint reportado podía clasificar un **replay** como conflicto de estado
(`ALREADY_ASSOCIATED`/`DESIGNATION_TAKEN`) en vez de `ALREADY_SATISFIED`. Fix en **ambos** Registros:
**decisionId-primero** — re-leer por `decisionId` antes de clasificar cualquier otro conflicto (el
replay domina). En Conferir quedó en su commit propio (`fix(identity): make confer conflict
resolution decisionId-first`); sin cambio de contrato. Hallazgo derivado: `classifyConferConflict`
**no** resultó compartido — Asociar (2 constraints) no lo necesita; se quedó local a Conferir.

## Tensiones encontradas (durante la verificación real)

1. El harness pasaba un glob literal a vitest → "No test files found". Corregido a lista explícita.
2. Correr las dos suites de integración en **paralelo contra una sola base** hacía que los `afterEach`
   (deleteMany global) se pisaran → falsos fallos. Corregido con `--no-file-parallelism` (serial).
3. La contradicción de concurrencia de arriba (corregida).
4. Proceso `postgres` huérfano bloqueando el arranque del efímero. Mitigado limpiando procesos+dir.

## Resultados (verificados)

- `npm run check`: **511 passed | 20 skipped**, tsc limpio.
- Integración Postgres real (`npm run test:identity-it`): **20 passed** (Conferir 11 + Asociar 9), exit 0.
- Unitarios de Asociar: 16.

## Deuda deliberada

- Migraciones de identidad **sin aplicar** (gated).
- Estados no-ACTIVE: regla documentada + guard; sin flujo productor (Fusionar/Retirar). El test los
  materializa directo (la columna lo permite), sin inventar flujo.
- Auditoría completa de decisiones: deuda (hoy decisionId + huella).
- Abstracciones candidatas (VO de referencia; protocolo de replay): **propuestas, no hechas** — a
  reconsiderar con la tercera evidencia (Fusionar). `classifyConferConflict` queda **descartado** como
  compartido.
