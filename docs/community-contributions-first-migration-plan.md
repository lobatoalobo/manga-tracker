# Community Contributions — Plan de la primera migración aditiva (MVP-A)

> Documento de **revisión previa** a editar `schema.prisma`. Especifica **exactamente**
> qué agrega la primera migración **aditiva** del MVP-A. **No** modifica `schema.prisma`,
> **no** SQL real, **no** migraciones, **no** Prisma Client, **no** código. Fuentes: los
> 6 docs de contribuciones + `prisma/schema.prisma`. Convenciones del repo: IDs `Int
> autoincrement` (dominio) / `String cuid` (User); **cero enums Prisma** (String
> validado); CHECKs vía **SQL manual** agregado a la migración generada; refs cross-BC
> **blandas**; cascade para hijos.

## A. Inventario final de tablas (9 nuevas + 1 columna)

| Tabla | Propósito | MVP-A |
|---|---|---|
| **CatalogProposal** | root: identidad opaca del sujeto + estado + target | activo |
| **ProposalContribution** | envío append-only atribuido | activo |
| **ProposalClaim** | afirmación (attributeKind, value) — unidad de resolución | activo |
| **ClaimEvidenceReference** | evidencia VO (URL/ISBN/fuente) | activo |
| **ClaimEvidenceArtifact** | evidencia artefacto (upload) | **latente** (sin filas desde prod hasta MVP-B) |
| **ProposalInfoRequest** | pedido de info del moderador | activo |
| **ProposalSubscription** | interés/aviso (aggregate aparte) | activo |
| **ResolutionRecord** | registro inmutable del acto de resolución | activo |
| **ProposalPreflightKey** | índice derivado recomputable de preflight | activo |
| **+ `NotificationPref.contributions Boolean @default(true)`** | opt-out de la categoría. **Copia la convención de las prefs hermanas reales** (`newVolume/reissue/wishlist/social/friends` = todas `Boolean @default(true)`, nacen **habilitadas**). Única tabla existente tocada; aditiva+default → segura; app vieja ignora la columna. La feature sigue OFF → la pref no genera notis por sí sola. | se usa en la fase de notis |

**No se agrega ningún otro modelo.** `ProposalModerationEvent` **no** entra (§9/decisión). `contentClass` **no** se agrega a `Work` (Alt C).

## B. Especificación campo por campo (tentativa, para la migración)

### CatalogProposal
| Campo | Tipo | Null | Default | Unique | Index | FK/soft | Autor/Deriv | Justificación |
|---|---|---|---|---|---|---|---|---|
| id | Int | no | autoincrement | PK | — | — | autor | convención |
| family | String | no | — | — | idx | — | autor | ALTA/CORRECCION/REPORTE |
| targetKind | String | no | — | — | idx | — | autor | discriminador (§E) |
| refWorkId | Int? | sí | — | — | idx | **soft** | autor | target/parent/reporte-A |
| refEditionId | Int? | sí | — | — | idx | soft | autor | target/parent |
| refVolumeId | Int? | sí | — | — | idx | soft | autor | target |
| refWorkBId | Int? | sí | — | — | — | soft | autor | DUPLICATE contraparte |
| relationKind | String? | sí | — | — | — | — | autor | DUPLICATE/BAD_MERGE (solo STRUCTURAL) |
| contentClass | String | no | — | — | **idx** | — | **autor (inmutable)** | discriminador estructural (Alt C) |
| status | String | no | "SUBMITTED" | — | **idx** | — | autor | ciclo de vida |
| version | Int | no | 0 | — | — | — | autor | optimistic locking (§M) |
| relatedProposalId | Int? | sí | — | — | idx | **soft self** | autor | advisory; CHECK != id |
| originatorUserId | String? | sí | — | — | idx | soft (User) | denorm | "mis propuestas"; null p/ anon |
| createIdempotencyKey | String? | sí | — | **@unique** | — | — | autor | idempotencia de create (§L) |
| createdAt | DateTime | no | now() | — | — | — | autor | — |
| updatedAt | DateTime | no | @updatedAt | — | — | — | autor | — |

**`createIdempotencyKey` pertenece a `CatalogProposal`** (no a otra entidad): el submit-de-alta crea Proposal + contribución base en una tx; una sola key cubre ambos. Las `addContribution` posteriores usan `ProposalContribution.idempotencyKey`.

### ProposalContribution
| Campo | Tipo | Null | Default | Unique | Index | FK/soft | Just. |
|---|---|---|---|---|---|---|---|
| id | Int | no | autoincrement | PK | — | — | — |
| proposalId | Int | no | — | — | idx | **FK interna** (cascade) | ownership |
| authorId | String? | sí | — | — | idx | soft (User) | atribución; null p/ anon |
| visibility | String | no | "VISIBLE" | — | idx | — | VISIBLE/OCULTA/EN_CUARENTENA |
| withdrawnAt | DateTime? | sí | — | — | — | — | retiro autoritativo; disposición = derivada |
| answersInfoRequestId | Int? | sí | — | — | idx | **FK interna** (SetNull) | dirección autoritativa (§P) |
| idempotencyKey | String? | sí | — | **@unique** | — | — | idempotencia de addContribution |
| createdAt | DateTime | no | now() | — | — | — | — |

### ProposalClaim
| Campo | Tipo | Null | Default | Unique | Index | FK/soft | Mut/Inmut |
|---|---|---|---|---|---|---|---|
| id | Int | no | autoincrement | PK | — | — | — |
| contributionId | Int | no | — | — | idx | **FK interna** (cascade) | — |
| attributeKind | String | no | — | — | idx | — | **inmutable** |
| contractVersion | Int | no | — | — | — | — | inmutable |
| claimOperation | String | no | — | — | — | — | inmutable |
| value | Json? | sí | — | — | — | — | inmutable (null si MARK_*) |
| result | String | no | "PROPUESTA" | — | idx | — | **mutable** (resolución) |
| resultReason | String? | sí | — | — | — | — | mutable |
| resolvedAt | DateTime? | sí | — | — | — | — | mutable |
| resolvedByUserId | String? | sí | — | — | — | soft (User) | mutable |
| promotedAssetRef | String? | sí | — | — | — | soft (URL R2) | mutable (portada aceptada) |
| createdAt | DateTime | no | now() | — | — | — | — |

### ClaimEvidenceReference
| Campo | Tipo | Null | Default | Unique | Index | FK |
|---|---|---|---|---|---|---|
| id | Int | no | autoincrement | PK | — | — |
| claimId | Int | no | — | — | idx | **FK interna** (cascade) |
| type | String | no | — | — | — | — (URL/ISBN/SOURCE_REF) |
| value | String | no | — | — | — | — (string; no JSON) |
| strength | String | no | — | — | — | — (STRONG/MEDIUM/WEAK) |
| createdAt | DateTime | no | now() | — | — | — |
| — | — | — | — | **@@unique([claimId,type,value])** | — | dedup en la claim |

### ClaimEvidenceArtifact — **latente MVP-A** (tabla creada, sin filas desde prod)
| Campo | Tipo | Null | Default | Nota |
|---|---|---|---|---|
| id | Int | no | autoincrement | PK |
| claimId | Int | no | — | **FK interna** (cascade), idx |
| status | String | no | "EN_CUARENTENA" | EN_CUARENTENA/DISPONIBLE/BLOQUEADA |
| storageKey | String | no | — | opaca R2; **requerido solo al insertar** (MVP-B); tabla vacía en MVP-A → seguro |
| hash | String | no | — | content hash (tombstone) |
| detectedMime | String? | sí | — | infra |
| sizeBytes | Int? | sí | — | infra |
| scanResult | String? | sí | — | infra |
| blockedReason | String? | sí | — | dominio/audit |
| scheduledDeleteAt | DateTime? | sí | — | worker MVP-B; idx |
| bytesDeletedAt | DateTime? | sí | — | tombstone |
| promotedAssetRef | String? | sí | — | soft (URL R2) |
| createdAt | DateTime | no | now() | — |
| updatedAt | DateTime | no | @updatedAt | — |

### ProposalInfoRequest
| Campo | Tipo | Null | Default | Index | FK/soft |
|---|---|---|---|---|---|
| id | Int | no | autoincrement | — | — |
| proposalId | Int | no | — | idx (con status) | **FK interna** (cascade) |
| scope | String | no | — | — | PROPOSAL/CONTRIBUTION |
| targetUserId | String? | sí | — | idx | soft (User) |
| targetContributionId | Int? | sí | — | — | **soft interna** (rompe ciclo, §P) |
| prompt | String | no | — | — | público |
| privateNote | String? | sí | — | — | solo moderador |
| status | String | no | "ABIERTO" | (idx con proposalId) | ABIERTO/ANSWERED |
| openedByUserId | String | no | — | — | soft (User) |
| answeredAt | DateTime? | sí | — | — | — |
| createdAt | DateTime | no | now() | — | — |

### ProposalSubscription
| Campo | Tipo | Null | Default | Unique | Index | FK/soft |
|---|---|---|---|---|---|---|
| id | Int | no | autoincrement | PK | — | — |
| proposalId | Int | no | — | — | (idx con status) | **FK interna** (cascade) |
| userId | String | no | — | — | (idx con status) | soft (User) |
| status | String | no | "ACTIVE" | — | — | ACTIVE/CANCELLED |
| createdAt | DateTime | no | now() | — | — | — |
| updatedAt | DateTime | no | @updatedAt | — | — | — |
| — | — | — | — | **@@unique([userId,proposalId])** | — | — |

### ResolutionRecord — inmutable
| Campo | Tipo | Null | Default | Unique | FK/soft |
|---|---|---|---|---|---|
| id | Int | no | autoincrement | PK | — |
| proposalId | Int | no | — | **@unique** | **FK interna** (cascade) |
| outcome | String | no | — | — | ACEPTADA/RECHAZADA/SUPERSEDED/ABANDONADA |
| actorType | String | no | — | — | HUMAN/SYSTEM/RECONCILE |
| moderatorUserId | String? | sí | — | — | soft (User) |
| resolvedAt | DateTime | no | now() | — | — |
| publicReason | String? | sí | — | — | **único lugar** |
| privateNote | String? | sí | — | — | **único lugar** |
| appliedWorkId | Int? | sí | — | — | soft |
| appliedEditionId | Int? | sí | — | — | soft |
| appliedVolumeId | Int? | sí | — | — | soft |
| supersedingProposalId | Int? | sí | — | — | **soft** (otro aggregate) |
| supersededReason | String? | sí | — | — | IMPORT/MODERATION/ANOTHER_PROPOSAL |
| mutationCorrelationId | String? | sí | — | — | soft (MutationLog) |
| overrideSummary | Json? | sí | — | — | — |
| primaryTitleClaimId | Int? | sí | — | — | **soft interna** (inmutabilidad, §P) |
| reconcileMeta | Json? | sí | — | — | — |

### ProposalPreflightKey — proyección derivada
| Campo | Tipo | Null | Index | FK |
|---|---|---|---|---|
| id | Int | no | PK | — |
| proposalId | Int | no | — | **FK interna** (cascade) |
| keyType | String | no | (idx con keyValue) | NORM_TITLE/ROMAJI/ISBN/EXTERNAL |
| keyValue | String | no | (idx con keyType) | normalizado |
| — | — | — | **@@unique([proposalId,keyType,keyValue])** | — |
- **Sin timestamps** (índice derivado; los timestamps del Proposal alcanzan). Ver §N.

## C. FKs internas vs referencias blandas

**FKs internas reales** (integridad + cascade dentro del aggregate/BC):
- Proposal → Contribution, InfoRequest, ResolutionRecord, PreflightKey, Subscription.
- Contribution → Claim.
- Claim → EvidenceReference, EvidenceArtifact.
- Contribution.answersInfoRequestId → InfoRequest (FK interna, `SetNull`).

**Refs blandas (sin FK)** — justificación una por una:
| Ref | Decisión | Por qué |
|---|---|---|
| authorId, originatorUserId, moderatorUserId, targetUserId, openedByUserId, resolvedByUserId, Subscription.userId | **soft (String)** | cross-BC a User; **patrón del repo** (Report/Store/IndieWork); permite anonimización/colgado sin cascade |
| refWorkId/EditionId/VolumeId/refWorkBId, appliedWorkId/EditionId/VolumeId, promotedAssetRef | **soft (Int/String)** | cross-BC al catálogo; **no** hard-FK (desacople); ref colgada tolerada en application |
| mutationCorrelationId | **soft (String)** | cross-BC a MutationLog |
| **relatedProposalId** | **soft self** | apunta a **otro aggregate root** (DDD: no hard-FK entre roots); advisory; CHECK != id |
| **supersedingProposalId** | **soft** | otro aggregate root (DDD) |
| **targetContributionId** (InfoRequest) | **soft interna** | evita el **ciclo** InfoRequest↔Contribution (la dirección autoritativa es answersInfoRequestId); es advisory |
| **primaryTitleClaimId** (ResolutionRecord) | **soft interna** | preservar **inmutabilidad** del ResolutionRecord (un FK SetNull lo mutaría); + app-check "misma proposal" |

**No hay FK cross-BC.** Riesgo de ref colgada: acotado — se resuelve en application (el ledger no se rompe).

## D. Cascades
- `onDelete: Cascade`: Proposal→{Contribution, InfoRequest, ResolutionRecord, PreflightKey, Subscription}; Contribution→Claim; Claim→{EvidenceReference, EvidenceArtifact}.
- `answersInfoRequestId` → `SetNull` (el aporte sobrevive si el InfoRequest se fuera).
- **Refs cross-BC NO cascadean** (soft, sin FK): borrar una Proposal **nunca** toca catálogo, User ni assets oficiales.
- **En operación normal el ledger NO se hard-deletea** (K/persistence). Los cascades existen para **limpieza controlada / tests**.
- **Cascade peligroso a marcar**: borrar una Proposal borra su ResolutionRecord (audit) → aceptable solo en limpieza controlada; **nunca** en el flujo normal. Documentado.

## E. Índices

**Obligatorios (primera migración) — cada uno con su query:**
| Modelo | Índice | Query |
|---|---|---|
| CatalogProposal | `(status)` | cola de moderación pendiente |
| CatalogProposal | `(originatorUserId)` | "mis propuestas" |
| CatalogProposal | `(contentClass)` | preflight/dedup por clase |
| CatalogProposal | `(refWorkId)`, `(refEditionId)`, `(refVolumeId)` | correcciones sobre entidad + reconcile |
| ProposalPreflightKey | `(keyType, keyValue)` | preflight cross-proposal |
| ProposalContribution | `(proposalId, createdAt)` | timeline de contribuciones |
| ProposalContribution | `(authorId)` | "mis contribuciones" |
| ProposalClaim | `(contributionId, result)` | claims por contribution / sin resolver |
| ProposalInfoRequest | `(proposalId, status)` | requests abiertos |
| ClaimEvidenceArtifact | `(status)`, `(scheduledDeleteAt)` | worker de cuarentena/borrado (MVP-B, pero el índice es barato) |
| ProposalSubscription | `(proposalId, status)` | fan-out de Notify |

**Postergables (agregar tras medir uso):** `CatalogProposal(status, family)`, `(relatedProposalId)`; `ProposalContribution(visibility)`; `ResolutionRecord(outcome)/(resolvedAt)/(moderatorUserId)`; `ProposalSubscription(userId, status)`.

**Notas:** los `@@unique` ya crean índice → no duplicar (Subscription(user,proposal), ResolutionRecord(proposal), PreflightKey(...), EvidenceReference(...), idempotency keys). **Postgres NO indexa FKs automáticamente** → declarar `@@index` en las columnas de FK que se consultan (proposalId, contributionId, claimId). Orden de compuestos: scope primero (proposalId/keyType/status), luego el discriminante — correcto arriba. Riesgo de sobreindexar: bajo (un índice = una query nombrada).

## F. Uniques (semántica exacta)
| Unique | Nullable | Semántica |
|---|---|---|
| `CatalogProposal.createIdempotencyKey` | sí | **global**; múltiples NULL permitidos (Postgres); enforce solo para no-null. First-wins (§L). |
| `ProposalContribution.idempotencyKey` | sí | **global** (UUID de cliente); múltiples NULL; first-wins. |
| `ProposalSubscription(userId, proposalId)` | no | un interés por (user, proposal); re-suscribir = upsert a ACTIVE |
| `ResolutionRecord(proposalId)` | no | **una resolución por Proposal** (ancla de idempotencia de Apply) |
| `ProposalPreflightKey(proposalId, keyType, keyValue)` | no | dedup de claves derivadas |
| `ClaimEvidenceReference(claimId, type, value)` | no | dedup de evidencia en la claim |

**Idempotency keys**: **globales** (UUID de cliente), **nullable** (permite creación sin key p/ admin/interno; múltiples NULL válidos en Postgres). Retención = **permanente** (columna en la fila; no tabla expirante). Reintento **mismo key + payload distinto** → **first-wins** (devuelve la fila original; el payload del reintento se ignora — el key es la identidad del request). No scoped por user (el UUID ya es único; scoping agregaría complejidad sin beneficio). *(No definir un unique scoped incorrecto por simplicidad.)*

## G. CHECKs — lista final en 3 buckets (SQL manual tras generar la migración)

Decisión: **todos los estructurales/estables/pequeños/independientes del lifecycle entran ahora** (tablas nuevas y vacías = el momento más barato para impedir estados estructuralmente inválidos).

### G.1 — Incluidos en la primera migración
| CHECK | Nota |
|---|---|
| `family ∈ {ALTA,CORRECCION,REPORTE}` | enum-membership |
| `targetKind ∈ {NEW_WORK,NEW_EDITION,NEW_VOLUME,WORK,EDITION,VOLUME,STRUCTURAL}` | enum |
| `contentClass ∈ {MANGA,COMIC}` | **imprescindible** (discriminador estructural) |
| `status ∈ {SUBMITTED,NEEDS_INFO,ACEPTADA,RECHAZADA,SUPERSEDED,ABANDONADA}` | enum |
| `relatedProposalId != id` | **imprescindible** (evita self-ref) |
| **family × targetKind** válida (la matriz §E) | estructural |
| **columnas de target pobladas según targetKind** (qué refs no-null por kind) | estructural |
| `relationKind` no-null ⇔ `targetKind=STRUCTURAL`; `relationKind ∈ {DUPLICATE,BAD_MERGE}` | estructural |
| DUPLICATE ⇒ `refWorkId IS NOT NULL AND refWorkBId IS NOT NULL AND refWorkId != refWorkBId` | estructural |
| Claim: `result ∈ {PROPUESTA,ACEPTADA,NO_USADA,RETIRADA}`; `claimOperation ∈ {SET,ADD,REMOVE,MARK_UNKNOWN,MARK_NOT_APPLICABLE}` | enum |
| Claim: **result × resultReason** coherente (ACEPTADA⇒{procedencia,corroboracion}; NO_USADA⇒{desplazada,descartada,rechazada}; PROPUESTA/RETIRADA⇒reason NULL) | estructural |
| Claim: `claimOperation IN (MARK_UNKNOWN,MARK_NOT_APPLICABLE) ⇒ value IS NULL` | estructural |
| Claim: `claimOperation IN (SET,ADD) ⇒ value IS NOT NULL` | estructural |
| Contribution: `visibility ∈ {VISIBLE,OCULTA,EN_CUARENTENA}` | enum |
| InfoRequest: `scope ∈ {PROPOSAL,CONTRIBUTION}`; `status ∈ {ABIERTO,ANSWERED}`; `scope=CONTRIBUTION ⇒ targetContributionId IS NOT NULL` | estructural |
| Subscription: `status ∈ {ACTIVE,CANCELLED}` | enum |
| ResolutionRecord: `outcome ∈ {ACEPTADA,RECHAZADA,SUPERSEDED,ABANDONADA}`; `actorType ∈ {HUMAN,SYSTEM,RECONCILE}` | enum |
| ResolutionRecord: `actorType=HUMAN ⇒ moderatorUserId IS NOT NULL` | estructural |
| ResolutionRecord: `outcome=SUPERSEDED ⇒ supersededReason IS NOT NULL`; `supersededReason ∈ {IMPORT,MODERATION,ANOTHER_PROPOSAL}` (cuando no-null) | estructural |
| ClaimEvidenceReference: `type ∈ {URL,ISBN,SOURCE_REF}`; `strength ∈ {STRONG,MEDIUM,WEAK}` | enum |
| ClaimEvidenceArtifact: `status ∈ {EN_CUARENTENA,DISPONIBLE,BLOQUEADA}` | enum (estable — el único CHECK de artifact que entra ahora) |
| ProposalPreflightKey: `keyType ∈ {NORM_TITLE,ROMAJI,ISBN,EXTERNAL}` | enum |

### G.2 — Diferidos a MVP-B (dependen del pipeline operativo de artifacts, §K)
| CHECK | Por qué espera |
|---|---|
| EvidenceArtifact: coherencia `bytesDeletedAt`/`scheduledDeleteAt`/`status` (bloqueo↔borrado programado) | requiere el worker/flujo real |
| EvidenceArtifact: tiempos de retención | pipeline |
| EvidenceArtifact: `promotedAssetRef` solo si `status=DISPONIBLE` (promoción de asset) | flujo de promoción |
| EvidenceArtifact: `bytesDeletedAt` implica bytes eliminados | worker |
| EvidenceArtifact: coherencia de `scanResult` | escaneo real |

### G.3 — Exclusivos de dominio/application (NUNCA a DB)
`ResolutionRecord`: applied refs coherentes con `outcome` (operación-específico) · **append-only** · Proposal terminal no acepta nuevas Contributions · required sets por operación · contrato **JSON** por `(attributeKind,contractVersion)` · **pertenencia al mismo aggregate** de refs blandas · resolución **atómica** · `contentClass` **inmutable** · `WORK_TYPE` **intra-class** · reglas de evidencia por kind · lifecycle operativo de artifacts · `outcome == status` terminal · cualquier CHECK con **subqueries / mirar otras tablas / lógica compleja**.

## H. Invariantes que NO van a DB (quedan en dominio/application)
append-only del contenido · Proposal terminal no acepta nuevas Contributions · `contentClass` inmutable · `WORK_TYPE` intra-class · contrato JSON por `(attributeKind,contractVersion)` · required sets por operación · resolución **atómica** · no quedan claims PROPUESTA en terminal · **no cross-type merge** (`sameContentClass`) · evidencia requerida por kind (política) · semántica de optimistic locking · **recomputación de PreflightKey**. → evita resolver todo con CHECKs frágiles.

## I. Orden de creación de tablas
1. **CatalogProposal** (root; su self-ref `relatedProposalId` es **soft**, sin FK → sin dependencia de orden).
2. Hijos directos: **ProposalContribution, ProposalInfoRequest, ResolutionRecord, ProposalSubscription, ProposalPreflightKey**.
3. **ProposalClaim** (hijo de Contribution). *(Contribution.answersInfoRequestId → InfoRequest ya existe del paso 2.)*
4. Evidencia: **ClaimEvidenceReference, ClaimEvidenceArtifact**.
5. Índices (Prisma los genera de `@@index/@@unique`).
6. **CHECKs manuales** (SQL agregado a la migración generada).

**Prisma genera el orden correcto** automáticamente (grafo topológico) **porque no hay ciclo de FK** (targetContributionId es soft; relatedProposalId es soft). Igual **se inspecciona la migración** antes de aplicar (paso §Q).

## J. Compatibilidad migración-antes-que-código
- **Columnas nuevas**: en tablas **nuevas** (vacías) las no-null-sin-default son seguras (el constraint solo aplica al insertar, que ocurre luego vía código). La **única** tabla existente tocada, `NotificationPref.contributions`, lleva **`@default(true)`** → las filas existentes quedan válidas.
- **Ningún código existente depende** de las tablas nuevas.
- **Desplegar tablas vacías es seguro** (no hay lecturas/escrituras hasta el código con flag).
- **App vieja convive** con la DB nueva (ignora las tablas).
- **Rollback de código NO requiere rollback de DB** (aditivo: las tablas quedan vacías).
- **Staging → prod** sin habilitar feature (flag off; sin endpoints).
- **Campo que rompería la estrategia**: ninguno. (Si `NotificationPref.contributions` fuera no-null-sin-default, rompería — por eso lleva default.)

## K. ClaimEvidenceArtifact latente (MVP-A)
- Tabla **completa** creada, pero **sin filas desde producción** en MVP-A (sin endpoint/UI; gated por flag).
- **Sin worker** todavía (el de borrado/cuarentena llega en MVP-B).
- **Ningún proceso asume que haya artifacts**.
- `storageKey` no-null es seguro (solo se exige **al insertar**; no hay inserts en MVP-A).
- **Constraints que esperan a MVP-B**: los CHECK de coherencia de ciclo (`bytesDeletedAt`/`scheduledDeleteAt`/`status`, `promotedAssetRef` solo si DISPONIBLE) — dependen del pipeline; se agregan cuando el worker existe.
- **La tabla vacía es segura**.

## L. Idempotencia (semántica concreta)
- **Crear Proposal**: la **key la genera el cliente** (UUID por intento de submit); `CatalogProposal.createIdempotencyKey`, **scope global**, **retención permanente**. Mismo key + mismo payload → devuelve la Proposal existente (no-op). Mismo key + payload distinto → **first-wins** (devuelve la original; ignora el payload nuevo).
- **Agregar Contribution**: `ProposalContribution.idempotencyKey`, **global** (UUID de cliente). Reintento con mismo key → devuelve la contribución existente. *(No scoped por (proposalId, authorId, key): el UUID ya es único; scoping no aporta.)*
- **Resolver**: **no hace falta otra key** — `@unique(ResolutionRecord.proposalId)` + `version` (optimistic) dan la idempotencia (segundo intento choca el unique o el version).
- **Recomendación**: la más simple y segura = keys globales UUID nullable + first-wins; resolución por unique+version.

## M. Optimistic locking (diseño concreto)
- `CatalogProposal.version Int @default(0)`.
- **Incrementan versión** (transiciones de estado / moderación): abrir/cerrar InfoRequest (SUBMITTED↔NEEDS_INFO), **resolver** (→terminal), reconcile-supersede, abandono. → donde hay riesgo de **lost-update** entre moderadores/reconcile.
- **NO necesitan incrementar** (append/lecturas): `addContribution`, `withdrawContribution`, add Claim, recompute de PreflightKey. Estos usan un **chequeo condicional `status NOT terminal`** en la tx (append-only no tiene lost-update; serializar appends sería contención innecesaria).
- **Contribution inserts vs versionado**: el insert valida `status != terminal` (condición), **sin** bump de versión → adds concurrentes no contienden entre sí.
- **Subscription**: **no** toca `version` (aggregate aparte).
- **Dos moderadores resolviendo**: ambos intentan la transición terminal con `WHERE version = N`; uno gana, el otro choca (version o el unique de ResolutionRecord).
- **Reconcile vs moderación**: reconcile hace la transición con version+unique; el perdedor ve terminal y **se saltea**.

## N. ProposalPreflightKey — lifecycle
- **Cuándo se recalcula**: al cambiar una claim que aporta clave promovida (título/isbn/external/romaji): agregar claim, retirar su contribución. (En una Proposal pendiente las claims son PROPUESTA; el recompute refleja el set actual.)
- **Desde qué claims**: las **activas** = claims de contribuciones **no retiradas**, de los attributeKinds promovidos. **Excluye** claims de contribuciones RETIRADAS (y, post-resolución, las NO_USADA/rechazada — pero eso es terminal).
- **Contribución retirada**: sus claves salen en el recompute.
- **NEEDS_INFO**: igual que SUBMITTED (pendiente) — refleja claims actuales.
- **Proposal terminal**: sus claves quedan **stale**; el **preflight filtra por `status ∈ {SUBMITTED, NEEDS_INFO}`** → no influyen. (Opcional: un job de limpieza borra keys de terminales; no requerido.)
- **Histórico**: **no** se necesita (terminal ⇒ la obra ya está en el catálogo, se busca ahí).
- **Reemplazo atómico**: recompute = borrar las keys del proposal + insertar el nuevo set, en **una tx** (junto al cambio de claim que lo dispara, o en un job).
- **Fallback si desincroniza**: es **cache**; un job de recompute (o recompute-on-demand por proposal) corrige drift. El preflight es **advisory** (WARN, no bloquea) → una key stale a lo sumo pierde un WARN (**falso negativo = dirección segura**).
- **Timestamps**: **no** (índice derivado; mínimo). Si a futuro se agrega un sweep de drift, un `computedAt` opcional.
- **No confundir**: es **indexación de búsqueda**, no verdad del dominio.

## O. ResolutionRecord y duplicación con `status`
- `ResolutionRecord.outcome` **refleja** el terminal de `CatalogProposal.status`; se escriben en la **misma tx** → consistentes.
- ¿Vale la pena ambos? **Sí, se mantienen ambos**: `status` es el estado **vivo** (incluye no-terminales); `outcome` es el **snapshot inmutable** del acto de resolución, **autocontenido** (audit legible sin join a Proposal, y congelado aunque —hipotéticamente— `status` se tocara).
- **Si divergen**: sería un **bug**; **ningún CHECK/FK lo garantiza barato** (igualdad cross-tabla). Se detecta con una **query de audit** (`outcome != status` para proposals con ResolutionRecord).
- **Confirmación**: se mantienen ambos por **audit e inmutabilidad**; la invariante "outcome == status terminal" es de **application** (misma tx).

## P. Refs internas — recomendación por cada una
| Ref | Recomendación | Índice | Pertenencia | Ciclo |
|---|---|---|---|---|
| `Contribution.answersInfoRequestId` → InfoRequest | **FK interna, nullable, SetNull** | idx | mismo aggregate | evitado (la otra punta es soft) |
| `InfoRequest.targetContributionId` → Contribution | **soft interna, nullable** | — | mismo aggregate (app-check) | **rompe el ciclo** InfoRequest↔Contribution |
| `ResolutionRecord.primaryTitleClaimId` → Claim | **soft interna, nullable** | — | mismo aggregate (app-check) | preserva **inmutabilidad** del record |
| `Proposal.relatedProposalId` → Proposal | **soft self, nullable, CHECK != id** | idx | **otro aggregate root** | advisory |
| `ResolutionRecord.supersedingProposalId` → Proposal | **soft, nullable** | — | otro aggregate root | — |

Regla: **dentro del mismo aggregate → FK interna** salvo que (a) genere ciclo (targetContributionId) o (b) rompa inmutabilidad (primaryTitleClaimId); **entre aggregate roots → soft** (DDD). No quedan soft-refs internas "sin necesidad" (cada una tiene motivo explícito).

> **"Blanda" NO significa "sin validación".** Toda ref blanda **interna** se valida en
> **Application Service** por **pertenencia y estado**:
> - `targetContributionId` → debe pertenecer a la **misma Proposal**.
> - `primaryTitleClaimId` → la Claim debe (i) pertenecer a la **misma Proposal**, (ii) ser
>   un **kind de título válido**, (iii) haber quedado **ACEPTADA**.
> - `supersedingProposalId` → solo se setea con `outcome=SUPERSEDED` (cuando corresponda),
>   apunta a la Proposal que la reemplazó; sin cascade.
> - `relatedProposalId` → advisory, a **otro aggregate root**, no self, no ownership.
> Las refs blandas **cross-BC** (catálogo/User/MutationLog) se validan de existencia en
> lectura (ref colgada tolerada; el ledger no se rompe).

## Q. Plan de rollout de la migración
1. **Documento aprobado** (este) — gate: OK del dueño + §S resuelto.
2. **Editar `schema.prisma`** (9 modelos + `NotificationPref.contributions`).
3. **Generar migración local** (`prisma migrate dev --create-only`) — sin aplicar.
4. **Inspeccionar el SQL** generado (orden de tablas, índices, tipos). Gate: revisión manual.
5. **Agregar CHECKs manuales** al SQL de la migración (§G). Gate: revisión.
6. **`prisma validate`** — gate: verde.
7. **`prisma generate`** — client actualizado.
8. **`npm run check`** (tsc+tests) — gate: verde.
9. **Rama + PR** (schema + migración). Gate: diff acotado.
10. **Aplicar en staging** (`migrate deploy` contra staging DB). Gate: sin error.
11. **Smoke test de DB en staging**: tablas creadas, CHECKs activos, `NotificationPref` OK, insert/rollback de prueba. Gate: verde.
12. **Aplicar en producción** con **feature apagada** (`migrate deploy` prod; migración-antes-que-código). Gate: staging OK.
13. **Verificar** en prod: tablas vacías, sin impacto en el catálogo, app funcionando. Gate: verde.
14. **Recién después** empezar el **código** (domain core → repos → mutations → …).

**Rollback**: como es **aditivo**, el rollback de código **no** requiere rollback de DB (tablas vacías inertes). Rollback de DB (drop tablas) **solo** si la propia migración falló en 10/12.

## R. Riesgos
1. **CHECKs vía SQL manual** mal escritos → migración falla; **probar en staging primero** (paso 11).
2. **`storageKey` no-null** en artifact → seguro por tabla vacía; vigilar al habilitar MVP-B.
3. **PreflightKey drift** → cache advisory; recompute job; falso negativo = seguro.
4. **`outcome`/`status` divergentes** → invariante de application; audit query.
5. **Refs colgadas cross-BC** → resueltas en application; ledger intacto.
6. **`NotificationPref.contributions`** = única tabla existente tocada → default garantiza seguridad.
7. **Orden de tablas / ciclo** → evitado (targetContributionId soft); igual inspeccionar la migración.

## S. Decisiones bloqueantes — CERRADAS
1. **Refs internas (§P)**: `answersInfoRequestId` = **FK interna** (SetNull); `targetContributionId` = **soft** (rompe ciclo); `primaryTitleClaimId` = **soft** (inmutabilidad); `relatedProposalId`/`supersedingProposalId` = **soft** (otro root). **"Blanda" NO exime de validación por pertenencia+estado en Application Service** (§P).
2. **`NotificationPref.contributions`**: **incluida** en esta migración, `Boolean @default(true)` (copia la convención de las prefs hermanas reales; nace habilitada; feature OFF ⇒ no genera notis).
3. **CHECKs de lifecycle de `ClaimEvidenceArtifact`**: **diferidos a MVP-B** (G.2). Ahora solo el CHECK estable de `status` (G.1).
4. **CHECKs "convenientes/estructurales/estables"**: **todos ahora** (G.1) — tablas nuevas y vacías = el momento más barato para impedir estados inválidos. Fuera de DB, lo de G.3.

*(id Int, uploads MVP-B, contentClass Alt C, Publisher String, sin ProposalModerationEvent, `OTHER` intacto ya están cerrados en docs previos.)*

**No quedan preguntas bloqueantes abiertas.** El plan está listo para editar `schema.prisma` (rollout §Q).

---

## Revisión adversarial

- **¿100% aditiva?** **Sí.** 9 tablas nuevas (vacías) + 1 columna con default en `NotificationPref`. Cero cambios a datos existentes, cero backfill, `Work` intacto.
- **¿Campo obligatorio que rompe migration-before-code?** **No.** No-null-sin-default solo en tablas **vacías** (seguro); la única tabla existente tocada lleva `@default`.
- **¿Unique con scope incorrecto?** No: idempotency keys **globales nullable** (correcto para UUID de cliente); Subscription (user,proposal); ResolutionRecord(proposal); PreflightKey/EvidenceRef compuestos correctos.
- **¿CHECK demasiado inteligente/frágil?** Los operación-específicos (applied refs × outcome, lifecycle de artifact) se **dejan fuera de DB** (dominio / MVP-B). Los que quedan son enum-membership y coherencias simples.
- **¿Alguna soft ref debería ser FK interna?** Revisado (§P): `answersInfoRequestId` **es** FK interna; `targetContributionId`/`primaryTitleClaimId` quedan soft **con motivo** (ciclo / inmutabilidad); las cross-root son soft por DDD. Ninguna soft interna "sin necesidad".
- **¿Índices innecesarios?** No: cada obligatorio cita su query; los especulativos se **postergaron**; no se duplican los que cubre un unique.
- **¿PreflightKey diverge sin fallback?** Tiene fallback (recompute job + advisory/falso-negativo). Es cache, no verdad.
- **¿ResolutionRecord duplica estado peligrosamente?** Duplica `outcome`↔`status` **a propósito** (audit inmutable autocontenido), misma tx; divergencia = bug detectable por query, no por CHECK.
- **¿ClaimEvidenceArtifact vacío es seguro?** **Sí**: sin filas desde prod, sin worker, `storageKey` solo se exige al insertar; CHECKs de ciclo diferidos a MVP-B.
- **¿Algo toca `Work`, datos existentes o identidad?** **No.** `Work` intacto (Alt C); solo `NotificationPref.contributions` (aditiva+default); identidad (ADR-005) no se toca.
- **¿Qué aprobar antes de editar `schema.prisma`?** **Nada pendiente** — las 4 de §S están **cerradas**. La migración aditiva puede escribirse con riesgo mínimo siguiendo §Q.

**Estado:** plan de la primera migración **aditiva (MVP-A)** completo, de bajo riesgo y **con las 4 decisiones bloqueantes cerradas**: 9 tablas + 1 columna con default (convención hermana), sin tocar `Work`/datos/identidad, migración-antes-que-código segura, CHECKs G.1 ahora / G.2 en MVP-B / G.3 en dominio, `ClaimEvidenceArtifact` latente y segura. **Listo para editar `schema.prisma`** siguiendo el rollout de §Q.
