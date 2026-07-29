# Slice de identidad — "Conferir una Identity"

Primer vertical del subsistema de identidad (ver Glosario Normativo del Dominio y los
contratos de Adjudicación / Registro de Identidad / Identity). SOLO **Conferir**. Fusionar,
Partir, Retirar y corregir redirecciones **no** existen todavía y no deben inferirse de este
código.

## Flujo

```
solicitud (ConferDecisionInput)
  → Adjudicación (adjudicateConferNew) juzga "contenido nuevo" y emite la Decisión
  → Registro (makeRegistro().confer) valida el namespace, asigna un handle,
    crea la Identity ACTIVE, asocia las referencias semilla
  → Resultado de ejecución (EXECUTED | ALREADY_SATISFIED | REJECTED)
```

## Capas

- **Dominio** (`lib/domain/identity/confer.ts`, `adjudication.ts`): puro. Construye/valida la
  Decisión, afirma los invariantes LOCALES del nacimiento, define el Resultado y el puerto del
  Registro. No conoce namespace ni persistencia.
- **Infra / Registro** (`lib/infra/identity/registro.ts`): custodio del namespace con Prisma.
  Valida los invariantes GLOBALES y ejecuta atómicamente. Devuelve Resultado semántico (no throw).
- **Caso de uso** (`lib/identity/conferIdentity.ts`): adaptador mínimo que cablea Adjudicación →
  Registro. No cruza `runMutation` (su contrato de retorno es semántico, no throw/affected).

## Dónde vive cada invariante

| Invariante | Alcance | Dónde se protege |
|---|---|---|
| Nace ACTIVE, 1 designación, sin redirección/retiro, clase fijada | local | `birthIdentity` (dominio) |
| Identity no posee referencias locales | local | ausencia de campo en `BirthState`; refs en tabla propia |
| Decisión completa / referencias no duplicadas | decisión | `conferDecision` (dominio) |
| Designación única (contenido ↔ 1 identidad ACTIVE) | global | pre-check + índice parcial `WHERE state='ACTIVE'` |
| Unicidad de referencia | global | pre-check + `@@unique(provider, externalId)` |
| Handle fresco / no reuso | global | sequence de la DB + filas nunca borradas |
| Idempotencia SEMÁNTICA (misma decisión) | global | `decisionId` único + huella `decisionFingerprint` |
| Reuso divergente del `decisionId` | global | comparación de huella → `DECISION_ID_REUSED_DIVERGENTLY` |
| Atomicidad | global | identidad + refs en un `create` anidado (una tx) |

Los pre-checks en memoria dan el camino amable; las **restricciones únicas** son la guardia
autoritativa bajo concurrencia (P2002 → Resultado, traducido FUERA de la tx porque Postgres la
aborta tras el conflicto).

## Idempotencia semántica

El `decisionId` es el identificador de la Decisión; la **identidad semántica** completa es la
huella canónica `conferDecisionFingerprint` = (contenido designado + clase + referencias semilla
como **conjunto ordenado** — el orden de las semillas no tiene significado). Reglas:

- mismo `decisionId` + misma huella → `ALREADY_SATISFIED` (idempotente);
- mismo `decisionId` + huella distinta → `REJECTED / DECISION_ID_REUSED_DIVERGENTLY`;
- mismo contenido + otro `decisionId` → `REJECTED / DESIGNATION_TAKEN`.

Se eligió **huella persistida** (una columna `decisionFingerprint`) sobre "comparar datos
persistidos": el replay se resuelve con una única comparación exacta de strings, sin releer las
referencias ni reconstruir el conjunto en cada intento. Es la solución mínima para esta slice; NO
es un sistema general de auditoría de decisiones.

## Auditoría: qué garantiza hoy y qué no

Persistir `decisionId` + `decisionFingerprint` **NO** equivale a registrar completamente la
Decisión. Hoy se garantiza: (1) **idempotencia** por identificador de decisión; (2) **detección de
reuso divergente** por huella semántica; (3) **trazabilidad mínima** de qué decisión (id) confirió
cada identidad y con qué intención canónica, más el `createdAt`.

**No se conserva todavía:** el actor que decidió, el momento del juicio (más allá del `createdAt`
de la fila), la evidencia/Reconciliación que respaldó el "es nuevo", ni un historial de las
decisiones (incluidas las rechazadas). La **auditoría completa de decisiones queda como deuda
deliberada** (no se diseñó un registro general en esta slice).

## Semántica de asignación del handle (normativa)

El handle es el `id` SERIAL (sequence de Postgres), **no** transaccional. Por lo tanto:

- los handles **no prometen contigüidad**: puede haber huecos;
- un valor **consumido por una operación abortada** (p. ej. el perdedor de una carrera cuyo INSERT
  aborta por P2002) **puede no materializarse**;
- un handle **nunca se reutiliza** (las filas no se borran y la sequence solo avanza);
- esto es **compatible con el invariante de frescura/no-reuso**: un hueco es un valor que nadie
  usó — más seguro aún que reutilizar. El Registro no acuña handles en memoria.

El test de integración verifica handles **únicos y monótonos** a través de un intento abortado, sin
afirmar contigüidad (que no es invariante).

## Traducción de P2002 (dependencia encapsulada)

Discriminar el conflicto se aísla en `classifyConferConflict(target)` (infra), cubierta por tests.
Depende de que `meta.target` de Prisma **contenga el nombre de campo** del constraint infringido —
cierto en ambas formas que Prisma reporta: array de campos (constraints del schema) o el **nombre
del índice** (para el índice parcial crudo), porque los índices se nombran con sus campos. No es un
traductor universal de errores Prisma: sólo cubre los tres constraints de esta slice. Si una versión
de Prisma cambiara el formato de `meta.target`, esta única función es el punto de ajuste.

## Resultados alcanzables (y los que no)

Alcanzables: `EXECUTED`, `ALREADY_SATISFIED`, `REJECTED` (invariantes: `DESIGNATION_TAKEN`,
`REFERENCE_ALREADY_BOUND`, `CONTENT_CLASS_INCOMPATIBLE`, `DESIGNATED_CONTENT_NOT_FOUND`).

Deliberadamente ausentes: **información insuficiente** (la Decisión exige todos los datos en su
construcción; una incompleta ni se construye), **decisión obsoleta** (para Conferir la staleness
colapsa en `DESIGNATION_TAKEN` / `DESIGNATED_CONTENT_NOT_FOUND`; no se inventa versionado),
**handle no fresco** (imposible con sequence + no-borrado).

## Estado de la migración

`prisma/migrations/20260722000000_add_catalog_identity/` **NO está aplicada**: la base es
compartida/gated. Se aplica con `prisma migrate deploy` sobre staging/base desechable. El índice
parcial de designación única es SQL crudo (Prisma no lo expresa en el DSL).

## Tests

- Unitarios de dominio + Registro con dobles: `tests/identity-confer.test.ts` (corre siempre en
  `npm run check`; incluye huella semántica y `classifyConferConflict`).
- Integración con base real (invariantes globales + concurrencia): `tests/identity-confer.integration.test.ts`,
  **skip** salvo que `IDENTITY_TEST_DATABASE_URL` apunte a una base DESECHABLE con el schema aplicado.

### Correr la integración (Postgres efímero, reproducible)

Sin base compartida: `npm run test:identity-it` levanta un PostgreSQL **efímero y aislado**
(`embedded-postgres`, binario real — no un mock) en `.tmp-identity-pg/` (git-ignored), aplica todas
las migraciones (`prisma migrate deploy`) sobre una base limpia, corre la suite de integración y
tira todo abajo. El cluster se inicializa en UTF8 (`--encoding=UTF8 --locale=C`) porque hay
migraciones con caracteres UTF-8 en comentarios. En CI, correr el mismo script (o apuntar
`IDENTITY_TEST_DATABASE_URL` a un Postgres de servicio ya migrado).
