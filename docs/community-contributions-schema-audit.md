# Community Contributions — Auditoría del schema real

> **Auditoría precautoria** de cómo encaja Community Contributions en el
> `prisma/schema.prisma` **actual**, antes de editar nada. **No** modifica
> archivos, **no** SQL, **no** migraciones, **no** código. Fuentes: los 5 docs de
> contribuciones + `prisma/schema.prisma` + código real (`sameContentClass`,
> `coverStore`, notis, mutations). Datos de `Work.type` medidos en **prod (read-only)**.

## A. Resumen ejecutivo

- **El schema de contribuciones es puramente ADITIVO**: 9 tablas nuevas, **cero cambios** a modelos existentes → **sin migración de datos ni backfill**, riesgo mínimo.
- **`contentClass` NO necesita tocar `Work` ahora.** Dato real: de **1800 works**, solo **2** son no-MANGA/no-COMIC (1 `OTHER`, 1 `LIGHT_NOVEL`), ambos manga-side. La derivación `sameContentClass` (COMIC vs no-COMIC) ya parte limpio. → **Recomendación C** (contentClass autoritativo solo en `CatalogProposal`; catálogo sigue derivando). Esto **corrige** mi lean previo hacia B.
- **Storage y notis se reusan**: `storeImageBytes` (upload→R2) y el patrón de dedup `IvreaReleaseNotified` cubren promoción de portada e idempotencia de notis. `Notification.type` es String libre → `CONTRIB_*` sin cambio de schema.
- **Refs blandas a User ya son patrón del repo** (`Report`/`Store`/`IndieWork`) → `authorId String?` sin FK encaja.
- **Faltan mutations**: solo `mergeWork` es reusable directo; la mayoría (Create/Add/Update/AttachId/ReplaceCover/Split) **requiere extensión** del framework.
- **Decisiones cerradas** (§Q/§N): id Int · CHECKs solo estructurales · sin `ProposalModerationEvent` · **contentClass Alt C (no tocar Work)** · Publisher String canónico · **uploads en MVP-B** (referencias en MVP-A) · registro `OTHER` intacto.
- **Explícito para la migración:** el cambio es **aditivo**, **sin backfill**, **no modifica datos existentes**, **riesgo de migración bajo**. La **infra de uploads (MVP-B)** es el **riesgo operativo principal**, pero **no bloquea MVP-A**.

## B. Grounding del schema real

| Tema | Hallazgo |
|---|---|
| **IDs** | `Int autoincrement`: Work, PublisherEdition, Volume, MutationLog, Notification, y casi todo el dominio. `String cuid`: User, Account, Session. |
| **Assets/covers** | **No hay modelo Asset**. Portadas = **String URL** en `Work.coverImage` / `Volume.coverImage`, apuntando a R2. Key = hash del contenido. |
| **Timestamps** | Convención `createdAt DateTime @default(now())` + `updatedAt DateTime @updatedAt`. |
| **Soft delete / estados** | No hay soft-delete; se usan **campos de estado String** (`status`, `upcoming`, etc.). El "borrado" de datos de usuario es hard-delete vía Cascade. |
| **`Json`** | Usado como **blob sin tipar**: `Work.credits`, `Work.readingLinks`, `EditionsCache.data`, `JobRun.summary`. **Sin** validador de forma en schema, **sin** versionado/discriminador. |
| **Strings como enums** | **Toda** la "enumeración" es `String` + comentario (Work.type, status, Notification.type, MutationLog.phase…). **Cero `enum` de Prisma.** |
| **Índices/uniques** | Compuestos frecuentes (`@@unique([userId, anilistId, editionKey])`, `@@unique([publisher, slug])`, `@@unique([editionId, number])`). Work.anilistId/muId/mdId `@unique`. |
| **Cascades** | `onDelete: Cascade` para hijos de User y de agregados (TrackedEdition→OwnedVolume, Purchase→PurchaseItem…). Un `SetNull` (PublisherEdition.workId→Work). |
| **Idempotencia** | `RateLimit` (key), `IvreaReleaseNotified` (key por noti), `MutationLog.mutationKey`. Patrón key-based. |
| **Audit** | `MutationLog` (append, phases attempt/success/failure/skipped, correlationId), `JobRun` (corridas de cron/import), `LoginEvent`. |
| **Notificaciones** | `Notification` (type String libre, anilistId?, text, read) + `sendPushToUser(s)` + `NotificationPref` (categorías bool) + dedup `IvreaReleaseNotified`. |
| **Tablas tipo Proposal/Contribution** | `Report` (PENDING/RESOLVED, userId?), `Store`/`IndieWork` (PENDING/APPROVED, submittedBy). **Precedente de "comunidad propone → admin modera"**, pero **single-table simple** — NO reutilizable como el ledger Proposal/Claim (demasiado distinto). Convergen en fase futura, no ahora. |

## C. Compatibilidad por modelo (resumen; detalle en §K)
Los 9 modelos nuevos son **aditivos**; sus **FKs internas** siguen la convención Cascade; sus **refs externas** (Work/Edition/Volume/User/MutationLog/asset) son **blandas** (patrón ya usado por Report/Store/IndieWork). Ver tabla completa en §K.

## D. `Work.type` / `contentClass` (el punto sensible)

**Datos reales (prod, read-only):** `MANGA: 1086 · COMIC: 712 · OTHER: 1 · LIGHT_NOVEL: 1` (total 1800). **Ambiguos (no MANGA/COMIC): 2 registros**, ambos manga-side.

- **Valores usados**: MANGA, COMIC, OTHER, LIGHT_NOVEL (los otros del enum documentado —ARTBOOK/DATABOOK— no aparecen en prod).
- **Validación**: `Work.type` es `String @default("MANGA")`; se setea por import/clasificador (`lib/contentType.looksLikeComic`) y override admin (`updateWorkAction`). No hay CHECK.
- **`sameContentClass`** (`lib/catalog.ts`): `(existing === "COMIC") === (incoming === "COMIC")` — barrera **binaria** COMIC vs no-COMIC. Todo lo no-COMIC (MANGA/LIGHT_NOVEL/OTHER/ARTBOOK/DATABOOK) = manga-side; COMIC = comic-side. **Ya es inequívoca** con los datos actuales (el único `OTHER` cae en manga-side por defecto, que es lo correcto).
- **Código que depende de `Work.type`**: `sameContentClass` (guard/dedup), `inCatalogWhere` (filtro manga/cómic del catálogo), `scan-crosstype`, clasificador. Todos leen `type` como String.
- **`OTHER`**: 1 registro. No sistémico. Merece una reclasificación manual eventual, **no bloquea**.

**Comparación de alternativas:**

| Alt | Impacto | Riesgo |
|---|---|---|
| **A. seguir derivando de Work.type** | 0 (status quo) | bajo — la derivación ya es inequívoca (1 OTHER manga-side) |
| **B. persistir contentClass explícito en Work** | columna nueva + backfill 1800 filas + **tocar la tabla sensible** + código que lee type debe considerar contentClass | **medio** — cambio al catálogo antes de que existan contribuciones; innecesario ahora |
| **C. contentClass solo en `CatalogProposal`, adaptar al aplicar** | 0 en catálogo; el BC **siembra** su contentClass autoritativo (del Work referenciado vía sameContentClass, o del WORK_TYPE claim para altas); al aplicar, `createWork` setea `Work.type` y el guard sigue con `sameContentClass` | **bajo** |

**Decisión firme: C** (cerrada). No tocar `Work` ahora. El BC de contribuciones tiene su `contentClass` autoritativo e inmutable; el catálogo sigue derivando con el guard actual, que **los datos reales prueban inequívoco**. **Apply valida que el `WORK_TYPE` aplicado sea compatible con el `contentClass` estructural de la Proposal**, y los **merges estructurales pasan obligatoriamente por `sameContentClass`**. Sin backfill, sin modificar datos existentes. Persistir contentClass en `Work` (B) es un **hardening futuro opcional**, no un requisito del MVP. *(Corrige mi recomendación previa que leaneaba B por teoría.)*
> **Condición de revisión:** esta decisión (derivar, no persistir) se revisa **únicamente** si la taxonomía real de `Work.type` deja de permitir una derivación inequívoca de la clase (hoy: 2/1800 works no-MANGA/COMIC, ambos manga-side).

## E. Publisher

- **Representación real**: `PublisherEdition.publisher` = **String** (ej. "Ivrea Argentina", "Panini Argentina"). **No hay modelo `Publisher`.**
- **Normalización**: listas canónicas en `lib/catalog.ts` — `PUBLISHERS`, `CATALOG_PUBLISHERS`, `COMIC_PUBLISHERS`, `EDITORIALS` (slug↔nombre). El import usa `mapWhakoomPublisher`. Unique `@@unique([publisher, slug])`.
- **Riesgo de spelling**: los valores vienen de constantes canónicas → bajo; pero es String libre (no CHECK).
- **Recomendación: B — `EDITION_PUBLISHER` = String canónico validado en aplicación** contra `PUBLISHERS`/`CATALOG_PUBLISHERS`. **No** justifica un modelo `Publisher` nuevo (el repo funciona con String + constante). Un modelo `Publisher` sería un arco propio, fuera de este MVP.

## F. Mutation Framework

- **`MutationLog`**: `Int id`, `correlationId String` (idx), `mutationKey String?` (idempotencia), `actorType/actorId String`, `phase` (attempt/success/failure/skipped), `dryRun`, `creates/updates/deletes`, `summaryDomain/Human`, `errorName/Message`, `at`. **ResolutionRecord enlaza limpio** vía `mutationCorrelationId` → `MutationLog.correlationId` (String, indexado). ✅
- **Idempotencia**: `mutationKey` (unique-ish por lectura de `success`). Compatible con `idempotency.key = "contribution:"+id`.
- **curated**: `lib/domain/work/curated.ts` (`markCurated`/`isCurated`/`dropCuratedFields`) sobre `Work.curated String[]`. Apply marca curated con esto. ✅
- **Mutations existentes** (`lib/catalog/mutations`, `lib/domain/work`): `mergeWork`, `deleteWork`, `cleanRedundantEditions`, `normalizeGenres`.

**Clasificación de las operaciones del diseño:**

| Operación | Estado |
|---|---|
| **MergeWorks** | **ya soportada** (`mergeWork` framework mutation) |
| DeleteWork *(no del MVP pero existe)* | ya soportada |
| **CreateWork(+FirstEdition)** | **requiere extensión** — lógica existe en `findOrCreateWork` (NO es defineMutation) |
| **AddEdition** | **requiere extensión** — existe `upsertPublisherEdition` (no mutation) |
| **AddVolume** | **requiere extensión** — hay upsert de Volume en imports (no mutation) |
| **UpdateWork** | **requiere extensión** — existe `updateWorkAction` (server action admin, no framework mutation) |
| **UpdateEdition / UpdateVolume** | **no existe** como mutation |
| **AttachExternalId** | **requiere extensión** — parte de update; no mutation dedicada |
| **ReplaceCover** | **requiere extensión** — existe `storeCover`/`storeImageBytes` + set coverImage (no mutation) |
| **SplitWork** | **no existe** — solo el script one-off `split-work-1716.ts` (no defineMutation) |

→ La mayoría **requiere envolver lógica existente en `defineMutation`** (preview/execute/audit/idempotencia). `MergeWorks` se reusa directo. `SplitWork` es el más costoso (F2).

## G. Covers y storage

- **Modelos/campos**: portada = **String URL** en `Work.coverImage`/`Volume.coverImage` (no hay Asset). Volume tiene `coverImage String?`, `isbn`, `whakoomComicId`.
- **Pipeline `coverStore.ts`**: `storeCover(url)` baja de una URL→R2 (key por hash del source); **`storeImageBytes(bytes, contentType)`** sube **bytes crudos** (upload del admin)→R2, key por **hash de contenido** (dedup), devuelve `{ok, url}`. Valida `image/*`. **Este es el primitive exacto para promover un `ClaimEvidenceArtifact` a portada oficial.** ✅
- **URLs/R2/hash/MIME**: R2 público, `Cache-Control immutable`, key = sha256(contenido/source).slice(24). MIME chequeado. **No hay tabla de assets, no hay GC/cleanup de objetos R2.**
- **Reemplazo de portada**: se pisa `coverImage` con otra URL; respeta `curated`.
- **Promoción temporal→oficial**: **no existe hoy** (no hay concepto de "artefacto temporal"). Se construye: subir el artefacto a un prefijo temporal/privado (cuarentena), y al aceptar → `storeImageBytes` al prefijo oficial + set `coverImage`.
- **Compatibilidad**: el diseño pre-Prisma es **compatible con adaptación menor** — `promotedAssetRef` = la **URL String de R2** (no un ref a tabla). Ajuste: el ciclo cuarentena/borrado-30d/tombstone es **infra nueva** (el repo no borra objetos R2 hoy) → hay que construir el worker de borrado + almacenar `storageKey`/`hash` (que hoy no se persisten; la key es implícita).

## H. Notifications e idempotencia

- **`Notification`**: `type String` **libre** (valores actuales: NEW_VOLUME, ADDED_EDITION, WISHLIST_AVAILABLE, REACTION, COMMENT, FRIEND_*). `anilistId Int?`, `text`, `read`. **Agregar `CONTRIB_*` = cero cambio de schema.**
- **Routing**: por `type` + `anilistId` (negativo = -workId). Mi diseño rutea igual (anilistId set → obra; null → /mis-contribuciones). ✅
- **Dedup**: `IvreaReleaseNotified` (`key String @id`) — `localNotify` chequea/crea keys para idempotencia. **Reusable** para contribuciones con keys `contrib:{proposalId}:{event}:{userId}` (misma mecánica; una tabla dedup análoga o reuso).
- **Prefs**: `NotificationPref` (categorías bool) → agregar `contributions Boolean @default(true)` (columna aditiva).
- **Reutilización por evento**: NEEDS_INFO/ACEPTADA/RECHAZADA/SUPERSEDED/ABANDONADA → todas via `Notification` (nuevos `type` CONTRIB_*) + `sendPushToUser(s)` + dedup key. Autor/originador/aportante/suscriptor = distintos `userId` destino, mismo mecanismo.
- **Riesgo sin outbox**: igual que hoy (si el proceso muere post-commit/pre-notify, se pierde esa noti). **El sweep propuesto encaja**: recorrer ResolutionRecords sin key de dedup y reintentar — usa estado existente, sin tabla outbox nueva. Aceptable para MVP.

## I. User refs y anonimización

- **`User.id`** = `String cuid`.
- **Cascades**: los datos **propios** del usuario (Manga, WishlistItem, Purchase, Activity, Notification, PushSubscription, etc.) cascadean con `onDelete: Cascade`.
- **Refs blandas a User ya existen**: `Report.userId?`, `Store.submittedBy?`, `IndieWork.submittedBy?` — **String sin `@relation`/FK**. Al borrar un usuario, esas quedan **colgadas** (no cascadean) → el contenido comunitario sobrevive sin el usuario. **Exactamente el patrón que necesita el ledger.**
- **`authorId String?` sin FK encaja perfecto** con el repo. Anonimización = poner `authorId=null` (o dejar el id colgado si el user se borra) → display "Otra persona". **No email en el ledger** (consistente: Report/Store/IndieWork tampoco guardan email).
- **Riesgo de perder atribución**: nulo si anonimizamos con `null` explícito (mantiene la fila, solo desvincula). Patrón recomendado = el existente (soft ref String, nullable).

## J. JSON contracts

- **Uso real de `Json`**: blobs sin tipar (`Work.credits`, `readingLinks`, `EditionsCache.data`, `JobRun.summary`). **Validación en código** (parsers ad-hoc al leer), **sin** validador central, **sin** versionado, **sin** discriminador+versión persistidos.
- **Precedente de discriminador+versión**: **no existe** en el schema. `ProposalClaim.value Json` + `attributeKind` + `contractVersion` sería el **primer** contrato JSON tipado del repo.
- **Riesgos al agregar `value Json`**: que degrade a blob libre como los actuales.
- **Recomendaciones**:
  - el **validador vive en el dominio** (`lib/contributions/attributeContracts` conceptual), NO en Prisma; se ejecuta al **escribir** cada claim.
  - evitar JSON libre = **el submit rechaza** cualquier value que no valide contra `(attributeKind, contractVersion)`.
  - **`contractVersion Int` es suficiente** como discriminador de versión (matchea el estilo `schemaVersion`/`definitionVersion` de MutationLog).
  - **lectura de versiones viejas**: el dominio mantiene un intérprete por versión; las claims viejas nunca se reescriben (append-only). Estrategia idéntica a como MutationLog versiona (`schemaVersion`).

## K. Integración por modelo

| Modelo nuevo | Relacionado existente | Integración | FK/ref | IDs | Adaptación | Riesgo |
|---|---|---|---|---|---|---|
| **CatalogProposal** | Work/Edition/Volume (target), User (originator) | refs blandas | ref blanda | Int→Int, User cuid→String | ninguna | bajo |
| **ProposalContribution** | User (author) | ref blanda a User | soft String (patrón Report) | — | ninguna | bajo |
| **ProposalClaim** | catálogo (promotedAssetRef=URL) | ref blanda | soft String URL | — | value Json tipado (nuevo patrón) | medio (JSON) |
| **ClaimEvidenceReference** | — | interno | FK interna | Int | ninguna | bajo |
| **ClaimEvidenceArtifact** | R2 (storeImageBytes) | infra storage | storageKey String | Int | **worker de cuarentena/borrado (nuevo)** | medio |
| **ProposalInfoRequest** | User (target/opener), Contribution | interno + soft User | FK interna + soft | Int/String | ninguna | bajo |
| **ProposalSubscription** | User | soft User + FK proposal | soft String + FK | Int/String | pref `contributions` (aditiva) | bajo |
| **ResolutionRecord** | MutationLog (correlationId), catálogo (applied refs), User | soft refs | soft String/Int | Int | ninguna | bajo |
| **ProposalPreflightKey** | — (derivada de claims) | interno | FK interna | Int | recompute job | bajo |

## L. Constraints — Prisma / SQL manual / dominio

| Constraint | Cómo |
|---|---|
| unique Subscription(user,proposal), ResolutionRecord(proposal), Contribution(idempotencyKey), PreflightKey(proposal,type,value), EvidenceRef(claim,type,value) | **Prisma directo** (`@@unique`) |
| FKs internas + cascade | **Prisma directo** (`@relation onDelete: Cascade`) |
| `relatedProposalId != id`; `result×resultReason`; `family×targetKind` + columnas de target | **SQL manual** (Prisma no expresa CHECK; se agrega en la migración a mano, patrón del repo: "crear SQL a mano" — ver docs/scripts.md) |
| contentClass estable (inmutable) | **dominio/application** (no hay trigger; el repo no usa triggers) |
| append-only; Proposal terminal sin claims PROPUESTA; terminal no acepta Contributions | **dominio/application** (transacción atómica + chequeo de estado) |
| idempotency keys | **Prisma** (`@unique`) + **application** (generación/uso) |
| WORK_TYPE intra-class; required sets; no cross-type merge; JSON contract; evidencia | **dominio/application** |

**CHECKs reforzables sin volver la migración inmanejable**: `relatedProposalId != id`, `result×resultReason`, `family×targetKind`, y valores de los ~5 enum-strings estables. El repo ya crea SQL a mano en migraciones → agregar unos CHECK es viable. El resto queda en application.

## M. Índices — vs queries y convenciones reales

- **Necesarios desde MVP**: `CatalogProposal(status)` (cola), `ProposalPreflightKey(keyType,keyValue)` (preflight), `ProposalContribution(proposalId,createdAt)` + `(authorId)` ("mis contribuciones"), `ProposalSubscription @unique(user,proposal)` + `(proposalId,status)` (fan-out), `ResolutionRecord @unique(proposalId)`, `ProposalInfoRequest(proposalId,status)`, `ClaimEvidenceArtifact(status)`+`(scheduledDeleteAt)` (worker de borrado).
- **Pueden esperar**: `CatalogProposal(relatedProposalId)`, `(originatorUserId)`, `ResolutionRecord(outcome)`/`(resolvedAt)`/`(moderatorUserId)` — se agregan cuando haya volumen/analytics.
- **Redundantes por FK/unique**: los `@@unique` ya crean índice → no duplicar (ej. no índice extra sobre la columna del unique).
- **Orden de compuestos**: `(status, family)` correcto (se filtra por status primero); `(proposalId, createdAt)` correcto (scope por proposal, orden por fecha).
- **Riesgo de sobreindexar**: bajo si se sigue "un índice = una query nombrada". Prisma **no** indexa FKs automáticamente en Postgres — hay que declarar `@@index` en las columnas de FK que se consultan (proposalId, contributionId, claimId). Incluirlos.

## N. Respuestas recomendadas a las 5 preguntas (con evidencia real)

1. **`CatalogProposal.id`: Int vs cuid** → **Int autoincrement.** Evidencia: es la convención de **todo** el dominio (Work/Edition/Volume/MutationLog). La enumeración pública es menor (las propuestas pendientes ya se muestran); si preocupa, se mitiga con slug/opacidad en la URL, no cambiando la convención. **Int.**
2. **CHECKs estructurales vs solo-dominio** → **CHECKs solo para los ~5 estables** (family, contentClass, status, claimResult+reason, claimOperation) + `relatedProposalId != id` + `family×targetKind`. Evidencia: el repo **ya agrega SQL a mano** en migraciones; un puñado de CHECK es barato y protege invariantes duros. El resto (contrato) queda en dominio (como todo el repo). **Híbrido acotado.**
3. **Sin `ProposalModerationEvent` en MVP** → **Confirmado NO.** Evidencia: `MutationLog` ya captura Apply/fallos; visibilidad/retiro/bloqueo tienen hogar en Contribution/Artifact; InfoRequest captura NEEDS_INFO. Se pierde solo el **timeline unificado** — aceptable; se agrega después sin remodelar.
4. **contentClass explícito en Work vs derivado** → **Derivado (Alt C): NO tocar Work ahora.** Evidencia: 2/1800 works ambiguos, ambos manga-side; `sameContentClass` ya inequívoco. contentClass autoritativo vive en `CatalogProposal`; el catálogo deriva. Persistir en Work = hardening futuro opcional. **(Corrige el lean previo a B.)**
5. **Publisher String canónico vs modelo** → **String canónico validado** contra `PUBLISHERS`/`CATALOG_PUBLISHERS`. Evidencia: el repo no tiene modelo Publisher y funciona con String + constante. Un modelo Publisher es otro arco. **String canónico.**

## O. Plan seguro Preview → Staging → Producción

**Prerrequisitos de catálogo:** **ninguno** (Alt C; el schema de contribuciones es aditivo, no toca Work/Edition/Volume). ← hallazgo clave, reduce el riesgo.

**Dos subfases del MVP:**
- **MVP-A** — contribuciones + `EvidenceReference` (URL/ISBN/fuentes verificables). **Upload deshabilitado** (una fila `ClaimEvidenceArtifact` NO se crea desde prod). La UI pide portada por **fuente oficial** mientras el upload esté off.
- **MVP-B** — uploads habilitados por flag (ciclo completo: MIME por contenido, cuarentena, escaneo, re-encode+EXIF, storage privado, URLs firmadas, worker de borrado 30d, tombstone, promoción `storeImageBytes`, pruebas). `ClaimEvidenceArtifact` **ya está en el schema desde MVP-A** → **no hay segunda migración estructural**.

**Orden:**
1. **Schema de contribuciones** (migración **aditiva**: 9 tablas nuevas + `NotificationPref.contributions` + CHECKs). Se crea el SQL a mano (convención del repo) y se aplica **migración-antes-que-código**: staging DB → prod DB (aditivo, cero riesgo a datos existentes).
2. **Domain core** (`lib/contributions/*` puro: state machine, attributeContracts, preflight, evidence rules) + tests unitarios.
3. **Repos/adapters** (Prisma).
4. **Mutations** nuevas (`defineMutation`: createWork, addEdition, addVolume, updateWork/Edition/Volume, attachExternalId, replaceCover) + reuso `mergeWork`. Split = F2.
5. **Notificaciones** (reuso Notification + dedup + pref).
6. **UI**: cola admin/moderación primero; luego form contribuidor. Todo detrás de flag `contributions` (**off**).
7. **Pruebas**: unit (core) + QA manual del pipeline submit→moderar→apply→reconcile.
8. **Preview** · 9. **Staging** · 10. **Prod**.

**Primer momento a Preview:** cuando el **pipeline admin end-to-end** (submit interno → cola → apply → ResolutionRecord) funciona **detrás del flag off**. Gate: schema aplicado a staging DB, `npm run check` verde, mutations con dry-run OK.

**Primer deploy a Staging:** cuando **form contribuidor + moderación + apply** son testeables end-to-end (flag off) en la rama/DB de staging. Gate: QA de Preview pasado; sin regresiones del catálogo.

**Gates antes de Producción:**
- migración **aditiva** aplicada a prod (segura, tablas nuevas) **antes** del deploy de código;
- feature flag `contributions` **OFF** al deployar;
- **admin-only** primero (solo el dueño modera y prueba con datos reales); luego usuarios invitados;
- Full QA del flujo + del catálogo (que Apply no corrompe: reusa guard cross-type);
- **Prod puede abrir con MVP-A** (referencias) y habilitar **MVP-B** (uploads) después por flag, con la UI comunicando "portada por fuente oficial" mientras el upload esté off;
- **Staging end-to-end del flujo de portadas subidas requiere MVP-B**;
- recién entonces abrir a comunidad (post pre-launch).

Evita "vivir en Preview": el pipeline admin va a Preview apenas compila y pasa dry-run; a Staging apenas hay flujo end-to-end (MVP-A); a Prod (flag off) apenas la migración aditiva está y el admin puede validar con datos reales. MVP-B se suma cuando el ciclo de uploads está probado.

## P. Riesgos

1. **JSON `value` degradando a blob libre** (no hay precedente tipado en el repo) → validador de dominio obligatorio al escribir.
2. **Worker de cuarentena/borrado de artifacts en R2 es infra nueva** (el repo no borra objetos R2) → construir + probar el ciclo (30d, tombstone) sin romper covers oficiales.
3. **CHECKs vía SQL manual** → si se agregan mal, la migración falla; probar en staging primero.
4. **Refs blandas colgadas** (Work fusionado) → resolución en application (ya asumido); el ledger no se rompe.
5. **Falta de outbox** → noti perdida en crash post-commit; mitiga dedup + sweep; aceptar para MVP.
6. **Muchas mutations nuevas** (Create/Add/Update…) → superficie de bugs; mitigar reusando el guard cross-type y el patrón de `mergeWork`.
7. **Enumeración pública de Proposal.id (Int)** → menor; mitigable en URL.

## Q. Decisiones cerradas
1. **contentClass → Alt C** (derivar, **no** tocar `Work`). Apply valida WORK_TYPE↔contentClass; merges por `sameContentClass`. Revisable solo si la taxonomía de `Work.type` deja de derivar inequívoco (§D).
2. **Registro `OTHER`** → **dejar intacto** (es manga-side, `sameContentClass` lo trata bien). **Caso conocido registrado** (§D). Solo se corrige en un cambio **separado** si aparece una clasificación objetivamente incorrecta — **no** se mezcla limpieza incidental de prod con la migración aditiva.
3. **Uploads** → **dentro del MVP**, en **subfase MVP-B**. `ClaimEvidenceArtifact` entra en el schema aditivo inicial; MVP-A opera solo con referencias; la UI de uploads queda detrás de flag hasta el ciclo completo. No hay segunda migración estructural (§O).
4. **Convergencia de `Report`/`Store`/`IndieWork`** → se **dejan como están** en MVP (convergen en fase futura, no se reutilizan como el ledger).

*(Decisiones transversales ya cerradas en el schema-design §Q: `id` Int, CHECKs solo estructurales, sin `ProposalModerationEvent`, Publisher String canónico.)*

---

## Revisión adversarial

- **¿Alguna recomendación contradice los docs congelados?** No. Alt C (contentClass en el BC, no en Work) **respeta** ADR-006 (contentClass estructural autoritativo — vive en la Proposal, que es donde el dominio lo declara autoritativo). El catálogo derivándolo es integración, no dominio.
- **¿Infraestructura paralela innecesaria?** Se **evita**: notis reusan Notification+dedup; audit reusa MutationLog; storage reusa `storeImageBytes`; sin outbox nuevo. Lo único genuinamente nuevo es el **worker de borrado de artifacts** (no hay equivalente) y el **contrato JSON tipado** (no hay precedente) — ambos justificados, no paralelos.
- **¿Migración con riesgo de datos?** **No** (Alt C): el schema es **aditivo puro** (tablas nuevas + 1 columna nullable + CHECKs sobre tablas nuevas). Cero backfill, cero cambio a datos existentes. El único toque a una tabla vieja sería `NotificationPref.contributions` (columna con default, seguro).
- **¿contentClass necesita tocar Work ahora?** **No.** Dato real (2/1800 ambiguos, manga-side) → la derivación es segura; persistirlo es hardening futuro.
- **¿Algún supuesto previo incorrecto al ver el schema real?** **Sí, dos**: (a) mi lean a "persistir contentClass en Work" (B) — el dato real dice C; (b) asumí que la promoción de portada necesitaba diseño nuevo — `storeImageBytes` ya existe (solo falta el ciclo de cuarentena/borrado).
- **¿Qué resolver antes de la primera línea de Prisma?** **Todo resuelto** (§Q): Alt C, uploads en MVP-B (`ClaimEvidenceArtifact` en el schema pero gated), CHECKs vía SQL manual acotados, id Int, Publisher String, sin ProposalModerationEvent, `OTHER` intacto. **El schema aditivo puede escribirse con riesgo mínimo**; el siguiente paso es el plan exacto de la primera migración aditiva (modelos/campos/índices/CHECKs) para revisión.

**Estado:** el schema de contribuciones **encaja de forma aditiva y de bajo riesgo** en el catálogo actual; el punto sensible (contentClass) **no requiere tocar `Work`** según los datos reales; storage/notis/refs-a-User se **reusan**; lo genuinamente nuevo (JSON tipado, worker de artifacts) está acotado y justificado. Listo para cerrar §Q y, recién entonces, escribir el primer schema aditivo.
