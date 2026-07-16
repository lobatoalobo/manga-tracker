# Community Contributions — Diseño de schema (pre-Prisma)

> **Propuesta concreta de persistencia**, revisable, **sin** editar `schema.prisma`,
> **sin** SQL, **sin** migraciones, **sin** código. Fuentes de verdad congeladas:
> [ADR-006](adr/006-community-contributions.md), [domain model](community-contributions-domain-model.md),
> [persistence model](community-contributions-persistence-model.md),
> [attribute-kinds](community-contributions-attribute-kinds.md). Los bloques `model`
> son **tentativos** (nombres/tipos compatibles con Prisma), no el schema real.

## Convenciones del repo detectadas (para no inventar patrones)
- **IDs**: dominio/data = `Int @id @default(autoincrement())` (Work, Edition, Volume, MutationLog…). Auth = `String @id @default(cuid())` (User…).
- **Enums**: el repo **no usa `enum` de Prisma** — todo es `String` con comentario, validado en dominio. **Seguimos esa convención** (§C).
- **Sin outbox**: existe `MutationLog` (audit de mutaciones) + patrón de idempotencia de notis `IvreaReleaseNotified` (key-based). Se **reusa**, no se crea infra paralela (§J).
- **Refs cross-BC**: blandas, sin FK (persistence model §B). Work/Edition/Volume = `Int`; User = `String` (cuid); correlationId = `String`.

---

## A. Diagrama textual de modelos

```
CatalogProposal (root)              ── originatorUserId ⇢ User (soft)
 ├─1:N ProposalContribution         ── authorId ⇢ User (soft)
 │       └─1:N ProposalClaim        ── promotedAssetRef ⇢ catálogo (soft)
 │                ├─1:N ClaimEvidenceReference   (VO inmutable)
 │                └─1:N ClaimEvidenceArtifact    (entidad + ciclo)
 ├─1:N ProposalInfoRequest          ── answeredByContributionId (derivado; ver §11)
 ├─1:1 ResolutionRecord             ── mutationCorrelationId ⇢ MutationLog (soft)
 └─1:N ProposalPreflightKey         (índice derivado recomputable — NO verdad)

ProposalSubscription (aparte)       ── userId ⇢ User · proposalId ⇢ CatalogProposal

Target (Work/Edition/Volume) y appliedTarget: refs BLANDAS (Int) en Proposal/Resolution.
Entidades auxiliares aprobadas: ProposalPreflightKey (derivada). NO: ProposalTarget, ProposalModerationEvent (§14), tablas de proyección autoritativa.
```

## B. Especificación campo por campo (tentativa)

### CatalogProposal — root
```
model CatalogProposal {
  id                Int      @id @default(autoincrement())
  family            String   // ALTA | CORRECCION | REPORTE
  targetKind        String   // NEW_WORK|NEW_EDITION|NEW_VOLUME|WORK|EDITION|VOLUME|STRUCTURAL
  // Target refs BLANDAS (sin FK); poblado según targetKind (§E)
  refWorkId         Int?     // Corrección WORK / Alta NEW_EDITION (padre) / Reporte work A
  refEditionId      Int?     // Corrección EDITION / Alta NEW_VOLUME (padre)
  refVolumeId       Int?     // Corrección VOLUME
  relationKind      String?  // solo STRUCTURAL: DUPLICATE | BAD_MERGE
  refWorkBId        Int?     // solo DUPLICATE: contraparte
  contentClass      String   // MANGA | COMIC — AUTORITATIVO, estructural, INMUTABLE
  status            String   // SUBMITTED|NEEDS_INFO|ACEPTADA|RECHAZADA|SUPERSEDED|ABANDONADA
  version           Int      @default(0)  // optimistic locking
  relatedProposalId Int?     // advisory; CHECK != id
  originatorUserId  String?  // denorm del autor de la 1ª contribución (nullable p/ anonimización)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  // NO: publicReason/privateNote (viven en ResolutionRecord, §H)
  // NO: normTitle/romajiKey/isbnNorm/externalKey (multi-valuados → ProposalPreflightKey, §F)
  // NO: primaryTitle (designación en ResolutionRecord)
}
```
- **Responsabilidad**: identidad opaca del sujeto + discriminadores estructurales + estado de moderación. **No** grab-bag (ver §F, §3-crítica).
- **Autoritativo**: family, targetKind, refs de target, contentClass, status, version.
- **Derivado/denorm**: originatorUserId (denorm; recomputable del 1er contribution).
- **Invariantes DB**: `relatedProposalId != id` (CHECK); enum-strings acotados (CHECK opcional). **Dominio**: contentClass inmutable; family×targetKind válido; refs cross-BC existentes; resolución atómica.

### ProposalContribution
```
model ProposalContribution {
  id                   Int      @id @default(autoincrement())
  proposalId           Int      // FK interna, cascade
  authorId             String?  // ⇢ User (soft); null tras anonimización → "Otra persona"
  visibility           String   @default("VISIBLE") // VISIBLE|OCULTA|EN_CUARENTENA
  withdrawnAt          DateTime?  // retiro autoritativo (null = ABIERTA); disposición = DERIVADA
  answersInfoRequestId Int?     // AUTORITATIVO de la relación (§11)
  idempotencyKey       String?  @unique  // token de cliente anti doble-submit
  createdAt            DateTime @default(now())
  proposal   CatalogProposal @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  // NO: disposición (ACEPTADA/PARCIAL/…) → derivada de sus claims
}
```
- **Autoritativo**: authorId, visibility, withdrawnAt, answersInfoRequestId. **Derivado**: disposición (no se persiste). **Inmutable**: contenido (via sus claims append-only); solo cambian visibility/withdrawnAt (metadata).

### ProposalClaim
```
model ProposalClaim {
  id               Int      @id @default(autoincrement())
  contributionId   Int      // FK interna, cascade
  attributeKind    String   // del catálogo §attribute-kinds
  contractVersion  Int      // versión del contrato de valor
  claimOperation   String   // SET|ADD|REMOVE|MARK_UNKNOWN|MARK_NOT_APPLICABLE
  value            Json?    // tipado por (attributeKind, contractVersion); null si MARK_*
  // metadata de resolución (MUTABLE; el resto es inmutable/append-only)
  result           String   @default("PROPUESTA") // PROPUESTA|ACEPTADA|NO_USADA|RETIRADA
  resultReason     String?  // procedencia|corroboracion | desplazada|descartada|rechazada
  resolvedAt       DateTime?
  resolvedByUserId String?  // moderador/actor (null pre-resolución o SYSTEM)
  promotedAssetRef String?  // asset oficial resultante (ej. portada) ⇢ catálogo (soft)
  createdAt        DateTime @default(now())
  contribution ProposalContribution @relation(fields: [contributionId], references: [id], onDelete: Cascade)
}
```
- **Inmutable (append-only)**: attributeKind, contractVersion, claimOperation, value. **Mutable (solo resolución)**: result, resultReason, resolvedAt, resolvedByUserId, promotedAssetRef.
- **Garantías** (qué la DB puede / no puede):
  - JSON tipado por `attributeKind+contractVersion` → **dominio** (Prisma no valida forma de JSON).
  - operation/value coherente (ej. MARK_* ⇒ value null; SET ⇒ value presente) → **dominio** (+ CHECK simple posible: `claimOperation IN (...)`).
  - result/reason coherente (ACEPTADA⇒{procedencia,corroboracion}; NO_USADA⇒{desplazada,descartada,rechazada}) → **CHECK** factible o dominio.
  - claim estructural inválida no entra / no quedan PROPUESTA en terminal → **dominio/application** (transacción atómica; la DB sola no basta).

### ClaimEvidenceReference — VO inmutable
```
model ClaimEvidenceReference {
  id        Int      @id @default(autoincrement())
  claimId   Int      // FK interna, cascade
  type      String   // URL | ISBN | SOURCE_REF
  value     String   // la URL / ISBN / "provider:id" (string, no JSON)
  strength  String   // STRONG | MEDIUM | WEAK
  createdAt DateTime @default(now())
  claim ProposalClaim @relation(fields: [claimId], references: [id], onDelete: Cascade)
  @@unique([claimId, type, value])  // dedup dentro de la misma claim
}
```
- URL e ISBN **comparten modelo** (discrimina `type`); `value` = **string** (simple, verificable). Inmutable (sin updates). **Fuente caída** = **observación de moderación** (→ NEEDS_INFO), **no** muta el VO; no hace falta entidad de observación aparte.

### ClaimEvidenceArtifact — entidad con ciclo
> **En el schema desde el inicio (aditivo), pero gated MVP-B:** una fila NO se crea desde
> producción hasta habilitar el pipeline de uploads por flag (§Q — Fases). MVP-A opera solo
> con `EvidenceReference`.
```
model ClaimEvidenceArtifact {
  id               Int      @id @default(autoincrement())
  claimId          Int      // FK interna, cascade
  status           String   @default("EN_CUARENTENA") // EN_CUARENTENA|DISPONIBLE|BLOQUEADA
  storageKey       String   // opaca (key de R2); NO URL firmada
  hash             String   // content hash (tombstone/audit)
  detectedMime     String?  // MIME real detectado (infra)
  sizeBytes        Int?
  scanResult       String?  // metadata mínima de escaneo (infra)
  blockedReason    String?  // motivo de BLOQUEADA/rechazo (dominio/audit)
  scheduledDeleteAt DateTime? // borrado programado (30d, §attribute-kinds/persistence)
  bytesDeletedAt   DateTime?  // tombstone: bytes eliminados
  promotedAssetRef String?  // si se promovió a portada oficial ⇢ catálogo (soft)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  claim ProposalClaim @relation(fields: [claimId], references: [id], onDelete: Cascade)
}
```
- **Dominio**: status, blockedReason, promotedAssetRef. **Audit**: hash, timestamps, bytesDeletedAt. **Infra**: storageKey, detectedMime, sizeBytes, scanResult. **NO**: URLs firmadas, EXIF, bytes.

### ProposalInfoRequest
```
model ProposalInfoRequest {
  id                   Int      @id @default(autoincrement())
  proposalId           Int      // FK interna, cascade
  scope                String   // PROPOSAL | CONTRIBUTION
  targetUserId         String?  // aportante puntual (⇢ User soft); null = originador
  targetContributionId Int?     // si scope=CONTRIBUTION
  prompt               String   // texto público del pedido
  privateNote          String?  // solo moderador
  status               String   @default("ABIERTO") // ABIERTO | ANSWERED
  openedByUserId       String   // moderador ⇢ User (soft)
  createdAt            DateTime @default(now())
  answeredAt           DateTime?
  proposal CatalogProposal @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  // Dirección AUTORITATIVA = Contribution.answersInfoRequestId (§11). NO answeredByContributionId.
}
```

### ProposalSubscription — aggregate aparte
```
model ProposalSubscription {
  id         Int      @id @default(autoincrement())
  proposalId Int      // FK interna, cascade
  userId     String   // ⇢ User (soft)
  status     String   @default("ACTIVE") // ACTIVE | CANCELLED
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  proposal CatalogProposal @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  @@unique([userId, proposalId])
  @@index([proposalId, status])  // fan-out de Notify
}
```
- CANCELLED **se conserva** (re-suscribir = upsert a ACTIVE sobre la misma fila). Terminal ⇒ inerte. **Anonimización** = hard-delete de las suscripciones del usuario (no son ledger/audit).

### ResolutionRecord — 1 por Proposal, inmutable
```
model ResolutionRecord {
  id                    Int      @id @default(autoincrement())
  proposalId            Int      @unique   // una resolución por Proposal
  outcome               String   // ACEPTADA|RECHAZADA|SUPERSEDED|ABANDONADA
  actorType             String   // HUMAN | SYSTEM | RECONCILE
  moderatorUserId       String?  // ⇢ User (soft); null si SYSTEM/RECONCILE
  resolvedAt            DateTime @default(now())
  publicReason          String?  // motivo público (ÚNICO lugar; no en Proposal)
  privateNote           String?  // solo moderador (ÚNICO lugar)
  appliedWorkId         Int?     // refs BLANDAS al resultado en catálogo
  appliedEditionId      Int?
  appliedVolumeId       Int?
  supersedingProposalId Int?
  supersededReason      String?  // IMPORT | MODERATION | ANOTHER_PROPOSAL
  mutationCorrelationId String?  // ⇢ MutationLog.correlationId (soft)
  overrideSummary       Json?    // resumen de overrides del moderador
  primaryTitleClaimId   Int?     // designación de TITLE_PRIMARY (puntero, no texto)
  reconcileMeta         Json?    // match/ambigüedad de reconcile
  proposal CatalogProposal @relation(fields: [proposalId], references: [id], onDelete: Cascade)
}
```
- **`publicReason`/`privateNote` viven SOLO acá** (no duplicados en Proposal). Todo el record es **inmutable** (append-once).

### ProposalPreflightKey — índice derivado (auxiliar aprobado)
```
model ProposalPreflightKey {
  id         Int    @id @default(autoincrement())
  proposalId Int    // FK interna, cascade
  keyType    String // NORM_TITLE | ROMAJI | ISBN | EXTERNAL   (contentClass/status van en Proposal)
  keyValue   String // valor normalizado
  proposal CatalogProposal @relation(fields: [proposalId], references: [id], onDelete: Cascade)
  @@index([keyType, keyValue])            // preflight cross-proposal
  @@unique([proposalId, keyType, keyValue])
  // DERIVADO/RECOMPUTABLE desde las claims ACTIVAS (no rechazadas). NO es verdad del dominio.
}
```

## C. Enums vs String (decisión)

El repo **no usa `enum` de Prisma** → **seguimos con `String` validado en dominio** para **todos** los campos enum-like, para: (a) matchear la convención, (b) evitar migraciones al evolver contratos.

| Enum lógico | Valores | Representación |
|---|---|---|
| ProposalFamily | ALTA/CORRECCION/REPORTE | String (estable → CHECK opcional) |
| ProposalTargetKind | NEW_WORK/NEW_EDITION/NEW_VOLUME/WORK/EDITION/VOLUME/STRUCTURAL | String |
| ContentClass | MANGA/COMIC | String (estable → CHECK opcional) |
| ProposalStatus | SUBMITTED/NEEDS_INFO/ACEPTADA/RECHAZADA/SUPERSEDED/ABANDONADA | String |
| ClaimResult | PROPUESTA/ACEPTADA/NO_USADA/RETIRADA | String |
| ClaimResultReason | procedencia/corroboracion/desplazada/descartada/rechazada | String (CHECK combinado con result) |
| ClaimOperation | SET/ADD/REMOVE/MARK_UNKNOWN/MARK_NOT_APPLICABLE | String |
| ContributionVisibility | VISIBLE/OCULTA/EN_CUARENTENA | String |
| EvidenceArtifactStatus | EN_CUARENTENA/DISPONIBLE/BLOQUEADA | String |
| InfoRequestStatus | ABIERTO/ANSWERED | String |
| SubscriptionStatus | ACTIVE/CANCELLED | String |
| ResolutionOutcome | ACEPTADA/RECHAZADA/SUPERSEDED/ABANDONADA | String |
| ResolutionActorType | HUMAN/SYSTEM/RECONCILE | String |
| RelationKind | DUPLICATE/BAD_MERGE | String |
| EvidenceReferenceType | URL/ISBN/SOURCE_REF | String |
| EvidenceStrength | STRONG/MEDIUM/WEAK | String |
| **WorkType, AttributeKind, locale, provider, CoverFace, PartialDatePrecision, creator role, Work/Edition/Volume status/format** | (ver attribute-kinds) | **String** — viven en el **contrato de dominio versionado**, NO como enum de DB (evolucionan; migraciones evitables) |

**Regla:** los estructurales pequeños y estables (Family, ContentClass, Status, ClaimResult, ClaimOperation) admiten un **CHECK** de valores (barato, sin churn). Los **de contrato** (AttributeKind, locale, provider, WorkType) quedan **String validado en dominio** (versionable, §8). No convertir todo el contrato en enum de DB.

## D. Relaciones y cascade

- **FK internas + cascade**: Proposal → {Contribution, InfoRequest, ResolutionRecord, PreflightKey}; Contribution → Claim; Claim → {EvidenceReference, EvidenceArtifact}; Subscription → Proposal. Borrar una Proposal (excepcional, §N) cascadea su grafo. **En operación normal NO se borra el ledger**; el cascade es para casos de limpieza controlada.
- **Refs blandas (sin FK, no cascade)**: refWorkId/refEditionId/refVolumeId/refWorkBId/appliedWorkId/... → catálogo; authorId/moderatorUserId/originatorUserId/targetUserId → User; mutationCorrelationId → MutationLog; promotedAssetRef → asset oficial. Estas **no** cascadean (desacople cross-BC); una ref colgada se resuelve en application (persistence model §B).
- `answersInfoRequestId` (en Contribution) y `targetContributionId` (en InfoRequest) son **refs internas nullable sin cascade dura** (evitar ciclo de borrado; §11).

## E. Estrategia de Target — recomendación: **D (discriminated union por columnas controladas)**

| Alt | Claridad | Constraints | Queries | Estados imposibles | Prisma | Evolución |
|---|---|---|---|---|---|---|
| A columnas sueltas | media | débil | ok | muchos | ok | ok |
| B JSON tipado | baja p/ refs | débil | **malo** (no se filtra por refWorkId) | — | ok | ok |
| C entidad ProposalTarget | alta | fuerte | ok | pocos | join extra | ok |
| **D targetKind + columnas controladas** | **alta** | **CHECK por kind** | **bueno** (refs indexables) | **acotados por CHECK** | ok | ok |

**Recomendación D.** `targetKind` discrimina qué columnas de ref se pueblan; un **CHECK** por kind acota los estados imposibles; las refs son **columnas Int indexables** (necesario para "correcciones sobre este Work" y para reconcile — B las escondería en JSON). Matriz de poblado:

| targetKind | refWorkId | refEditionId | refVolumeId | relationKind | refWorkBId |
|---|---|---|---|---|---|
| NEW_WORK | — | — | — | — | — |
| NEW_EDITION | ✅ (padre) | — | — | — | — |
| NEW_VOLUME | — | ✅ (padre) | — | — | — |
| WORK | ✅ | — | — | — | — |
| EDITION | — | ✅ | — | — | — |
| VOLUME | — | — | ✅ | — | — |
| STRUCTURAL (DUPLICATE) | ✅ (A) | — | — | ✅ | ✅ (B) |
| STRUCTURAL (BAD_MERGE) | ✅ | — | — | ✅ | — |

No se crea `ProposalTarget` (join innecesario para el MVP).

## F. Estrategia de claves promovidas — recomendación: **C (tabla derivada `ProposalPreflightKey`) + singulares en Proposal**

Crítica de §3 confirmada: `isbnNorm` es Volume-level, `externalKey` es multi-provider, y una Proposal tiene **múltiples** títulos/claims → **no** pueden ser columnas singulares en Proposal (sería grab-bag y forzaría singularidad falsa).

| Alt | Multi-valor | Recompute | Rechazadas excluidas | Query | Verdad? |
|---|---|---|---|---|---|
| A columnas en Proposal | ❌ (fuerza singular) | difícil | difícil | ok | riesgo |
| B columnas en Claim | ✅ | por claim | ✅ | join | — |
| **C tabla `ProposalPreflightKey`** | ✅ | recomputable | ✅ (solo claims activas) | **índice directo** | **NO (cache)** |
| D índice funcional sobre JSON | limitado | — | — | frágil | — |

**Recomendación C** (+ `contentClass`/`status` **singulares y autoritativos en Proposal**, porque sí lo son). `ProposalPreflightKey` es una **proyección derivada recomputable** (keyType NORM_TITLE/ROMAJI/ISBN/EXTERNAL), **explícitamente no autoritativa** — se **recomputa** desde las **claims activas** (excluye RETIRADA/NO_USADA/rechazada) → una claim rechazada **deja de influir**. Es el "índice materializado recomputable, nunca verdad" que el persistence model permitió. Borrado lógico = recomputar (la fila vieja se borra/reescribe en el recompute). Evita el grab-bag en Proposal y respeta "no tablas de proyección **autoritativas**".

## G. JSON contracts (shape del `value` de Claim, por attributeKind+contractVersion)

Ejemplos de forma (no TypeScript):
```
PartialDate:      { "precision": "YEAR_MONTH", "year": 2026, "month": 7 }
                  { "precision": "UNKNOWN" }         { "precision": "UPCOMING_UNDATED" }
LocalizedText:    { "language": "es-AR", "text": "Katekyo Hitman Reborn!" }
CreatorCredit:    { "displayName": "Akira Amano", "role": "STORY_ART",
                    "externalCreatorId": null, "source": "official", "order": 0 }
ExternalId:       { "provider": "MANGAUPDATES", "externalId": "65071751600" }
Cover:            { "face": "FRONT", "artifactId": 123 }   // o { "face":"FRONT","imageRefId": 45 }
PublisherRef:     { "publisher": "Ivrea Argentina" }       // ref por nombre canónico (catálogo usa String)
Set ADD (ejemplo):{ "op-implied-by-claimOperation": "ADD", "value": { ...LocalizedText } }
REMOVE:           value identifica el miembro a quitar, ej. { "language":"en", "text":"Reborn!" }
MARK_UNKNOWN:     value = null   (la semántica la lleva claimOperation)
MARK_NOT_APPLICABLE: value = null
```
- **Versionar**: `contractVersion` por claim; si cambia el shape de un kind, se incrementa; claims viejas se **interpretan por su versión** (inmutables). 
- **Validar**: en **dominio**, por `(attributeKind, contractVersion)` (Prisma no valida shape).
- **Normalizar**: `text`/`externalId`/`isbn` se guardan **verbatim** en `value`; las claves normalizadas se **derivan** a `ProposalPreflightKey` (no pisan el value).
- **Derivar promovidas**: NORM_TITLE/ROMAJI de títulos; ISBN de VOLUME_ISBN; EXTERNAL de `{provider,externalId}`.

## H. ResolutionRecord (detalle)
- `publicReason`/`privateNote` **solo acá** (no en Proposal) → cero duplicación.
- Inmutable (append-once, `@unique(proposalId)`).
- `primaryTitleClaimId` = **puntero** a la claim de título designada primaria (no copia de texto).
- Cubre **todos** los outcomes (no solo ACEPTADA): rechazo/supersede/abandono también dejan un record con su `outcome` + `publicReason`.
- Refs de applied/superseding/mutation = **blandas**.

## I. Auditoría — recomendación MVP: **B (metadata + MutationLog + ResolutionRecord)**, sin `ProposalModerationEvent`

| Opción | Cobertura | Costo |
|---|---|---|
| A metadata+timestamps | parcial | 0 |
| **B + MutationLog + ResolutionRecord** | **alta** | 0 (reuso) |
| C event log específico | total (timeline) | tabla nueva + escritura por acto |

La mayoría de los actos ya tienen hogar: NEEDS_INFO→InfoRequest; visibilidad→Contribution.visibility; retiro→withdrawnAt; bloqueo de artifact→Artifact.status+blockedReason+timestamps; **Apply fallido→MutationLog** (el framework ya loguea `phase=failure`); resolución→ResolutionRecord. **Recomendación B.** **Audit que se pierde sin event log**: un **timeline cronológico unificado** de moderación (secuencia exacta de hides/reopens/notas mid-flight, reconcile ambiguo). Aceptable para MVP; si la forensia de moderación lo exige, se agrega `ProposalModerationEvent` (append-only) **después**, sin remodelar.

## J. Atomicidad y outbox

**Transacción única (ACEPTADA):** update Proposal→terminal + version++ · update Claims→terminal · insert ResolutionRecord · ejecutar Mutation (catálogo, mismo Postgres) · guardar applied refs. Todo en una tx (`prisma.$transaction`).

**Post-commit (fuera de la tx, I/O):** Notify · promoción de portada a R2. 

**Outbox:** el repo **no tiene** tabla outbox. Patrón existente = **noti post-commit inline** (ej. `notifyOwner`) + **idempotencia key-based** estilo `IvreaReleaseNotified`. **Recomendación MVP: reusar ese patrón** — Notify corre post-commit y **dedup por key** `contrib-notif:{proposalId}:{event}:{userId}` (tabla de dedup tipo `IvreaReleaseNotified`, ya probada). **No** se crea outbox. **Limitación** (igual que hoy): si el proceso muere entre commit y notify, esa noti se pierde; mitigación mínima opcional = un **sweep** que recorre ResolutionRecords sin noti-dedup y reintenta (usa estado existente, sin tabla nueva). Un outbox transaccional real = hardening futuro, no MVP.

## K. Concurrencia e idempotencia (a constraints/campos concretos)
- **Optimistic lock**: `CatalogProposal.version`; toda mutación del aggregate hace `UPDATE ... WHERE id=? AND version=?` (conceptual) e incrementa; conflicto ⇒ reintentar/abortar.
- **Una resolución por Proposal**: `@unique(ResolutionRecord.proposalId)` → dos moderadores/reconcile concurrentes: uno gana, el otro choca el unique.
- **Idempotency keys**: crear Proposal (token de cliente); agregar Contribution (`ProposalContribution.idempotencyKey @unique`); resolver/Apply (unique de ResolutionRecord + version).
- **Retiro idempotente**: `withdrawnAt` set-once (segundo retiro = no-op).
- **Reconcile concurrente**: chequeo de estado autoritativo (solo actúa si Proposal no-terminal) + version + unique ResolutionRecord.
- **Subscription upsert/reactivate**: `@unique(userId,proposalId)` → upsert (ACTIVE) reactiva la fila.
- **Append a terminal**: el insert de Contribution/Claim valida en la tx que la Proposal no sea terminal (condición de estado autoritativa; la DB sola no lo garantiza).

## L. Índices (justificados por query)
- **CatalogProposal**: `(status)` cola de moderación pendiente; `(status, family)` filtros de cola; `(targetKind)` + `(refWorkId)`/`(refEditionId)`/`(refVolumeId)` "contribuciones sobre esta entidad" y reconcile; `(relatedProposalId)` hermanas; `(originatorUserId)` "mis propuestas"; `(createdAt)` orden.
- **ProposalPreflightKey**: `(keyType, keyValue)` preflight cross-proposal; `@unique(proposalId,keyType,keyValue)`.
- **ProposalContribution**: `(proposalId, createdAt)` timeline; `(authorId)` "mis contribuciones"; `(visibility)` moderación de ocultos/cuarentena; `@unique(idempotencyKey)`.
- **ProposalClaim**: `(contributionId)`; `(attributeKind)`; `(contributionId, result)` claims sin resolver por proposal (vía contribution); *(unresolved por proposal se resuelve con el join contribution→proposal + result=PROPUESTA)*.
- **ClaimEvidenceArtifact**: `(status)` y `(scheduledDeleteAt)` para el worker de borrado; `(promotedAssetRef)` trazar assets promovidos.
- **ProposalInfoRequest**: `(proposalId, status)` requests abiertos; `(targetUserId)`; *(answeredBy va por Contribution.answersInfoRequestId)*.
- **ProposalSubscription**: `@unique(userId, proposalId)`; `(proposalId, status)` fan-out Notify; `(userId, status)` "mis suscripciones".
- **ResolutionRecord**: `@unique(proposalId)`; `(outcome)`; `(resolvedAt)`; `(moderatorUserId)`.
*(Sin índices especulativos: cada uno responde a una query nombrada.)*

## M. Constraints — DB vs Dominio

**DB (baratas, sin volver inmanejable la migración):**
- uniques: Subscription(user,proposal), ResolutionRecord(proposal), Contribution(idempotencyKey), PreflightKey(proposal,keyType,keyValue), EvidenceReference(claim,type,value).
- FKs internas + cascade del grafo.
- CHECK simples: `relatedProposalId != id`; enum-strings de los estructurales estables (family, contentClass, status, claimResult, claimOperation); combinación **result×resultReason**; **family×targetKind** + columnas de target pobladas por kind (CHECK).
- **Una resolución por Proposal** (el unique).

**Dominio/Application (la DB no alcanza):**
- append-only del contenido de Contribution/Claim; Proposal terminal no acepta nuevas Contributions; `contentClass` inmutable; `WORK_TYPE` intra-class; claims válidas por target; required sets (§E attribute-kinds); resolución **atómica**; no quedan PROPUESTA en terminal; **no cross-type merge** (`sameContentClass`); contrato JSON por attributeKind; requerimientos de evidencia (política).

## N. Retención y anonimización (campos concretos)
- **Autoría**: `authorId String?` (nullable). Anonimizar = set `authorId=null` (+ opcional `originatorUserId=null`) → UI muestra **"Otra persona"**. **Sin email/nombre/auth** en ningún modelo del ledger (solo el id opaco de User, que al anonimizar se desvincula).
- **Retiro**: `withdrawnAt` (estado, no delete).
- **Bytes**: `ClaimEvidenceArtifact.bytesDeletedAt` + tombstone (hash); `scheduledDeleteAt` (30d). `deletedAt` **solo** para bytes de artifacts, **nunca** para filas del ledger.
- **Terminal**: retención indefinida (no hard delete).
- **Subscription**: cancel = `status=CANCELLED` (o hard-delete al anonimizar — no es audit).
- **Notas privadas**: `privateNote` solo en ResolutionRecord/InfoRequest, solo-moderador.

## O. Integraciones con el schema existente (a verificar al abrir `schema.prisma`)

| Punto | Estado |
|---|---|
| IDs Work/Edition/Volume = `Int` | **compatible** (refs blandas Int) |
| ID User = `String cuid` | **compatible** (refs blandas String) |
| Nombres reales de modelos (Work, PublisherEdition, Volume, User) | **compatible** (solo se referencian por id) |
| `Work.type` String con `OTHER` ambiguo | **requiere adaptador** (mapear WORK_TYPE class-scoped → Work.type; y derivar/almacenar contentClass robusto) |
| `contentClass` en catálogo (hoy derivado de `type` vía `sameContentClass`) | **compatible** (Alt C decidida: se deriva; NO se agrega a `Work`; Apply valida WORK_TYPE↔contentClass y merges pasan por `sameContentClass`) |
| `MutationLog` (correlationId) | **compatible** (ResolutionRecord referencia correlationId String) |
| Notification / `IvreaReleaseNotified` dedup | **compatible** (reuso para notis + idempotencia; nueva categoría `contributions`) |
| Storage/assets (R2 `storeCover`) | **requiere adaptador** (promoción de artifact → asset oficial) |
| Campos `curated` (`Work.curated[]`) | **compatible** (Apply marca curated) |
| External ids existentes (anilistId Int, muId/mdId String, whakoomId) | **requiere adaptador** (EXTERNAL_*_ID `{provider,externalId}` → columnas existentes al aplicar) |
| Publisher = **String** (no hay modelo Publisher) | **requiere investigación** (EDITION_PUBLISHER/PublisherRef = String canónico; validar contra la lista existente) |
| No hay outbox | **compatible** (reuso patrón noti + dedup; §J) |
| No hay enums Prisma | **compatible** (usamos String, misma convención) |

## P. Riesgos
1. **Contrato JSON degradado a blob libre** → validación por `(attributeKind,contractVersion)` en dominio, obligatoria.
2. **`ProposalPreflightKey` tratada como verdad** → es cache derivada; recompute desde claims activas; nunca autoritativa.
3. **CatalogProposal grab-bag** → mitigado: reasons en ResolutionRecord, keys multi-valor en PreflightKey; Proposal solo estructura+estado.
4. **Refs cross-BC colgadas** (Work fusionado/borrado) → refs blandas + resolución en application; el ledger no se rompe.
5. **Notify perdida** (sin outbox) → dedup key + sweep opcional; hardening futuro.
6. **Estados imposibles de claim/target** → CHECKs (result×reason, family×targetKind) + invariantes de application.
7. **Habilitación de uploads (`ClaimEvidenceArtifact`)** = riesgo operativo principal (worker de cuarentena/borrado a 30d, infra nueva) → aislado en **MVP-B** detrás de flag; **no bloquea MVP-A**. `contentClass` NO se persiste en `Work` (Alt C) → sin riesgo de migración ahí.

## Q. Decisiones cerradas
1. **`CatalogProposal.id` = `Int autoincrement`** (convención del repo). La enumeración pública se mitiga en la URL, no cambiando la convención.
2. **CHECKs solo para los estructurales estables** (family, contentClass, status, result×resultReason, claimOperation) + `relatedProposalId != id` + `family×targetKind`. El resto (contrato) queda en dominio, como todo el repo.
3. **Sin `ProposalModerationEvent` en MVP** (audit por metadata + MutationLog + ResolutionRecord). Se asume la pérdida del timeline unificado de moderación (se puede agregar después sin remodelar).
4. **contentClass — Alternativa C:** `contentClass` **autoritativo solo en `CatalogProposal`**; **NO se agrega a `Work`**; el catálogo sigue derivando la clase vía `Work.type` + `sameContentClass`. **Sin backfill, sin tocar datos existentes.** `Apply` valida que el `WORK_TYPE` aplicado sea **compatible** con el `contentClass` estructural de la Proposal; los merges estructurales siguen pasando **obligatoriamente** por `sameContentClass`. *(Revisable **solo** si la taxonomía real de `Work.type` deja de permitir una derivación inequívoca — hoy 2/1800 works no-MANGA/COMIC, ambos manga-side.)*
5. **Publisher = String canónico** validado en aplicación contra `PUBLISHERS`/`CATALOG_PUBLISHERS`. **No** se crea modelo `Publisher`.

## Fases de habilitación de uploads (`ClaimEvidenceArtifact`)

`ClaimEvidenceArtifact` **entra en el schema aditivo inicial** (no se posterga ni se saca del modelo). Su **habilitación funcional** es progresiva, detrás de feature flag:

- **MVP-A** — contribuciones + **`EvidenceReference`** (URL, ISBN, fuentes verificables). Upload **deshabilitado**. **Una fila `ClaimEvidenceArtifact` NO puede crearse desde producción** mientras el pipeline esté off. La UI comunica "aportá la portada por fuente oficial mientras el upload esté desactivado".
- **MVP-B** — uploads habilitados, con el ciclo completo: validación MIME por contenido, cuarentena, escaneo, re-encode + strip EXIF, storage privado, URLs firmadas, worker de expiración/borrado a 30 días, tombstone, promoción vía `storeImageBytes`, y pruebas del ciclo.
- **Staging end-to-end completo** (flujo de portadas subidas) requiere **MVP-B**.
- **Producción** puede abrir con **MVP-A** y habilitar **MVP-B** después por flag.

Esto evita una **segunda migración estructural** (el artifact ya está en el schema) sin que la complejidad de archivos bloquee el primer flujo basado en referencias.

---

## Revisión adversarial

- **¿Modelos que solo son proyecciones?** `ProposalPreflightKey` es lo único derivado, y está **explícitamente marcado cache/recomputable, no verdad**. No hay tabla para CandidateView/Confidence/Acuerdo/Conflicto/disposición/clusters. ✅
- **¿CatalogProposal grab-bag?** No: se **sacaron** reasons (→ResolutionRecord) y las keys multi-valor (→PreflightKey). Quedan solo estructura + estado + refs de target + version. ✅
- **¿Columnas que duplican datos de Claims?** `originatorUserId` es denorm del 1er contribution (marcado, opcional). `contentClass` NO duplica una claim: es atributo estructural autoritativo (no deriva de WORK_TYPE). PreflightKey deriva de claims pero es cache. Sin otra duplicación. ✅ (vigilar originatorUserId).
- **¿Target permite combinaciones imposibles?** Acotado por `targetKind` + CHECK de columnas pobladas por kind (§E). Los restos los cubre application. ✅
- **¿ResolutionRecord duplica estado?** No: `outcome` refleja el terminal de Proposal (misma tx, consistente); `publicReason/privateNote` viven **solo** acá. Sin duplicar claim states (la procedencia se deriva de las claims). ✅
- **¿FK cross-BC rompe el desacople?** No: todas las refs a catálogo/User/MutationLog son **blandas (sin FK)**; FKs solo internas al BC. ✅
- **¿JSON realmente contratado?** Sí: `value` tipado por `(attributeKind, contractVersion)`, validado en dominio, versionado; no es blob libre. ✅
- **¿Índices responden a queries reales?** Cada índice de §L cita su query; sin especulativos. ✅
- **¿Contradice los 4 docs congelados?** No — implementa: claims append-only, evidencia VO/artefacto, contentClass estructural inmutable, refs blandas, no-hard-delete, guard cross-type, ResolutionRecord único, proyecciones no-autoritativas.
- **¿Qué verificar en `schema.prisma` real antes de implementar?** **Ya verificado** en `community-contributions-schema-audit.md`: IDs Int/cuid, `Work.type`/`OTHER` (Alt C, no tocar Work), `MutationLog`, dedup de notis, `storeImageBytes` para portadas, publishers String canónico. Sin sorpresas; el schema es aditivo.

**Estado:** diseño de schema concreto (pre-Prisma) consistente con los 4 documentos congelados, sin proyecciones autoritativas ni grab-bag, con la mayoría de invariantes repartidas entre CHECK/DB y application service. **Las 5 decisiones de §Q están cerradas** (id Int, CHECKs acotados, sin ProposalModerationEvent, contentClass Alt C sin tocar Work, Publisher String canónico) y las fases MVP-A/MVP-B de uploads definidas. Verificado contra el `schema.prisma` real (ver auditoría). Listo para preparar la primera migración aditiva.
