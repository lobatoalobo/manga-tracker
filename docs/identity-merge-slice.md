# Slice de Identidad — "Fusionar dos identidades"

Tercera mutación del namespace (tras Conferir y Asociar) y la primera MULTI-identidad. Implementa el
Design Spec (`docs/identity-merge-design-spec.md`), ADR-008 (coordinación identidad↔contenido) y ADR-009
(integridad de referencias). NO implementa Partir, deshacer, compactación/cadenas, reconciliación de
hechos, auditoría general, UI ni fusión automática.

## Semántica implementada

Fusionar declara que dos handles que hoy representan identidades ACTIVE distintas corresponden a una misma
identidad: conserva una **sobreviviente** (la nombra Adjudicación) y transforma la otra (**absorbida**) en
una **redirección permanente** hacia la sobreviviente. Ambos handles se preservan; ninguno se recicla.

**Precondiciones (bajo lock):** ambas existen; distintas; sobreviviente ACTIVE (sin redirect); absorbida
ACTIVE (sin redirect); misma `contentClass`; la absorbida sin redirecciones entrantes (v1 no encadena);
el contenido de ambas es reconciliable por Catálogo (slots de edición no solapados).

**Postcondiciones (éxito):**
- Sobreviviente: `ACTIVE`, sin `redirectsToId`, sigue designando su Work, **recibe todas** las referencias
  externas de la absorbida, resuelve hacia sí misma.
- Absorbida: `REDIRECTED`, `redirectsToId = sobreviviente`, **sin referencias externas** (se movieron),
  conserva su `designatedWorkId` histórico (ahora un Work absorbido), **no vuelve a ACTIVE** por esta
  operación, guarda la procedencia (`mergeDecisionId`/`mergeDecisionFingerprint`).
- Namespace: ambos handles existen y resuelven al mismo terminal activo; sin ciclos, sin cadenas (v1),
  sin referencias sobre identidades no terminales, sin doble designación activa.

## Estado inicial y final

| | Sobreviviente | Absorbida | Work sobreviviente | Work absorbido |
|---|---|---|---|---|
| Inicial | ACTIVE, designa Ws | ACTIVE, designa Wa | activo, sus ediciones | activo, sus ediciones |
| Final | ACTIVE (sin cambios de identidad) | REDIRECTED → sobreviviente, con procedencia | activo, gana las ediciones re-parentadas | `absorbedIntoId = Ws`, 0 ediciones (detached) |

**Designated Work de la absorbida (§15, congelado por ADR-008):** la absorbida **conserva** su
`designatedWorkId` histórico. No se recicla ni se apunta al Work sobreviviente. Cumple simultáneamente:
trazabilidad; el índice parcial de designación (WHERE `state='ACTIVE'`) deja de aplicarle al pasar a
REDIRECTED; la FK `NOT NULL`/Restrict sigue satisfecha (el Work absorbido existe, no se borra); no hay
reutilización del Work absorbido (marcado `absorbedIntoId` + guard de Conferir); base para un futuro Partir.

## Flujo (coordinador de aplicación, ADR-008 Alternativa B)

```
Adjudicación → MergeDecision
→ mergeIdentities: prisma.$transaction  (UNA tx, todo o nada)
   1. prepareIdentityMergeInTx  — idempotencia (decisionId-primero) + lock identidades + validación → READY | resultado
   2. absorbWorkInTx            — Catálogo: re-parentar ediciones del Work absorbido + marcar detached  [T1]
   3. applyIdentityMergeInTx    — mover referencias + flipear absorbida a REDIRECTED + procedencia
→ MergeResult
```

El dominio permanece separado por contexto; el único acoplamiento es la frontera transaccional. Las dos
fases del namespace viven **ambas en el Registro** (`mergeRegistro.ts`); el coordinador solo las secuencia
e inyecta la llamada a Catálogo entre medio (no contiene lógica de namespace). El Registro **no** llama a
Catálogo ni modifica Works.

## Frontera transaccional y orden de mutaciones

Una sola `prisma.$transaction`. Orden (§14): (1) idempotencia por `mergeDecisionId`; (2) resolver+lockear
identidades; (3) revalidar bajo lock; (4) validar redirecciones entrantes; (5) absorción de Catálogo;
(6) **mover referencias** (`identityId` absorbida → sobreviviente); (7) flipear absorbida a `REDIRECTED` +
`redirectsToId` + procedencia. **Mover antes de flipear** es obligatorio y además forzado por la FK
compuesta de ADR-009 (`ON UPDATE RESTRICT`: el flip falla si aún hay referencias sobre `(absorbida,'ACTIVE')`).
Rechazos de precondición retornan **antes** de escribir; Catálogo rechaza antes de escribir → un rechazo no
deja nada persistido. Una excepción revierte la tx completa (namespace + Catálogo).

## Orden de locks (congelado)

**Identidades → Works.** La fase 1 lockea ambas `CatalogIdentity` con `SELECT … FOR UPDATE` **ordenadas por
id** (anti-deadlock); recién entonces Catálogo lockea ambos Works (también ordenados por id). El único
escritor de redirecciones es Fusionar (que siempre lockea identidades); el único que lockea Works es la
absorción, siempre **después** de las identidades. Ningún camino adquiere Works antes que Identidades → sin
deadlock entre operaciones. `READ COMMITTED` alcanza (la relectura bajo lock ve el estado comprometido).

## Schema, redirección y procedencia (migración `20260724000000`, gated)

`CatalogIdentity` gana: `redirectsToId Int?` (self-FK Restrict), `mergeDecisionId String? @unique`,
`mergeDecisionFingerprint String?`, índice en `redirectsToId`. Constraints CRUDOS (Prisma no modela CHECK
→ drift documentado):
- **no autorredirección:** `redirectsToId IS NULL OR redirectsToId <> id`.
- **coherencia estado⇔redirección:** `REDIRECTED ⟺ redirectsToId IS NOT NULL` (impide "REDIRECTED sin
  destino" y "ACTIVE con destino").
- **pareo de procedencia:** `mergeDecisionId`/`mergeDecisionFingerprint` presentes **juntos** y **solo** en
  filas redirigidas.

**Destino ACTIVE / anti-cadena — decisión de diseño (NO se usó FK compuesta).** Que el destino de una
redirección sea ACTIVE y que la absorbida no tenga redirecciones entrantes se validan **transaccionalmente
bajo lock**, no con una FK compuesta simétrica a ADR-009. Razón: ADR-009 necesitó la FK porque **Asociar no
lockea**; acá el **único** escritor de redirecciones es Fusionar, que ya toma `FOR UPDATE`. No hay escritor
sin lock que una FK deba atajar, así que se evita denormalizar un `redirectsToState` (el Design Spec §5
advierte explícitamente contra denormalizar de más). Es una elección, no una contradicción: si en el futuro
apareciera un escritor de redirecciones sin lock, agregar esa FK compuesta (contra el `UNIQUE(id,state)`
que ya existe de ADR-009) sería el endurecimiento declarativo natural.

## Invariantes

| Invariante | Dónde |
|---|---|
| Sobreviviente ACTIVE ⇔ elegible | `isSurvivorState` + revalidación bajo lock (`INVALID_SURVIVOR_STATE`) |
| Absorbida ACTIVE ⇔ elegible | `isAbsorbableState` + revalidación (`INVALID_ABSORBED_STATE`) |
| Handles distintos | constructor (ValidationError) + Registro (`SAME_IDENTITY`, red de seguridad) |
| Misma clase de contenido | Registro (`CONTENT_CLASS_INCOMPATIBLE`) |
| v1 no encadena (absorbida sin redirecciones entrantes) | Registro (`REDIRECT_DEPENDENTS_PRESENT`) |
| REDIRECTED ⟺ redirectsToId no nulo | CHECK (base) |
| No autorredirección / no ciclo | CHECK (base) + sobreviviente ACTIVE (un ciclo exigiría que ya redirija) |
| Referencia nunca sobre no-ACTIVE | FK compuesta ADR-009 + mover-antes-de-flipear |
| Atomicidad cross-context | una `$transaction` (coordinador) |
| Contenido absorbido preservado + detached | `absorbWorkInto` (ADR-008): `absorbedIntoId`, sin borrado |

## Resultados semánticos (solo alcanzables)

`EXECUTED` (handles + Works + `reparentedEditions` + `movedReferences`); `ALREADY_SATISFIED` (replay de la
MISMA decisión); `ALREADY_MERGED` (la absorbida ya redirige a la misma sobreviviente por OTRA decisión);
`REJECTED` con motivo: `SAME_IDENTITY`, `IDENTITY_NOT_FOUND` (con `missing: survivor|absorbed`),
`INVALID_SURVIVOR_STATE`, `INVALID_ABSORBED_STATE`, `CONTENT_CLASS_INCOMPATIBLE`,
`REDIRECT_DEPENDENTS_PRESENT`, `DECISION_ID_REUSED_DIVERGENTLY`, y `CONTENT_CONFLICT_REQUIRES_JUDGMENT`
(propagado desde Catálogo, con sus slots).

**No incluidos (inalcanzables en v1):** `WOULD_CREATE_REDIRECT_CYCLE` (con anti-cadena + sobreviviente
ACTIVE, un ciclo exigiría que la sobreviviente ya redirija → imposible; subsumido por
`INVALID_SURVIVOR_STATE`) y `STALE_DECISION` (una decisión obsoleta se manifiesta como `INVALID_*_STATE` /
`ALREADY_MERGED`; no hay precondición extra separable). Coherente con que `absorbWorkInto` tampoco expone
`WOULD_CREATE_ABSORPTION_CYCLE`.

## Replay vs ALREADY_MERGED

Cuatro situaciones "ya está así", distinguidas a propósito: **replay** (`ALREADY_SATISFIED`, misma decisión,
misma huella) ≠ **estado ya satisfecho** (`ALREADY_MERGED`, otra decisión, mismo fin) ≠ **contradictoria**
(`DECISION_ID_REUSED_DIVERGENTLY`, mismo id otra huella) ≠ **incompatible** (`INVALID_ABSORBED_STATE`, la
absorbida redirige a OTRA). Protocolo **decisionId-primero** (igual que Conferir/Asociar): se busca por
`mergeDecisionId` antes de interpretar otros conflictos, tanto en el pre-check global como en la relectura
bajo lock (para el replay que commiteó entre el pre-check y el lock) y en la resolución del P2002.

## Coordinación Catálogo–Registro y referencias

El coordinador mapea el rechazo de Catálogo sin borrar la distinción: `CONTENT_CONFLICT_REQUIRES_JUDGMENT`
se propaga tal cual (con sus slots); un Work que cambió de estado bajo el lock (raro) se mapea al estado de
identidad equivalente; `SAME_WORK`/`WORK_NOT_FOUND` no son alcanzables desde una fusión válida (dos
identidades ACTIVE designan Works distintos y existentes por FK Restrict) → error técnico ruidoso.
`ALREADY_ABSORBED` de Catálogo permite continuar: solo ocurre cuando el absorbido ya apunta a ESTE
sobreviviente (cualquier otro destino sería `INVALID_ABSORBED_STATE`), así que la dirección coincide.

Las referencias se **mueven físicamente** (`UPDATE identityId`), no se resuelven por indirección: lo exige
el invariante "ninguna referencia sobre identidad no terminal", y es seguro porque `(provider, externalId)`
ya es único global (una referencia existe una sola vez → el `UPDATE` de propietario no colisiona).

## Resolución de handles (lectura, separada de la ejecución)

`resolveIdentity(client, handle)` devuelve el terminal activo: `ACTIVE` (a sí mismo o al destino tras UN
salto), `NOT_FOUND`, `BROKEN` (destino faltante/autorredirección), `CHAIN` (destino no terminal; v1 no la
soporta). Es lectura pura. **Fusionar NUNCA la usa** para reemplazar los handles de la Decisión: el Registro
no substituye un handle por su terminal (una decisión emitida contra un estado que cambió se **rechaza**,
no se corrige).

## Concurrencia (verificada en Postgres real)

`FOR UPDATE` sobre ambas identidades ordenado por id + revalidación bajo lock, `READ COMMITTED`. Carreras
probadas: mismo absorbido → dos sobrevivientes (uno EXECUTED, otro rechazado, sin cadena); misma decisión
simultánea (EXECUTED + ALREADY_SATISFIED); mismo fin distintas decisiones (EXECUTED + ALREADY_MERGED);
direcciones opuestas A→B/B→A (una gana, sin ciclo); cadena potencial A→B/B→C (una gana, sin cadena);
sobreviviente compartida A→C/B→C (ambas EXECUTED, fan-in); Fusionar vs Asociar sobre la absorbida (nunca
queda referencia sobre REDIRECTED, vía FK compuesta); Fusionar vs otra absorción del Work (una sola
dirección de absorción; si la fusión pierde, la identidad queda intacta por rollback). Sin deadlocks.

## Atomicidad / fallos inyectados

Probado en Postgres real: un fallo inyectado tras absorber contenido + mover refs + flipear estado revierte
**todo** (identidad ACTIVE, Work sin marcar, refs sin mover, ediciones sin re-parentar). El rechazo de
Catálogo (conflicto de contenido) no deja nada persistido (namespace intacto, Work sin marcar). Constraints
de base verificados: insertar una referencia sobre una identidad REDIRECTED falla (FK compuesta); la
autorredirección y el estado incoherente fallan (CHECK).

## Impacto en slices existentes

- **Conferir:** ya rechaza Work absorbido (`DESIGNATED_CONTENT_ABSORBED`); no cambia. Mientras la identidad
  absorbida sigue ACTIVE, el índice parcial de designación impide una segunda identidad activa sobre su Work.
- **Asociar:** confirmado contra un REDIRECTED **real** producido por Fusionar — pre-check +
  FK compuesta rechazan (`INVALID_IDENTITY_STATE`); la carrera Fusionar-vs-Asociar preserva el invariante.
- **ADR-009 (reference-integrity):** el nuevo CHECK `REDIRECTED ⟺ redirectsToId no nulo` **endureció** el
  estado: los tests que fabricaban un REDIRECTED "incompleto" (sin destino) por raw UPDATE se ajustaron para
  construirlo válidamente (con destino ACTIVE). Las garantías de ADR-009 no cambiaron; siguen verdes.
- **Lecturas existentes:** ninguna asumía identidades no-ACTIVE; no se hizo refactor general.

## Tensiones encontradas

Ninguna bloqueante. La única decisión no trivial fue **destino-ACTIVE/anti-cadena vía lock vs FK compuesta**
(resuelta a favor del lock, ver arriba). El self-merge quedó como **ValidationError** en el constructor
(§3) y `SAME_IDENTITY` como red de seguridad del Registro para decisiones construidas a mano (§11) — ambas
conviven: el constructor falla rápido; el Registro no confía ciegamente en su input.

## Deuda deliberada (fuera de alcance)

Partir / deshacer una fusión; compactación de redirecciones y **cadenas** (v1 prohíbe encadenar); migración
física de dependencias inobservables (colección, favoritos, notificaciones) — la **garantía** es la
redirección (resuelven al terminal); reconciliación de hechos descriptivos (Catálogo v1 no combina);
cardinalidad de referencias por proveedor (juicio de Adjudicación, no detectable por el Registro); auditoría
completa de decisiones (hoy: id + huella); tabla general de decisiones (procedencia por-columna alcanza).

## Comparación con Conferir y Asociar, y abstracciones (tercera evidencia)

Fusionar confirma el **protocolo compartido** de las tres: `decisionId` + huella + resolución
**decisionId-primero** + replay (`ALREADY_SATISFIED`) + `DECISION_ID_REUSED_DIVERGENTLY` + frontera
transaccional + lectura fresca post-conflicto + forma del Resultado semántico. Difieren (y deben seguir
específicos): Fusionar es **multi-identidad** (dos handles, locks de grafo, transición de estado,
redirección), su concurrencia es de grafo (cadenas/ciclos), y su unión de resultados diverge
(`ALREADY_MERGED`, `REDIRECT_DEPENDENTS_PRESENT`).

**Recomendación (NO se extrae en esta slice):** hay evidencia real (3 implementaciones) para extraer
después dos utilitarios: (1) un VO `ExternalReference` + normalización (idéntico en las tres), y (2) el
**protocolo de replay** `resolveExistingDecision(prior, decision, fingerprintFn)` (estructuralmente idéntico
en las tres). NO se extrajo ahora para no introducir una indirección que borre payloads/resultados/
clasificaciones específicos mientras Fusionar todavía era nuevo — se propone como consolidación posterior.
**Sigue prohibido** (Fusionar lo confirma): `IdentityDecision`/`BaseDecision`/`GenericExecutionResult<T>`/
`DecisionHandler`/`RegistryCommand`/`classifyIdentityConflict` universal — los conjuntos de resultados y
payloads divergen lo suficiente como para que un genérico borre distinciones (`ALREADY_MERGED`, locks de
grafo, transiciones de estado).

## Archivos

- Dominio: `lib/domain/identity/merge.ts`.
- Infra: `lib/infra/identity/mergeRegistro.ts` (namespace: prepare/apply, locks, idempotencia),
  `lib/infra/identity/resolveIdentity.ts` (resolución de lectura).
- Aplicación: `lib/identity/mergeIdentities.ts` (coordinador, 1 tx).
- Schema/migración: `prisma/schema.prisma`, `prisma/migrations/20260724000000_identity_merge_redirect/`.
- Tests: `tests/identity-merge.test.ts` (31 unit), `tests/identity-merge.integration.test.ts` (21 integración
  + concurrencia); `scripts/identity-it.mjs` suma la suite; `tests/identity-reference-integrity.integration.test.ts`
  ajustado al CHECK más estricto.

## Resultados reales

- `npm run check`: **562 passed | 62 skipped**, tsc limpio.
- Integración Postgres real (`npm run test:identity-it`): **62 passed** (identidad Conferir 11 + Asociar 9 +
  integridad 9 + Catálogo 12 + **Fusionar 21**), exit 0, PostgreSQL 18.4 efímero. La migración
  `20260724000000` aplica limpia (self-FK + 3 CHECK + único), preservando las identidades existentes como ACTIVE.
