# Community Contributions — Modelo de persistencia conceptual

> **Puente domain model → schema.** Fuentes de verdad congeladas:
> [ADR-006](adr/006-community-contributions.md) y
> [domain model](community-contributions-domain-model.md). Este documento define
> **entidades persistentes, ownership, cardinalidades, estados, constraints e
> índices a nivel conceptual** — **sin** `schema.prisma`, **sin** SQL, **sin**
> migraciones. Si algo acá contradice el dominio, manda el dominio.

---

## A. Mapa de entidades persistentes

| Entidad | ¿Por qué persiste? | Aggregate dueño | Autoritativa | NO persistir (proyección) |
|---|---|---|---|---|
| **CatalogProposal** | identidad opaca del sujeto + estado de moderación + Target/Family | *(root)* | identidad, family, target, estado, motivo público, refs de resolución | disposición/candidata/confianza/acuerdo/conflicto |
| **ProposalContribution** | acto de autoría append-only | CatalogProposal | autor, timestamp, visibilidad, retiro, answersInfoRequest | **disposición derivada** |
| **ProposalClaim** | unidad de conocimiento y de resolución | Contribution | atributo, valor, resultado, motivo/rol | Confianza (cache), acuerdo/conflicto |
| **ClaimEvidenceReference** | VO inmutable persistido como hijo | Claim | tipo, valor, fuerza | — |
| **ClaimEvidenceArtifact** | entidad con ciclo (cuarentena) + ref de storage | Claim | estado moderación, ref opaca de storage, hash | los bytes (infra) |
| **ProposalInfoRequest** | pedido de info con ciclo propio | CatalogProposal | alcance, estado, ref a la contribución que responde | — |
| **ProposalSubscription** | interés/aviso | *(aggregate propio)* | (user, proposal), estado | conteo de suscriptores |
| **ResolutionRecord** | registro inmutable del acto de resolución (ver G) | *(anexo de la resolución)* | moderador, timestamp, outcome, refs de mutación/target, overrides | mapa de procedencia (derivable) |

**No se agregan tablas de vínculo**: `answersInfoRequest` es una referencia nullable en Contribution; la relación Claim↔Evidence es ownership directo; `relatedProposal` es una referencia nullable. No hace falta ninguna join-table.

## B. Ownership y cardinalidades

```
CatalogProposal (1)
 ├─ (1..N)  ProposalContribution        [cascade delete lógico = N/A: no se borra el ledger]
 │            └─ (1..N) ProposalClaim
 │                        ├─ (0..N) ClaimEvidenceReference   [cascade con la Claim]
 │                        └─ (0..N) ClaimEvidenceArtifact     [cascade lógico; bytes por política]
 ├─ (0..N)  ProposalInfoRequest          [cascade]
 └─ (0..1)  ResolutionRecord             [cascade; único por proposal]

ProposalSubscription (aggregate aparte): (1) User ── (0..N) ── (1) CatalogProposal   [unique(user,proposal)]
Catálogo (Work/Edition/Volume): referenciado por identidad desde Target y appliedTargetRef; NUNCA contenido.
```

- **Ownership fuerte** (contención, cascade): Proposal→Contribution→Claim→Evidence; Proposal→InfoRequest; Proposal→ResolutionRecord. **Las relaciones internas del BC de contribuciones usan integridad referencial fuerte (FK duras).**
- **Referencias por identidad** (sin contención, acoplamiento débil): Target y appliedTargetRef → Catálogo; relatedProposal → otra Proposal; author/moderator → User; ResolutionRecord → MutationLog (correlationId).
- **Cascade**: se aplica al **grafo interno del aggregate** (si alguna vez se borra una Proposal — ver K, no es lo normal). Subscriptions cascadean con la Proposal.

> **Decisión — referencias cross-BC BLANDAS (sin FK dura).** `Target`, `appliedTargetRef`
> y demás referencias a Work/Edition/Volume **no** llevan FK dura. Persisten: **tipo de
> entidad** referenciada + **identidad** + la **metadata mínima** para interpretar la
> referencia (ej. el título/label capturado al momento, para poder mostrarla aunque el
> destino cambie). La **existencia y coherencia** se validan en el **Application Service**,
> no en la DB.
>
> **Consecuencia explícita (documentada a propósito):** una referencia cross-BC puede
> quedar **históricamente colgada** si la entidad de catálogo referenciada es **removida
> o fusionada** (ej. el Work resultante de una Proposal ACEPTADA luego se fusiona en otro).
> El modelo **debe poder representar ese estado sin destruir el ledger**: la Proposal/
> ResolutionRecord conservan la referencia original (identidad + metadata capturada) como
> **hecho histórico**; el Application Service, al leer, detecta si el destino sigue vivo/
> fue fusionado y lo resuelve en presentación (ej. seguir el redirect de fusión) — pero
> **nunca** reescribe ni borra el registro histórico. La integridad cross-BC es
> **eventual y de aplicación**, no una garantía de la DB.

## C. Matriz Family × Target (invariante de dominio)

| | NuevoSujeto WORK | NuevoSujeto EDITION (bajo Work ref) | NuevoSujeto VOLUME (bajo Edition ref) | Ref WORK | Ref EDITION | Ref VOLUME | Relación estructural |
|---|---|---|---|---|---|---|---|
| **ALTA** | ✅ | ✅ (requiere Work padre existente) | ✅ (requiere Edition padre existente) | ❌ | ❌ | ❌ | ❌ |
| **CORRECCION** | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| **REPORTE** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (DUPLICADO = par WORK↔WORK · MALA_FUSION = un WORK a partir) |

- Combos ✅ válidos; ❌ los **rechaza el dominio**.
- **DB-enforzable** (barato): la combinación `family × targetKind` (un CHECK). **Application-service** (runtime): la **existencia del padre/ref** (que el Work/Edition referenciado exista) y la coherencia de la relación estructural.
- Nota: la **clase de contenido** (manga/cómic) es discriminador estructural del sujeto (autoritativo, inmutable), independiente de esta matriz; participa del preflight (§J) y del guard cross-type.

## D. Estados persistidos y transiciones

**CatalogProposal** — `SUBMITTED ⇄ NEEDS_INFO → { ACEPTADA | RECHAZADA | SUPERSEDED | ABANDONADA }`
- Válidas: SUBMITTED→NEEDS_INFO (al abrir un InfoRequest); NEEDS_INFO→SUBMITTED (al responder); {SUBMITTED,NEEDS_INFO}→cualquier terminal.
- **Inválidas**: terminal→*cualquier cosa* (definitivo); NEEDS_INFO sin InfoRequest ABIERTO; terminal con Claims aún en PROPUESTA.

**ProposalClaim** — resultado `PROPUESTA → { ACEPTADA | NO_USADA | RETIRADA }` + **motivo/rol** (campo aparte)
- Motivo válido por resultado: ACEPTADA∈{procedencia, corroboración}; NO_USADA∈{desplazada, descartada, rechazada}; RETIRADA sin motivo.
- Transiciones: PROPUESTA→terminal **solo** en el evento de resolución; PROPUESTA→RETIRADA por retiro de la Contribution (pre-resolución).
- **Inválidas**: cambiar contenido (atributo/valor/evidencia inmutables); terminal→terminal; ACEPTADA con motivo `rechazada` (combinación prohibida).

**ProposalContribution** — **sin disposición autoritativa**. Persistir: `ABIERTA | RETIRADA` (retiro = acto del autor) + `visibilidad ∈ {VISIBLE, OCULTA, EN_CUARENTENA}` + autor + timestamp.
- La **disposición** (ACEPTADA/PARCIAL/RECHAZADA/NO USADA) **NO se persiste**: se **deriva** de sus claims.
- Inválidas: agregar/retirar sobre una Proposal terminal; editar contenido.

**ClaimEvidenceArtifact** — `EN_CUARENTENA → { DISPONIBLE | BLOQUEADA }`
- DISPONIBLE→BLOQUEADA permitido (el moderador bloquea después). BLOQUEADA es efectivamente terminal (no rehabilita en MVP). Promoción a portada oficial = evento aparte (no cambia el estado; ver F).

**ProposalInfoRequest** — `ABIERTO → ANSWERED`
- Al volverse terminal la Proposal, los ABIERTOS quedan **inertes** (no requieren un estado extra).

**ProposalSubscription** — `ACTIVE → CANCELLED`
- Proposal terminal ⇒ suscripción **inerte** tras la notificación final (sin estado "CONSUMIDA").

## E. Valores heterogéneos de Claims (decisión central)

Alternativas analizadas:

| | Validación | Queries por valor | Auditabilidad | Evolución | Constraints | CandidateView | → Mutation | Riesgo blob |
|---|---|---|---|---|---|---|---|---|
| **A. JSON tipado por `attributeKind`** | app (contrato por kind) | débil (poco necesaria) | alta (valor verbatim) | alta (nuevo kind sin migración) | débil en DB | fácil (1 read, interpreta) | directa (kind→input) | **medio** si no hay contrato |
| **B. columnas polimórficas** | DB por columna | mejor (columna tipada) | ok | media (nuevo tipo = columna) | mejor | media (elegir columna) | ok | bajo primitivos; estructurados igual necesitan JSON |
| **C. tabla por tipo** | fuerte | tipada | ok | pesada (tabla por tipo) | fuerte | **compleja** (N joins/claim) | ok | nulo |
| **D. A + claves promovidas** | app + índices en las pocas que importan | buena donde importa | alta | alta | media | fácil | directa | **bajo** (contrato + promovidas) |

**Recomendación firme: D = JSON tipado por `attributeKind` con contrato de dominio obligatorio, + un set chico de claves derivadas/promovidas indexadas** (ISBN, ids externos fuertes, título-para-normTitle, contentClass) para el preflight/búsqueda.

Razones: el patrón de lectura dominante es "cargar todas las claims de UNA proposal y armar la CandidateView en dominio" → JSON es ideal (una lectura, interpretación en el dominio); las claims son heterogéneas y **evolucionan** (nuevos atributos) → JSON evita migraciones constantes; auditabilidad = valor verbatim; la traducción a Mutation mapea `attributeKind`→input en el borde. **El riesgo de blob se neutraliza con un contrato `attributeKind → esquema de valor` en el DOMINIO, validado al escribir** (es "JSON tipado con contrato", no "JSON libre"). Las pocas queries cross-proposal (dedup/preflight) las cubren las **claves promovidas**, no el JSON.

Se descartan **B** (tabla ancha rala + igual necesita JSON para valores estructurados) y **C** (sobre-normalizado, join-pesado para nuestro patrón de lectura).

> **Contrato (dominio, no persistencia):** cada `attributeKind` (título/tipo/autor/país/idioma/tomos/estado/fecha/ISBN/idExterno/sinopsis/portada/…) fija el esquema de su valor (string, texto localizado `{lang,text}`, número, fecha borrosa, enum, `{provider,id}`, ref a artefacto, etc.). El **conjunto de attributeKinds y sus esquemas** se enumera en la etapa de schema, pero vive como contrato del dominio.

> **Decisión de proceso — `attributeKind` se define ANTES de escribir Prisma.** El
> **primer paso** de la etapa de schema será **enumerar el conjunto mínimo de
> `attributeKind` del MVP**. Para **cada kind** se definirá: su **esquema de valor**, el
> **nivel de Target válido** (Work/Edition/Volume), sus **reglas de validación**, la
> **evidencia exigida**, sus **claves promovidas** y su **traducción a Mutation**. El
> contrato **vive en el dominio y no puede degradarse a JSON libre**. *(La enumeración
> definitiva NO va en este documento: es la primera entrega de la etapa siguiente.)*

## F. Modelo de Evidence

- **Relación con Claim**: `ClaimEvidenceReference` (0..N) y `ClaimEvidenceArtifact` (0..N) son **hijos en ownership** de la Claim.
- **Reutilización vs duplicación**: una referencia (URL/ISBN) que respalda varias claims se **duplica por ownership** (cada claim tiene su fila). Motivo: mantiene "Confianza = función de la evidencia de esa claim" y evita gestión de huérfanos/compartición. El costo (una URL repetida) es despreciable. **No hay evidencia compartida entre claims.**
- **Evitar huérfanos**: como la evidencia **cascadea** desde su claim, nunca queda huérfana; no existe evidencia sin claim.
- **Fuerza de fuente**: campo en `EvidenceReference` (`fuerte | media | débil`), clasificado a partir del tipo de fuente al crearse y **congelado**; alimenta la Confianza.
- **Dominio vs infraestructura**:
  - `EvidenceReference` = **100% dominio** (valor + tipo + fuerza).
  - `EvidenceArtifact` = **dominio**: estado (cuarentena/disponible/bloqueada) + **referencia opaca** al objeto almacenado + **hash**. **Infra**: bytes, escaneo, EXIF-strip, MIME real, URLs firmadas, borrado.
- **Política de retención de uploads (decidida):**
  - cuando un upload es **BLOQUEADO**, **rechazado** o **expira en cuarentena**, sus
    bytes quedan **inaccesibles de inmediato** (no se sirven ni se exponen públicamente);
  - se programa su **eliminación definitiva a los 30 días**;
  - tras el borrado queda **solo un tombstone**: `hash · motivo · fecha de bloqueo/rechazo ·
    fecha de eliminación`;
  - un upload bloqueado **nunca** se conserva públicamente ni se sirve;
  - los **assets promovidos al catálogo** (portadas aprobadas) pasan a **ownership del
    catálogo** y **NO** siguen esta política temporal (viven con el Work, `curated`).
  - La fila del artefacto no se hard-deletea: se marca eliminada y conserva el tombstone.
- **Portada aprobada → asset oficial (sin que la Proposal sea dueña)**: cuando una claim con artefacto de portada es ACEPTADA, **Apply promueve** el artefacto al **almacenamiento oficial del catálogo** (R2, propiedad del catálogo/Work, `curated`). El artefacto de la propuesta guarda una **referencia** al asset oficial resultante (procedencia), pero **el dueño del asset es el catálogo**, no la Proposal. Separación: artefacto-propuesta (fuente, temporal) ↔ portada-oficial (catálogo, permanente).

## G. ResolutionRecord — decisión

Opciones: **A. distribuida** (estados de claims + terminal de Proposal + appliedTargetRef + MutationLog) vs **B. ResolutionRecord inmutable**.

| Criterio | A distribuida | B ResolutionRecord |
|---|---|---|
| Auditabilidad | hay que reconstruir el "acto" | **un registro inmutable del acto** |
| Reconstrucción histórica | join claims+proposal+MutationLog | **directa** |
| Atomicidad | ok (misma tx) | ok + **ancla única** |
| Duplicación | nula | baja **si es fino** (no copia la procedencia) |
| Divergencia | — | nula (record y claims son inmutables post-resolución) |
| Idempotencia | por proposalId | **unique(proposalId) = ancla natural** |
| Reputación futura | computable | **cómodo** (acto+outcome por proposal) |

**Recomendación firme: B — `ResolutionRecord` fino e inmutable, único por Proposal.** Contiene: **moderador/actor** (usuario o `reconcile`/`system`), **timestamp**, **outcome** (ACEPTADA/RECHAZADA/SUPERSEDED/ABANDONADA + supersededReason si aplica), **appliedTargetRef** (Work/Edition/Volume resultante, si hubo mutación), **referencia de mutación** (correlationId → MutationLog), y **resumen de overrides**. La **procedencia por atributo NO se duplica**: es **derivable** de los estados terminales de las claims (qué claim quedó ACEPTADA/procedencia por atributo). Cubre **todos** los cierres (no solo ACEPTADA), así que "cómo terminó esta Proposal" tiene un único registro.

## H. Contrato transaccional

**Atómico (una unidad de trabajo, misma tx — Postgres único):**
1. terminalizar la **Proposal** (estado terminal);
2. terminalizar **todas las Claims** (resultado + motivo);
3. escribir el **ResolutionRecord**;
4. ejecutar la **Mutation** de catálogo (createWork/addEdition/updateField/…);
5. guardar las **referencias** al Work/Edition/Volume resultante (appliedTargetRef).

**Efectos post-commit (fuera de la tx, I/O externo):**
- **Notify** (in-app + push a proponente/aportantes/suscriptores).
- **Promoción de portada** a R2 oficial (subida de bytes) + link del asset oficial — I/O; se hace post-commit y se enlaza (o pre-commit con ref conocida), nunca dentro de la tx DB.

**Reglas:**
- **Si Mutation falla** (dentro de la tx): **rollback total** → Proposal sigue no-terminal, sin ResolutionRecord, sin claims terminalizadas, sin cambio de catálogo. El moderador ve el fallo (drift/validación) → NEEDS_INFO o reintento. **Nunca queda estado parcial.**
- **Si Notify falla** (post-commit): la resolución **queda firme**; Notify se reintenta (idempotente por `(proposal, evento, usuario)`); un fallo de notificación **nunca** revierte la resolución.
- **Idempotencia por proposal**: `unique(proposalId)` en ResolutionRecord ⇒ re-ejecutar Apply es no-op si ya resolvió. **Reintentos seguros**: un reintento tras un rollback re-intenta limpio; un reintento tras commit no duplica.

## I. Concurrencia e idempotencia

| Escenario | Mecanismo |
|---|---|
| Doble submit | **idempotency token** de cliente (dedup); sin unique dura de identidad → peor caso: hermanas (dedup advisory + moderador) |
| Dos moderadores resolviendo la misma Proposal | **optimistic lock** (versión de Proposal) + `unique(proposalId)` en ResolutionRecord → el segundo falla y ve que ya resolvió |
| Contribution mientras se resuelve | append **verifica no-terminal en la tx** (chequeo de estado autoritativo + versión); si la resolución commiteó antes → el append se rechaza |
| Retiro simultáneo | retiro **idempotente** (set once); retiros de contribuciones distintas son independientes (row-level) |
| Reconcile concurrente con moderación | ambos intentan terminalizar; el `unique(proposalId)`/versión deja pasar **uno**; el otro ve terminal y **se saltea** (reconcile es idempotente y conservador) |
| Cron crea la obra durante Apply | lo maneja la **capa catálogo/Mutation** (dedup de `findOrCreateWork` + unique de ids externos + guard cross-type); no es responsabilidad del aggregate de contribuciones |
| Suscripción concurrente con estado terminal | `unique(user,proposal)`; si la Proposal ya es terminal, la suscripción nace **inerte** (best-effort en la notificación final) |

**Invariantes de concurrencia:** append/retiro/resolución **chequean estado autoritativo** de la Proposal en la tx; **optimistic locking** por versión de Proposal; **idempotency keys** (cliente para submit/add; proposalId para Apply); **unique constraints** (ResolutionRecord por proposal; Subscription por user+proposal). **Sin locks pesimistas** para la escala MVP.

> **Decisión — versionado optimista explícito en `CatalogProposal` desde el día uno.**
> Toda operación que muta el aggregate incrementa/valida la versión. Debe proteger, como
> mínimo: **agregar Contribution · retirar Contribution · abrir/cerrar InfoRequest ·
> resolver Proposal · ejecutar Reconcile · cualquier transición terminal.** El versionado
> **no reemplaza** — complementa — a: el **`unique(proposalId)` de ResolutionRecord**, los
> **chequeos de estado dentro de la transacción**, y las **idempotency keys**. (Los tres
> siguen siendo obligatorios; la versión evita el "lost update" entre operaciones
> concurrentes sobre la misma Proposal.)

## J. Constraints e índices conceptuales

| # | Constraint / índice | Tipo | Dónde vive |
|---|---|---|---|
| 1 | `unique(userId, proposalId)` en Subscription | invariante | **DB** |
| 2 | `unique(proposalId)` en ResolutionRecord (una resolución) | invariante | **DB** |
| 3 | idempotency token de submit/add | unique | **DB** |
| 4 | claves promovidas de preflight: índice `(contentClass, normTitle)` + `(status)` en Proposal | perf | **DB** |
| 5 | Claims por proposal/atributo/estado (para CandidateView) | perf | **DB** |
| 6 | Contributions por autor | perf | **DB** |
| 7 | InfoRequests **ABIERTOS** (índice parcial) | perf | **DB** |
| 8 | EvidenceArtifacts **EN_CUARENTENA** (índice parcial, para el worker de escaneo) | perf | **DB** |
| 9 | Proposals por `(status, family)` / target | perf | **DB** |
| 10 | `appliedTargetRef`, `relatedProposalId` | ref | **DB** |
| 11 | `family × targetKind` válido | CHECK | **DB** |
| 12 | motivo válido por resultado de Claim | CHECK o app | DB/app |
| 13 | self-reference (`relatedProposalId ≠ self`) | CHECK | **DB** |
| 14 | ownership FKs + cascade del grafo interno; evidencia-requiere-claim | FK | **DB** |
| 15 | append-only (no editar contenido); resolución atómica; no-append-a-terminal; existencia de padre/ref; ciclos entre related | invariante | **Application/Domain** |

**Regla de oro:** la DB garantiza **unicidad, integridad referencial y combinaciones de enum**; el **application service** garantiza **inmutabilidad, atomicidad de la resolución y reglas que dependen de estado/existencia** (no confiar solo en la DB para esas).

### Preflight (datos persistentes que necesita)
Compara contra: **catálogo** (Work/Edition — strong ids, normTitle, romaji, contentClass, autor) y **proposals pendientes** (por sus **claves promovidas**: normTitle derivado, contentClass autoritativo, autor derivado, ids externos afirmados, target, family). Aclaraciones firmes: **no hay unique dura por normTitle**; **hermanas permitidas**; `relatedProposalId` es **advisory** (nullable); títulos genéricos y cross-type se resuelven con contentClass en la clave + **match conservador**; **falsos negativos preferibles a over-merges** (el preflight **advierte**, no bloquea).

## K. Retención y privacidad

**Borrado / retención (decidido):**
- **Borrar una Proposal = NO hay hard delete del ledger.** El cierre se modela con **estados terminales** (ABANDONADA/RECHAZADA), no con delete. Ledger append-only e inmutable → se conserva para audit.
- **Contributions/Claims**: nunca hard-delete; retiro = **estado**, no borrado.
- **Subscriptions**: no son audit-críticas → pueden hard-deletear al cancelar (o quedar CANCELLED; da igual).
- **Uploads bloqueados/rechazados**: según la **política de retención de uploads** (§F): bytes inaccesibles → eliminados a los 30 días → queda tombstone.
- **Anonimización / GDPR (decidido):** se **conserva el ledger** mostrando al autor como
  **"Otra persona"**. Al anonimizar:
  - se **elimina o desvincula** todo dato personal y se quita la **atribución pública**
    (`userId → token anónimo`);
  - se **conservan Proposal, Contribution y Claim** para audit e integridad histórica;
  - **no** se persiste **email, nombre legal ni datos de auth** en el ledger (viven en el
    aggregate de auth; el ledger solo tuvo `userId`);
  - se **borran los bytes personales** según la política de uploads (§F), tombstones anonimizados.
  - **Casos legales que exijan borrado más agresivo = excepción fuera del flujo ordinario**;
    **no deben deformar el modelo base.**
- **Proposals terminales**: retención indefinida (audit/historia); archivado en frío = preocupación futura por volumen.

**Capas de visibilidad:**
- **Público**: existencia de la propuesta (empty-state de búsqueda), displayTitle, nombre público del proponente, estado, **motivo público**.
- **Visible al autor**: sus propias contribuciones/claims, detalle de NEEDS_INFO, decisión (motivo público).
- **Visible a aportantes**: el outcome de sus propios aportes.
- **Solo moderador**: **nota privada** de decisión, contenido en cuarentena/oculto, el espacio completo de claims, la identidad de actores de moderación.
- **Solo infraestructura**: bytes/keys de artefactos, resultados de escaneo, URLs firmadas, metadata de upload (EXIF removido).

**Qué se persiste para audit/reputación futura:** autor por Contribution; moderador/actor por ResolutionRecord y por actos de moderación; motivos público y privado separados; retiro con timestamp; procedencia por Claim = **derivable** (estados) + ResolutionRecord. **Reputación** = computable de (claims ACEPTADA/rechazada por autor + ResolutionRecords) — **sin store nuevo**.

## L. Riesgos

1. **JSON sin contrato** (blob dump). Mitigación: contrato `attributeKind→esquema` en el dominio, validado al escribir; Prisma **no** debe ser la excusa para relajarlo (§ revisión).
2. **Proyecciones filtrándose como verdad** (Confidence/disposición/normTitle/candidata). Mitigación: solo caches derivadas explícitas y recomputables; nunca autoritativas.
3. **Acoplamiento cross-BC / referencia colgada.** Decidido: **refs blandas** (sin FK
   dura) → desacopla los BCs, pero una referencia puede quedar **colgada** si el destino
   se remueve/fusiona. Mitigación (parte del modelo): se persiste metadata mínima de la
   referencia y el Application Service resuelve el estado del destino en lectura, sin
   tocar el registro histórico (§B).
4. **Divergencia estado Proposal ↔ Claims** si la resolución no es atómica. Mitigación: contrato transaccional (H) + invariante de application service.
5. **Promoción de portada a R2 dentro de la tx** (I/O en transacción). Mitigación: post-commit; la tx es DB pura.
6. **Proposal como grab-bag** si crecen las claves promovidas. Mitigación: si bloatean, moverlas a una **proyección de preflight** separada (derivada).
7. **Sibling proposals explotando** por títulos genéricos. Mitigación: preflight advisory + moderador; nunca unique dura.

## M. Decisiones de negocio (cerradas)

1. **Refs cross-BC → BLANDAS (sin FK dura).** Persisten tipo+identidad+metadata mínima;
   existencia/coherencia en Application Service; integridad interna del BC sí es fuerte.
   Consecuencia documentada: referencia históricamente colgada posible si el destino se
   remueve/fusiona — el ledger **no** se destruye (§B).
2. **Retención de uploads → bloqueado/rechazado/expirado: bytes inaccesibles, eliminación
   a los 30 días, luego tombstone (hash·motivo·fecha bloqueo/rechazo·fecha eliminación);
   nunca se sirve; assets promovidos al catálogo exentos** (§F).
3. **Anonimización → conservar el ledger como "Otra persona"**: quitar PII/atribución
   pública, conservar Proposal/Contribution/Claim, sin email/nombre/auth en el ledger,
   borrar bytes personales; casos legales agresivos = excepción que no deforma el modelo (§K).
4. **`attributeKind` → se define ANTES de Prisma** como primer paso de la etapa de schema
   (contrato en dominio, no JSON libre); enumeración = entrega siguiente, no acá (§E).
5. **Optimistic locking → versión explícita en `CatalogProposal` desde el día uno**;
   protege add/withdraw Contribution, open/close InfoRequest, resolver, Reconcile y toda
   transición terminal; **no** reemplaza el unique de ResolutionRecord, los chequeos de
   estado in-tx ni las idempotency keys (§I).

---

## Revisión adversarial

- **¿El modelo duplica proyecciones?** No. CandidateView, Confidence, Acuerdo, Conflicto, disposición de Contribution y clusters **no** son tablas. `normTitle`/claves promovidas son **caches derivadas** (recomputables, marcadas). La procedencia por atributo **no** se duplica en ResolutionRecord (se deriva de las claims). ✅
- **¿Alguna entidad sobrecargada?** **CatalogProposal** es la que hay que vigilar: acumula identidad + family + target + estado + motivo + **claves promovidas**. Cohesivo hoy, pero si las claves promovidas crecen → moverlas a una proyección de preflight aparte (riesgo #6). Claim (valor JSON + estado + motivo + evidencia) y ResolutionRecord (fino) están bien. ✅ con vigilancia.
- **¿Relaciones que permiten estados imposibles?** Identificados y acotados: Claim `ACEPTADA+rechazada` (CHECK #12); Contribution en Proposal terminal (invariante app #15); Proposal terminal con Claims PROPUESTA (resolución atómica, app); InfoRequest ANSWERED sin contribución que responde (app). La DB sola no basta para varios → **invariantes de application service** explícitas (regla de oro de J).
- **¿Contradice ADR-006?** No. JSON-tipado, ResolutionRecord, claves promovidas, no-hard-delete, contentClass autoritativo — **implementan** el dominio, no lo cambian. ✅
- **¿Riesgo de que Prisma empuje el dominio?** Sí, dos vectores: (a) que el **contrato de `attributeKind`** se degrade a JSON libre porque Prisma no valida la forma → el contrato **debe** vivir y validarse en el dominio; (b) tentación de reificar proyecciones (Confidence/disposición) como columnas/tablas porque "es fácil en Prisma" → prohibido. Mantener el schema **subordinado** a este documento.
- **¿Qué NO debería bajar todavía a persistencia?** La **enumeración final de attributeKinds + sus esquemas de valor** (contrato de dominio, se fija al abrir el schema); el **set exacto de claves promovidas**; la **mecánica de storage/escaneo** de artefactos (infra); el **wiring de notificaciones**; la **fórmula de reputación**. Todo eso queda **por encima** de la persistencia hasta la etapa correspondiente.

**Estado:** modelo de persistencia conceptual **consistente con ADR-006 y el domain model**, sin duplicar proyecciones ni sobrecargar aggregates, con las invariantes correctamente repartidas entre DB y application service. Listo para pasar a **schema** (todavía sin `schema.prisma`) cuando se resuelvan las 5 preguntas de negocio.
