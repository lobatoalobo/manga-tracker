# Design Spec de ingeniería — "Fusionar dos identidades"

Especificación para implementar la futura vertical slice **Fusionar** sin improvisar. NO es
implementación ni reformulación del modelo. Se apoya en: el Glosario Normativo, el contrato
consolidado de Identity, la separación Adjudicación → Registro, las slices Conferir y Asociar ya
implementadas, y el schema real del repo.

> **Estado de bloqueo (actualizado):** las dos tensiones que bloqueaban la implementación quedaron
> **RESUELTAS** por ADRs: **T1** (coordinación identidad–contenido) → **ADR-008**; **T2** (integridad
> de referencias bajo concurrencia) → **ADR-009**. Este spec se actualizó para reflejar esas
> decisiones. Fusionar queda **desbloqueada** para implementación, con un pre-trabajo obligatorio (ver
> §L). Las secciones marcan lo que cambió respecto de la versión anterior.
>
> **IMPLEMENTADA (v1):** la slice Fusionar está implementada y validada en Postgres real — ver
> `docs/identity-merge-slice.md` (562 unit + 62 integración, 21 de ellas de Fusionar). Precisiones que la
> implementación fijó sobre este spec: (a) el "destino ACTIVE / anti-cadena" se garantiza
> **transaccionalmente bajo lock**, NO con una FK compuesta (a diferencia de T2/ADR-009, acá el único
> escritor de redirecciones ya lockea, así que no se denormalizó `redirectsToState`); (b) `STALE_DECISION`
> y `WOULD_CREATE_REDIRECT_CYCLE` resultaron **inalcanzables** en v1 (subsumidos por `INVALID_*_STATE` /
> `ALREADY_MERGED`) y NO se implementaron; (c) el namespace se parte en dos fases (`prepare`/`apply`) que
> viven ambas en el Registro, para intercalar la absorción de Catálogo sin que el coordinador tenga lógica
> de namespace; (d) el orden global de locks quedó congelado **Identidades → Works**.

> Alcance: solo Fusionar. NO Partir, NO deshacer, NO compactar cadenas, NO migrar colecciones, NO
> reconciliación automática, NO UI/moderación. Las dependencias que Fusionar crea para esas
> operaciones se dejan explícitas.

---

## A. Diagnóstico del estado actual (qué permite / impide hoy)

**Schema real relevante:**
- `CatalogIdentity`: `id` SERIAL (handle), `state` default `'ACTIVE'` (**solo ese valor en uso**),
  `contentClass`, `designatedWorkId` → `Work` **onDelete Restrict**, `decisionId` unique,
  `decisionFingerprint`, `createdAt`. Índice **parcial** único `designatedWorkId WHERE state='ACTIVE'`;
  índice en `designatedWorkId`. **No existe** columna de redirección.
- `IdentityExternalReference`: `identityId` → `CatalogIdentity` **onDelete Cascade**, `provider`,
  `externalId`, `decisionId?` unique, `decisionFingerprint?`. Único `(provider, externalId)`; índice
  `identityId`.
- `Work` (contenido): sin concepto de "retirada/absorbida"; `PublisherEdition.workId` la referencia.

**Qué PERMITE hoy:** representar identidades activas, sus referencias (namespace), e idempotencia por
decisión. El patrón de lock existe en el repo (`SELECT … FOR UPDATE` en `applyWritePort`).

**Qué IMPIDE hoy (cambios necesarios para Fusionar):**
1. **No hay forma de representar una redirección** (falta `redirectsToId` + uso del estado
   `REDIRECTED`). → cambio de schema NECESARIO.
2. **No hay procedencia para la decisión de fusión** (las columnas `decisionId`/`decisionFingerprint`
   ya están ocupadas por la decisión de *Conferir* que creó la fila). → columnas nuevas o tabla de
   decisiones.
3. **`designatedWorkId` es NOT NULL con FK Restrict**: la identidad absorbida no puede "dejar de
   designar" borrando su Work (Restrict), ni el Work absorbido puede eliminarse mientras la fila lo
   referencie. → define la política de contenido (T1).
4. **No hay coordinación identidad↔contenido**: fusionar dos identidades implica reconciliar dos
   Works (bounded context Catálogo). → T1.

---

## B. Semántica exacta de Fusionar

**Definición.** Declarar que dos handles que representaban identidades distintas corresponden a una
misma identidad; seleccionar una **sobreviviente** (la nombra Adjudicación) y hacer que la **no
sobreviviente** (absorbida) redirija hacia ella. **Ambos handles se preservan.**

**Autoridad.** Adjudicación decide *qué* fusionar y *cuál* sobrevive. El Registro **valida y ejecuta**;
puede **rechazar**, nunca **corregir inventando** otra decisión (p. ej. no elige la sobreviviente ni
substituye un handle por su terminal).

**Precondiciones (Registro, bajo lock):** ambos existen; distintos; sobreviviente ACTIVE; absorbida
ACTIVE; **misma `contentClass`**; la fusión no crea ciclo; (v1) la absorbida **no tiene redirecciones
entrantes** (ver §Chains). Contenido: ambas designan Works reconciliables (T1).

**Postcondiciones (éxito):**
- Sobreviviente: `ACTIVE`, sin redirect, sigue resolviendo a sí misma, designa el contenido resultante,
  recibe las referencias externas movidas de la absorbida.
- Absorbida: `REDIRECTED`, `redirectsToId = sobreviviente`, **sin referencias externas directas**
  (se movieron), **nunca vuelve a `ACTIVE` por esta operación**; conserva `designatedWorkId`
  histórico (no se recicla ni borra el handle).
- Namespace: todos los handles existen; ambos resuelven al mismo terminal activo; sin ciclos; sin
  referencias colgadas ni sobre identidades no terminales; sin doble designación activa; sin
  referencias duplicadas (imposible: `(provider,externalId)` ya es único global).

**No confundir:** Fusionar ≠ Redirección (la redirección es el *efecto*), ≠ borrar/reciclar handle, ≠
absorber filas técnicamente, ≠ reconciliar evidencia, ≠ decidir cuál sobrevive.

---

## C. Alternativas de diseño (identidad ↔ contenido; movimiento de referencias)

### Coordinación identidad ↔ contenido — **T1 → RESUELTA por ADR-008**

Dos identidades activas designan **Works distintos** (por el índice parcial `designatedWorkId WHERE
ACTIVE`, un Work tiene a lo sumo una identidad activa). Por lo tanto **toda fusión implica reconciliar
dos Works** — un asunto del bounded context **Catálogo**, no del namespace. Una fusión "solo namespace"
es incoherente: dejaría el Work absorbido sin identidad activa. Esto **no** es una contradicción del
modelo (identidad y contenido siempre fueron responsabilidades separadas), pero es la decisión de
diseño más delicada. Alternativas:

| | A — Fusión atómica identidad+contenido en el Registro | B — Caso de uso coordina (1 tx, 2 write-ports) | C — Namespace puro con contenido ya consolidado antes |
|---|---|---|---|
| Propiedad de invariantes | Registro invade invariantes de Catálogo | cada servicio protege los suyos | Registro puro; Catálogo aparte |
| Atomicidad | 1 tx | **1 tx** | 2 tx → **estado intermedio ilegal** |
| Estados intermedios | ocultos en tx | ocultos en tx | expuestos entre pasos |
| Separación de contextos | **rota** (Registro toca Work/Edition) | preservada (composición en app/infra) | preservada |
| Rollback | tx | tx | parcial/manual |
| Claridad de autoridad | difusa | clara (Adjudicación decide; cada Registro valida) | clara |
| Acoplamiento con Prisma | Registro acoplado a tablas de Catálogo | acoplamiento solo en la frontera tx del caso de uso | mínimo |
| Futuro Partir | hereda el acople | simétrico y reutilizable | requiere el mismo pre-paso |

**Decisión congelada (ADR-008): Alternativa B** (en el ADR se numera **A** — "caso de uso de aplicación
coordinador"; misma opción). Un caso de uso `mergeIdentities` abre **una** transacción Prisma que compone
dos write-ports **específicos** (que reciben el `TransactionClient` compartido): (1) consolidación de
contenido (Catálogo `absorbWorkInto`: re-parentar ediciones del Work absorbido al sobreviviente, marcar
el absorbido) y (2) fusión de namespace (Registro: mover referencias, transición de estado, redirección).
El dominio permanece separado; el acoplamiento es solo la frontera transaccional en la capa de
aplicación. A (Registro coordinador) rompe la separación; C introduce estados intermedios ilegales; D
(saga) es innecesaria para algo que cabe en una tx.

> **Dependencia congelada (ADR-008), dentro del alcance del caso de uso de Fusionar:** write-port de
> Catálogo `absorbWorkInto(tx, survivorWorkId, absorbedWorkId, mergePlan) → CatalogAbsorptionResult`.
> v1: re-parenta ediciones, **no combina hechos descriptivos** (diferido), marca el Work absorbido con
> `Work.absorbedIntoId` (nuevo, self-FK; el absorbido queda **detached**, no se borra — perpetuidad +
> FK Restrict). Catálogo valida/ejecuta reglas mecánicas; los hechos contradictorios que requieran
> juicio → `CONTENT_CONFLICT_REQUIRES_JUDGMENT` (aborta la tx). Reconciliación de hechos descriptivos y
> guard de Conferir contra Works absorbidos = follow-ups (ver ADR-008).

### Movimiento de referencias — **físico vs indirecto**

| | Movimiento físico (`UPDATE identityId = sobreviviente`) | Resolución indirecta (quedan en la absorbida, se sigue la cadena) |
|---|---|---|
| ¿Referencia sobre identidad no terminal? | **no** (queda sobre la activa) | **sí** (sobre la REDIRECTED) → viola el invariante |
| Reconciliación futura | resuelve directo a activa | requiere seguir cadena siempre |
| Complejidad de resolución | nula | dependemos de resolución de cadenas (no existe aún) |

**Recomendación: movimiento físico** — confirma tu hipótesis. El invariante aprobado "ninguna
referencia sobre una identidad no terminal" lo exige. **Clave:** como `(provider, externalId)` ya es
único global, **una referencia existe una sola vez** — nunca está en ambas identidades a la vez, así
que `UPDATE identityId = sobreviviente WHERE identityId = absorbida` **no puede** violar esa unicidad.
Los conflictos de *proveedor* (dos ids del mismo provider en el Work resultante) **no** son un
constraint de base (no hay cardinalidad por proveedor) → son **juicio** de Adjudicación, no algo que el
Registro pueda detectar hoy (ver §Referencias).

---

## D. Diseño recomendado (flujo + frontera transaccional)

```
Adjudicación (nombra sobreviviente + absorbida) → MergeDecision
→ mergeIdentities (caso de uso): UNA tx Prisma
   1. idempotencia: leer por mergeDecisionId (replay/divergente)
   2. lock: SELECT … FOR UPDATE de ambas identidades, ORDENADAS por id (anti-deadlock)
   3. re-validar bajo lock: existencia, distinción, sobreviviente ACTIVE, absorbida ACTIVE,
      misma contentClass, absorbida sin redirecciones entrantes (v1), no-ciclo, estado ya-fusionado
   4. contenido (Catálogo write-port): absorbWorkInto(survivorWork, absorbedWork)  [T1]
   5. mover referencias: UPDATE IdentityExternalReference SET identityId = sobreviviente
      WHERE identityId = absorbida
   6. transición absorbida: state = 'REDIRECTED', redirectsToId = sobreviviente
   7. persistir procedencia de la fusión: mergeDecisionId + mergeDecisionFingerprint en la fila absorbida
→ Resultado de ejecución (EXECUTED | ALREADY_SATISFIED | ALREADY_MERGED | REJECTED …)
→ commit (todo o nada)
```

**Frontera transaccional:** una sola `prisma.$transaction`. Los pasos 4–7 conviven bajo el lock del
paso 2; los estados intermedios son invisibles hasta el commit. Rechazos de precondición retornan
**antes** de cualquier escritura. La verificación de idempotencia (paso 1) puede ser previa al lock,
pero el paso 3 la re-confirma bajo lock (patrón "R1" del framework).

---

## E. Modelo de concurrencia

**Mecanismo recomendado:** **locks pesimistas de fila** (`SELECT … FOR UPDATE`) sobre **ambas**
identidades, **ordenados por `id` ascendente** para evitar deadlocks (dos merges que tocan el mismo par
adquieren los locks en el mismo orden). Es el mecanismo que **ya usa el repo** (Apply lockea la
propuesta con `FOR UPDATE`). Nivel de aislamiento `READ COMMITTED` (default de Postgres/Prisma) basta:
el lock serializa las fusiones que comparten una fila; la re-lectura bajo lock (paso 3) ve el estado
comprometido más reciente. **No** se recomienda serializable global (costoso) ni optimistic-only (las
transiciones de grafo necesitan exclusión real). Los constraints únicos siguen siendo la guardia
autoritativa de idempotencia (`mergeDecisionId`).

Carreras del §11 (todas se comprueban con Postgres real, ver §H):

| # | Carrera | Resultado de dominio | Garantía | Lectura a repetir |
|---|---|---|---|---|
| 1 | dos fusiones sobre el mismo absorbido (A→B, A→C) | una EXECUTED, otra `INVALID_ABSORBED_STATE` | lock en A + re-leer estado | estado de A |
| 2 | mismo sobreviviente, distintos absorbidos (A→S, B→S) | ambas EXECUTED (secuencial) | lock en S serializa; refs no colisionan | estados de A/B/S |
| 3 | A→B concurrente con B→A | una EXECUTED; la otra `INVALID_SURVIVOR_STATE` | lock ordenado; el survivor quedó REDIRECTED | estado del survivor |
| 4 | A→B concurrente con B→C | una EXECUTED; la otra rechazada (v1: absorbida/survivor no ACTIVE o con redirect entrante) | lock en B + regla anti-cadena | estado de B |
| 5 | **Fusión vs Asociar sobre la absorbida** | insert de Asociar rechazado → `INVALID_IDENTITY_STATE` | **FK compuesta (ADR-009)**; sin lock en Asociar | FK re-evalúa estado al commit |
| 6 | Fusión vs Conferir compitiendo por contenido | Conferir sobre el Work absorbido: DESIGNATION_TAKEN (absorbida aún ACTIVE) o, tras commit, crea identidad nueva sobre Work *detached* (edge, bajo riesgo) | índice parcial de designación | designación del Work |
| 7 | replay concurrente de la misma MergeDecision | EXECUTED + `ALREADY_SATISFIED` | `mergeDecisionId` unique → P2002 → re-leer huella | fila por mergeDecisionId |
| 8 | mismo mergeDecisionId, payload divergente | `DECISION_ID_REUSED_DIVERGENTLY` | huella distinta | fila por mergeDecisionId |
| 9 | dos decisiones distintas, mismo estado final | `ALREADY_MERGED` (estado ya satisfecho por otra decisión) | absorbida ya REDIRECTED→survivor | redirect de la absorbida |
| 10 | estado cambió entre Adjudicación y ejecución | `STALE_DECISION` (o el invariante de estado puntual) | re-lectura bajo lock | ambos estados |

> **T2 → RESUELTA por ADR-009 (FK compuesta declarativa).** La garantía autoritativa NO es un trigger ni
> un lock en Asociar, sino una **FK compuesta**: `IdentityExternalReference(identityId, identityState) →
> CatalogIdentity(id, state)` con `identityState` CHECK-eado a `'ACTIVE'` y `ON UPDATE RESTRICT`. Un
> insert sobre una Identity `REDIRECTED` **falla por FK** (no existe `(id,'ACTIVE')`) → Asociar lo
> traduce a `INVALID_IDENTITY_STATE`. Y flipear una Identity a `REDIRECTED` **falla** (RESTRICT) mientras
> tenga referencias apuntándola → **fuerza mover las referencias antes** del cambio de estado. Fusionar
> conserva los locks `FOR UPDATE` **solo** por su coordinación de grafo (carreras 1–4/9–10), no por este
> invariante. Cambio a Asociar: **solo traducción de P2003 → `INVALID_IDENTITY_STATE`** (sin lock nuevo).
> **Fortificación implementada y validada en Postgres real** (29 tests de integración verdes; ver ADR-009
> "Evidencia observada" y `docs/identity-associate-slice.md`).

**Chains (regla anti-cadena v1):** para no razonar cadenas en la primera slice, **la absorbida debe no
tener redirecciones entrantes** y el sobreviviente debe estar ACTIVE. Así toda redirección es de **un
solo salto** hacia una identidad terminal-activa, y la prevención de ciclos es trivial (un ciclo
exigiría que el sobreviviente ya redirija a la absorbida, imposible si el sobreviviente es ACTIVE).
Consecuencia (dependencia futura): **soporte de cadenas + compactación** queda para una slice posterior;
hasta entonces, "absorber un sobreviviente" se rechaza y Adjudicación re-decide.

---

## F. Resultados semánticos (solo alcanzables)

| Resultado | Escenario exacto | Devuelve | Próximo paso de Adjudicación | Se diferencia de |
|---|---|---|---|---|
| `EXECUTED` | fusión aplicada | handles sobreviviente/absorbida | nada | — |
| `ALREADY_SATISFIED` | replay de **la misma** MergeDecision (huella coincide) | handles | nada | `ALREADY_MERGED` (otra decisión) |
| `ALREADY_MERGED` | **otra** decisión encuentra que la absorbida ya redirige al mismo sobreviviente | handles | nada (estado ya satisfecho) | replay (misma decisión) |
| `DECISION_ID_REUSED_DIVERGENTLY` | mismo mergeDecisionId, huella distinta | — | corregir el id o la intención | replay |
| `IDENTITY_NOT_FOUND` | algún handle no existe | cuál falta | re-derivar | — |
| `SAME_IDENTITY` | sobreviviente == absorbida | — | error de decisión | — |
| `INVALID_SURVIVOR_STATE` | sobreviviente no ACTIVE (REDIRECTED/RETIRED) | estado actual | nombrar el terminal / re-derivar | `INVALID_ABSORBED_STATE` |
| `INVALID_ABSORBED_STATE` | absorbida no ACTIVE, o (v1) con redirecciones entrantes | estado actual | re-derivar | `INVALID_SURVIVOR_STATE` |
| `CONTENT_CLASS_INCOMPATIBLE` | distinta `contentClass` | ambas clases | no fusionar (cross-type) | — |
| `STALE_DECISION` | precondición asumida (estado observado) ya no vale | qué cambió | re-derivar contra estado actual | `ALREADY_MERGED` (ya en el destino) |
| `CONTENT_MERGE_REQUIRED` **(condicional)** | contenido no reconciliable sin juicio (conflicto de referencias de proveedor / hechos contradictorios) | naturaleza del conflicto | resolver contenido / emitir nueva decisión | rechazos de identidad |

**No incluidos por ahora:** `WOULD_CREATE_REDIRECT_CYCLE` colapsa en `INVALID_SURVIVOR_STATE`/
`INVALID_ABSORBED_STATE` bajo la regla anti-cadena v1 (no hay cadenas que puedan ciclar). `REFERENCE_CONFLICT`
por cardinalidad de proveedor **no es detectable** con el schema actual (no hay constraint de
cardinalidad) → hoy es juicio de Adjudicación; se representaría como `CONTENT_MERGE_REQUIRED` sólo si se
decide bloquear la fusión ante ese conflicto (decisión de Catálogo, T1).

---

## G. Estrategia de idempotencia

**Huella `mergeDecisionFingerprint`** = `{v:1, s:survivorHandle, a:absorbedHandle}` (+ cualquier
política de contenido que forme parte de la intención, si se decide incluirla — ver §MergeDecision). El
orden **no** es simétrico: `s` y `a` tienen roles distintos, así que `(s=A,a=B)` ≠ `(s=B,a=A)` (son
fusiones diferentes). Reglas:
- mismo mergeDecisionId + misma huella → `ALREADY_SATISFIED` (**replay**).
- mismo mergeDecisionId + huella distinta → `DECISION_ID_REUSED_DIVERGENTLY`.
- **otra** decisión, absorbida ya redirige al mismo sobreviviente → `ALREADY_MERGED` (**estado ya
  satisfecho**), distinto del replay.
- otra decisión incompatible con el estado (absorbida redirige a **otro**, o estados cambiaron) →
  `STALE_DECISION` / invariante de estado.

Distinción explícita de los cuatro: **replay** (misma decisión) ≠ **estado ya satisfecho**
(`ALREADY_MERGED`, otra decisión, mismo fin) ≠ **obsoleta** (`STALE_DECISION`, la precondición cambió)
≠ **contradictoria** (`DECISION_ID_REUSED_DIVERGENTLY`, mismo id otra intención).

**Dónde vive la procedencia:** columnas `mergeDecisionId`/`mergeDecisionFingerprint` en la fila
**absorbida** (es la que transiciona). NO se reusan `decisionId`/`decisionFingerprint` (ocupadas por la
decisión de Conferir de esa fila). Alternativa general (más limpia si las decisiones proliferan): una
**tabla de decisiones** de identidad → **ADR futuro** (§18), no bloqueante para v1.

---

## H. Matriz de tests (de la implementación futura)

**Unitarios de dominio** (dobles): construcción de MergeDecision (requiere decisionId + ambos handles;
rechaza `SAME_IDENTITY` a nivel decisión si aplica); huella (cambia con sobreviviente/absorbida;
estable ante mismo input; asimétrica); predicados de estado legal (sobreviviente/absorbida); unión de
Resultado.

**Registro con dobles:** existencia, distinción, estados (survivor/absorbed ACTIVE), clase compatible,
regla anti-cadena, orden lógico, **ausencia de escritura ante cualquier rechazo**, el Registro no
substituye la sobreviviente ni corrige la decisión.

**Integración Postgres real** (harness efímero existente, `--no-file-parallelism`): fusión persistida
(referencias movidas, absorbida REDIRECTED+redirectsToId, sobreviviente intacta); replay; reuso
divergente; `ALREADY_MERGED`; clase incompatible; handle inexistente; movimiento real de todas las
referencias; traducción real de P2002 (mergeDecisionId).

**Concurrencia Postgres real:** las 10 carreras del §E (incluida, cuando se resuelva, la T2).

**Fallos inyectados (que NO deben quedar):** identidad redirigida con referencias **sin mover**;
contenido absorbido **sin** redirección; redirección con estado **incorrecto**; decisión persistida
**sin** mutación; mutación **sin** procedencia para replay. Cada uno = un test que fuerza el fallo entre
pasos y verifica rollback total.

---

## I. Impacto técnico previsto

| Área | Cambio | Nivel |
|---|---|---|
| Schema `CatalogIdentity` | `redirectsToId Int?` (self-FK) + índice; uso de `state='REDIRECTED'`; `UNIQUE(id, state)` (para la FK compuesta de ADR-009) | **necesario** |
| Schema `CatalogIdentity` | `mergeDecisionId String? @unique` + `mergeDecisionFingerprint String?` | **necesario** (o tabla de decisiones) |
| Schema `IdentityExternalReference` | `identityState` (DEFAULT `'ACTIVE'`, CHECK) + FK compuesta `(identityId, identityState) → CatalogIdentity(id, state)` ON UPDATE RESTRICT — **ADR-009** | **necesario** |
| Índice | índice en `redirectsToId` (para "redirecciones entrantes" y resolución) | **necesario** |
| Migración SQL | (pre-Fusionar) FK compuesta de ADR-009; (Fusionar) redirectsToId + procedencia. **Sin aplicar** (gated) | **necesario** |
| Dominio | `lib/domain/identity/merge.ts` (MergeDecision, huella, estados legales, Resultado, Adjudicación) | **necesario** |
| Infra Registro | `lib/infra/identity/mergeRegistro.ts` (namespace: lock, transición, mover refs, redirección) | **necesario** |
| Catálogo | `Work.absorbedIntoId` (self-FK) + write-port `absorbWorkInto(...)` (re-parentar ediciones, marcar detach) — **ADR-008** | **necesario (dependencia)** |
| Caso de uso | `lib/identity/mergeIdentities.ts` (coordina Catálogo + Registro en 1 tx — ADR-008) | **necesario** |
| Asociar (endurecimiento pre-Fusionar) | traducir P2003 (FK compuesta) → `INVALID_IDENTITY_STATE`; **sin lock nuevo** — **ADR-009** | **necesario** |
| Tests | `tests/identity-merge.test.ts` + `…integration.test.ts`; harness suma el archivo | **necesario** |
| Docs | `docs/identity-merge-slice.md` al cerrar | **necesario** |
| Conferir (follow-up) | guard contra conferir sobre Work absorbido (`absorbedIntoId`) | **opcional (bajo riesgo)** |

SQL ilustrativo (solo para fijar la transición, **no** implementación):
```sql
-- (bajo lock FOR UPDATE de ambas filas, dentro de una tx)
UPDATE "IdentityExternalReference" SET "identityId" = :survivor WHERE "identityId" = :absorbed;
UPDATE "CatalogIdentity"
  SET "state" = 'REDIRECTED', "redirectsToId" = :survivor,
      "mergeDecisionId" = :decisionId, "mergeDecisionFingerprint" = :fp
  WHERE id = :absorbed AND state = 'ACTIVE';
```

---

## J. Abstracciones (tercera evidencia)

Fusionar es la **tercera** operación de decisión del subsistema. Aporta evidencia sobre qué es
protocolo compartido real:

**Protocolo compartido probado por las tres** (Conferir, Asociar, Fusionar):
- `decisionId` + `fingerprint` + **resolución de conflicto decisionId-primero** + replay
  (ALREADY_SATISFIED) + `DECISION_ID_REUSED_DIVERGENTLY` + frontera transaccional + lectura fresca
  post-conflicto + forma del Resultado semántico.

**Diferencias que deben permanecer específicas:**
- Fusionar es **multi-identidad** (dos handles + locks + transición de estados + redirección + grafo);
  Conferir/Asociar son de una identidad. Su concurrencia es de **grafo** (cadenas, ciclos), no de fila.
- `classifyConferConflict` sigue **descartado** como compartido (Asociar ya lo demostró; Fusionar usa
  `mergeDecisionId`-primero, tampoco lo necesita).
- Huellas y payloads de Resultado divergen (contenido distinto por operación).

**Recomendación (tras implementar Fusionar, NO ahora):**
- **Extraer, justificado por 3 evidencias:** (1) `ExternalReference` VO + `normalizeExternalReference`
  (mismo VO en las tres); (2) **protocolo de replay** `resolveExistingDecision(prior, decision,
  fingerprintFn)` (idéntico estructural en las tres) — parametrizado por la función de huella y el eco.
- **Seguir prohibido:** `IdentityDecision`/`BaseDecision`/`GenericExecutionResult<T>`/`DecisionHandler`/
  `RegistryCommand`. Fusionar **confirma** que los contenidos de decisión y los conjuntos de resultados
  divergen lo suficiente como para que un genérico borre distinciones (p. ej. `ALREADY_MERGED`,
  transiciones de estado, locks de grafo). La abstracción correcta es la de los **dos utilitarios**, no
  la de una jerarquía de comando/decisión.

---

## K. Riesgos y deuda deliberada

- **T1 → RESUELTA (ADR-008) e IMPLEMENTADA:** el write-port de Catálogo `absorbWorkInto` +
  `Work.absorbedIntoId` está **implementado y validado en Postgres real** (12 tests de integración;
  ver `docs/catalog-work-absorption-slice.md`). Recibe la tx del futuro coordinador, no la abre.
  Queda como *deuda diferida* la reconciliación de hechos descriptivos (v1 no combina); el guard de
  Conferir contra Works absorbidos quedó implementado (amable), con la garantía autoritativa diferida.
- **T2 → RESUELTA (ADR-009):** FK compuesta declarativa (no trigger, no lock en Asociar). Endurecimiento
  de Asociar (traducción de P2003) = pre-trabajo necesario antes de Fusionar.
- **Cadenas + compactación:** v1 las prohíbe (redirección de un salto); soporte de cadenas y compactación
  = slice futura.
- **Deshacer una fusión, Partir:** fuera de alcance; Fusionar crea la dependencia (redirectsToId,
  procedencia) que Partir/undo necesitarán.
- **Migración de dependencias inobservables** (Colección, URLs, favoritos, notificaciones): el Registro
  no las coordina; la **garantía** que ofrece es la **redirección** (resuelven al terminal siguiendo el
  redirect). Su migración física NO se diseña acá.
- **Cardinalidad de referencias por proveedor:** no hay constraint; conflictos de proveedor son juicio
  de Adjudicación, no detectables por el Registro.
- **Auditoría completa de decisiones:** sigue como deuda (hoy: id + huella).

---

## L. Recomendación final (respuestas directas)

1. **¿Fusionar en una sola transacción?** **Sí** — una `prisma.$transaction` que compone contenido
   (Catálogo) + namespace (Registro). La atomicidad y el rollback dependen de ello.
2. **¿Quién coordina contenido e identidad?** Un **caso de uso de aplicación** (Alternativa B), no el
   Registro (que gobierna solo el namespace) ni el dominio. El dominio permanece separado por contexto.
3. **¿Las referencias se mueven o se resuelven indirecto?** **Se mueven físicamente** (`UPDATE
   identityId`). Es lo que exige el invariante "ninguna referencia sobre identidad no terminal", y es
   seguro porque `(provider,externalId)` ya es único global (una referencia existe una sola vez).
4. **¿Mecanismo de concurrencia?** **Locks pesimistas de fila** (`SELECT … FOR UPDATE` sobre ambas
   identidades, **ordenados por id**) + re-validación bajo lock, con `READ COMMITTED`; los constraints
   únicos (`mergeDecisionId`) como guardia de idempotencia. Es el patrón que ya usa el repo.
5. **¿Qué congelar antes de escribir código?** ADRs bloqueantes: (i) **coordinación identidad↔contenido**
   (Alternativa B + contrato de `absorbWorkInto`); (ii) **representación de redirección** (`redirectsToId`
   + estado `REDIRECTED`); (iii) **movimiento físico de referencias**; (iv) **resolución de T2** (dónde
   se garantiza "referencia solo sobre ACTIVE"). ADRs no bloqueantes: locks/concurrencia (ya hay
   precedente), procedencia por-columna vs tabla de decisiones, semántica `ALREADY_MERGED` vs replay.
6. **¿Se puede empezar a implementar tras este spec?** **Sí — desbloqueada.** T1 y T2 quedaron resueltas
   por ADR-008 y ADR-009 respectivamente, sin contradicciones residuales. Pre-trabajo obligatorio, en
   orden: (1) **endurecer Asociar** (migración de la FK compuesta de ADR-009 + traducción de P2003 →
   `INVALID_IDENTITY_STATE`) y validarlo con Postgres real; (2) implementar la dependencia de Catálogo
   (`Work.absorbedIntoId` + write-port `absorbWorkInto`) según ADR-008; (3) recién entonces la slice
   Fusionar (dominio + Registro namespace + caso de uso coordinador). El resto del spec (flujo, orden,
   locks, resultados, idempotencia, tests) está cerrado.

---

## Apéndice — Frontera Registro / Adjudicación (§14)

| Pregunta | Adjudicación | Registro |
|---|---:|---:|
| ¿Son realmente la misma identidad? | Sí | No |
| ¿Cuál sobrevive? | Sí | No |
| ¿Ambos handles existen / distintos? | asume | **valida** |
| ¿Estados actuales (ACTIVE/…) lo permiten? | asume | **valida** (bajo lock) |
| ¿La referencia puede moverse sin romper unicidad? | No | Sí (mecánico) |
| ¿El estado cambió desde que se decidió? | No | Sí (re-lectura) |
| ¿La fusión crearía un ciclo / cadena no terminal? | No | Sí |
| ¿Clases de contenido compatibles? | asume | **valida** |
| ¿Cómo combinar hechos contradictorios del contenido? | Sí (o Catálogo) | No |
| ¿Qué referencia de proveedor gana si hay conflicto? | Sí | No |

Regla estricta: **el Registro puede rechazar una decisión; nunca la corrige inventando otra.** Si para
ejecutar tuviera que inventar un dato faltante (p. ej. el terminal de un handle redirigido, o cuál
referencia de proveedor conservar), cruzó de validar a juzgar → debe **reportar**, no actuar.
