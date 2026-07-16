# Community Contributions — Domain Model conceptual

> **Puente entre [ADR-006](adr/006-community-contributions.md) y el futuro schema.**
> Traduce el dominio congelado a un modelo persistente **sin** pensar en base de
> datos: nada de columnas, tipos, IDs, FKs, índices, Prisma ni SQL. Define, por
> concepto: responsabilidad, identidad, ciclo de vida, qué contiene, qué NO contiene,
> relaciones, ownership e invariantes propias. El schema se diseñará **a partir** de
> este documento, nunca al revés (invariantes de ADR-006 mandan).

## Mapa de contención (ownership)

```
Proposal  (Aggregate Root)
├── Family            (intención — atributo)
├── Target            (value object)
├── estado + resultado de moderación (motivo público, referencias de resolución)
├── InfoRequest[]     (entidades pequeñas, propias)
└── Contribution[]    (entidades)
      ├── autor        → ref a User (por identidad)
      ├── visibilidad  (metadata de moderación)
      └── Claim[]      (entidades — tienen estado de resolución)
            ├── atributo + valor
            ├── estado de resolución  (resultado + motivo)   ← metadata mutable
            ├── Confianza  (derivada)
            ├── EvidenceReference[] (value objects inmutables: URL/ISBN/fuente)
            └── EvidenceArtifact[]  (entidades: imágenes subidas, con ciclo de cuarentena)

Subscription  (Aggregate Root aparte)
└── ref Proposal + ref User

Domain services (sin estado): Apply · Reconcile · Notify
Proyecciones (derivadas, NO autoritativas): Vista candidata · Acuerdo/Conflicto · Confianza(calculada) · normTitle
```

---

## Proposal — *Aggregate Root*

- **Responsabilidad**: encapsular y custodiar la **identidad del sujeto** en discusión,
  acumular la evidencia (contribuciones/claims) y llevar el ciclo de moderación hasta
  una **resolución**. Es la frontera de consistencia de toda la conversación sobre un
  sujeto. **No** es el sujeto ni una obra del catálogo.
- **Identidad**: propia y **opaca** — no deriva de ningún atributo (ni del título).
  Existe desde que la origina la primera contribución.
- **Ciclo de vida**: `SUBMITTED ⇄ NEEDS_INFO → { ACEPTADA | RECHAZADA | SUPERSEDED |
  ABANDONADA }`. Terminal alcanzado de forma **atómica** (todas las claims quedan
  terminales en el mismo evento). No existe estado "parcialmente resuelto".
- **Qué contiene**: la **Familia** (intención), el **Target** (VO), sus **InfoRequests**,
  sus **Contributions** (con sus claims), y su **resultado de moderación** (motivo
  público del rechazo, referencias de resolución: obra resultante, motivo de supersede,
  propuesta relacionada). Los **discriminadores estructurales** (nivel del Target +
  clase de contenido) sembrados al originarse.
- **Qué NO contiene**: entidades del catálogo (las referencia por identidad, no las
  embebe); suscripciones; el mecanismo de escritura; las notas privadas de moderación
  como algo público; ninguna proyección (vista candidata, confianza) como fuente de
  verdad.
- **Relaciones**: contiene Contributions e InfoRequests; referencia al **Catálogo**
  por identidad (Target para Corrección/Reporte; obra resultante al resolver); puede
  referenciar otra Proposal (`relatedProposal`); es referenciada por Subscriptions.
- **Ownership**: dueña de sus Contributions e InfoRequests (cascada: no viven fuera de
  ella).
- **Invariantes propias**:
  1. Identidad opaca; discriminadores estructurales **inmutables por las claims**.
  2. Manga y cómic con el mismo título son **Proposals distintas** (sujetos distintos).
  3. **Mientras no sea terminal**, permanece activa mientras tenga **≥1 Contribution
     no retirada**; si no queda ninguna, se **abandona**. Un estado **terminal**
     (ACEPTADA / RECHAZADA / SUPERSEDED / ABANDONADA) es definitivo: **no** se reactiva
     por conservar contribuciones. El proponente **no** es dueño privilegiado.
  4. Resolución **atómica**: terminal ⇔ todas sus claims terminales.
  5. **Nunca** escribe el catálogo.
  6. Un **Alta** solo puede resolverse en ACEPTADA si el resultado es una obra
     **visible** (edición mínima o `upcoming`).

## Family — *value object (atributo de la Proposal)*

- **Responsabilidad**: nombrar la **intención** de la Proposal: `Alta` | `Corrección` |
  `Reporte`. Determina el comportamiento de dominio (crear identidad / cambiar atributos
  / afirmar problema estructural).
- **Identidad**: ninguna (VO; parte de la Proposal).
- **Ciclo de vida**: inmutable (se fija al originarse).
- **Qué contiene**: solo la intención.
- **Qué NO contiene**: el sujeto (eso es Target), ni datos.
- **Relaciones**: acota qué combinaciones de Target son válidas (ver revisión).
- **Ownership**: Proposal.
- **Invariantes**: inmutable; combinada con el Target debe ser una combinación válida.

## Target — *value object (atributo de la Proposal)*

- **Responsabilidad**: describir **qué sujeto** — un sujeto **nuevo** a nivel Obra /
  Edición / Tomo, una **referencia** a una entidad de catálogo existente, o una
  **relación** estructural (para Reporte: duplicado/mala fusión).
- **Identidad**: ninguna (VO).
- **Ciclo de vida**: inmutable (parte de los discriminadores estructurales).
- **Qué contiene**: el nivel / la referencia al catálogo / la relación estructural.
- **Qué NO contiene**: claims ni valores descriptivos (título, autor, etc. viven en
  claims).
- **Relaciones**: referencia al Catálogo por identidad (para Corrección/Reporte).
- **Ownership**: Proposal.
- **Invariantes**: para Corrección/Reporte, la referencia debe apuntar a una entidad
  existente; para Alta, describe un sujeto nuevo (sin referencia). Inmutable.

## Contribution — *entidad (dentro de Proposal)*

- **Responsabilidad**: representar **un envío** de una persona: un acto atribuido, con
  su(s) claim(s) y evidencia, agregado append-only a la Proposal. Es la unidad de
  **autoría** y de **retiro**.
- **Identidad**: propia, **dentro** de su Proposal (no se referencia desde afuera del
  aggregate).
- **Ciclo de vida**: `ABIERTA → { RETIRADA (acto del autor) | <disposición derivada
  al resolver la Proposal> }`. La **disposición** (ACEPTADA / PARCIALMENTE ACEPTADA /
  RECHAZADA / NO USADA) es **derivada** de sus claims — no un estado autoritativo.
- **Qué contiene**: la referencia a su **autor**, su **timestamp**, su **visibilidad**
  (VISIBLE | OCULTA | EN_CUARENTENA — metadata de moderación), y sus **Claims**.
- **Qué NO contiene**: nunca contenido editable (append-only); no decide su propia
  disposición (se deriva); no contiene la lógica de aplicación.
- **Relaciones**: pertenece a una Proposal; referencia a un User (autor); puede
  responder a un InfoRequest; contiene Claims.
- **Ownership**: Proposal (dueña); a su vez dueña de sus Claims.
- **Invariantes propias**:
  1. **Contenido inmutable**: corregir = **nueva** Contribution, nunca editar.
  2. La **primera** Contribution origina la Proposal y siembra sus discriminadores,
     pero **no es especial**: es la primera evidencia.
  3. El **retiro** (solo su autor, antes de la resolución) cascadea todas sus claims
     abiertas a RETIRADA.
  4. La **visibilidad** cambia sin tocar el contenido (maneja PII/abuso).

## Claim — *entidad (dentro de Contribution)*

- **Responsabilidad**: afirmar un **(atributo, valor)** con su evidencia. Es la
  **unidad de conocimiento y de resolución**: lo que la moderación acepta o no.
- **Identidad**: propia, **dentro** de su Contribution.
- **Ciclo de vida**: **resultado** `PROPUESTA → ACEPTADA | NO_USADA | RETIRADA`, más
  un **motivo** (anotación, no estado): en ACEPTADA `{procedencia | corroboración}`; en
  NO_USADA `{desplazada | descartada | rechazada}`. RETIRADA proviene del retiro de su
  Contribution. El resultado se fija en el evento de resolución de la Proposal.
- **Qué contiene**: el **atributo**, el **valor** propuesto, su evidencia
  (**EvidenceReference**s y/o **EvidenceArtifact**s), y (derivada) su **Confianza**.
- **Qué NO contiene**: no decide sola su resultado (lo fija la moderación); su contenido
  (atributo/valor/evidencia) es **inmutable** — solo cambia su metadata de resolución.
- **Relaciones**: pertenece a una Contribution; su valor puede **acordar** o entrar en
  **conflicto** con otras claims del mismo atributo (relación emergente, no persistida).
- **Ownership**: Contribution (dueña de sus Claims; cada Claim es dueña de sus
  EvidenceReferences y EvidenceArtifacts).
- **Invariantes propias**:
  1. Contenido inmutable; solo el **resultado + motivo** evolucionan.
  2. Separación **resultado ↔ motivo**: "no usada" no implica "incorrecta"; solo
     `rechazada` es señal negativa.
  3. Una claim de un **discriminador estructural** no puede cambiarlo (esas no son
     claims descriptivas válidas dentro de la Proposal).
  4. Al resolverse la Proposal, alcanza un estado **terminal** (no queda colgada).

> **Nota de diseño (resuelve una inconsistencia):** "Evidence" tiene **dos naturalezas
> distintas** — una **referencia verificable** (valor, inmutable, sin ciclo de vida) y
> un **artefacto almacenado** (cosa con identidad y ciclo de moderación). Forzarlas en
> un solo concepto obligaba a un VO a tener ciclo de vida (contradicción). Se separan.

## EvidenceReference — *value object (propio de una Claim)*

- **Responsabilidad**: **sustentar** una claim con una **referencia verificable**: URL,
  ISBN o fuente estructurada (MU/MD/AniList/Whakoom). Alimenta la **Confianza**.
- **Identidad**: **ninguna** — valor puro (dos referencias idénticas son la misma
  evidencia).
- **Ciclo de vida**: **inmutable, sin ciclo**. Si el link muere, es una **observación
  de moderación** (→ NEEDS_INFO), no un cambio de estado sobre la referencia.
- **Qué contiene**: el tipo de fuente, su valor/referencia, y su **fuerza** (fuerte /
  media / débil) según la clasificación del ADR.
- **Qué NO contiene**: identidad, ciclo de vida, ni el juicio de si el dato es verdadero
  (eso es resolución del moderador); no es una claim.
- **Relaciones**: sustenta **una** Claim (una misma fuente que respalde varios atributos
  se representa como referencia en cada claim, preservando "Confianza = función de la
  evidencia de esa claim").
- **Ownership**: Claim (contenida por valor).
- **Invariantes propias**: inmutable; para ciertos atributos (ISBN/fuente/tipo/autor) la
  claim **exige** ≥1 evidencia (referencia o artefacto).

## EvidenceArtifact — *entidad interna (propia de una Claim)*

- **Responsabilidad**: **sustentar** una claim con un **artefacto subido** (imagen). Es
  el caso de uploads aprobados como evidencia (típicamente portadas).
- **Identidad**: **propia** (es un objeto almacenado específico), dentro de su Claim.
- **Ciclo de vida**: `EN_CUARENTENA → { DISPONIBLE | BLOQUEADA }` — un ciclo de
  **moderación de dominio** (una imagen BLOQUEADA no cuenta como evidencia). La
  validación/escaneo/EXIF/URLs firmadas/borrado son **infraestructura** detrás de este
  estado. Si la claim se acepta como **portada**, el artefacto puede **promoverse** al
  almacenamiento oficial (efecto de dominio ejecutado por Apply/infra); en propuestas
  rechazadas/retiradas, se **elimina** según política.
- **Qué contiene**: el estado de moderación, y una referencia opaca a su almacenamiento
  (el **contenido de la imagen es inmutable**; solo cambia su estado — mismo patrón que
  la visibilidad de una Contribution).
- **Qué NO contiene**: la mecánica de storage/escaneo (infra); el juicio de veracidad
  (resolución); no es una claim.
- **Relaciones**: sustenta **una** Claim; alimenta la **Confianza** (presencia y tipo de
  artefacto); su promoción a portada oficial es un efecto que dispara Apply.
- **Ownership**: Claim (cascada: se elimina con la Claim/Proposal según política).
- **Invariantes propias**: **contenido inmutable**, **estado de moderación mutable**; una
  artefacto BLOQUEADO no sustenta la claim ni suma a su Confianza.

## Confidence (Confianza) — *proyección (derivada de la evidencia de una Claim)*

- **Responsabilidad**: dar al moderador una señal `Alta / Media / Baja` de cuán
  respaldada está una claim.
- **Identidad**: ninguna — es una **derivación pura** de la evidencia inmutable de la claim.
- **Ciclo de vida**: no tiene; se **calcula** (recomputable si mejora la heurística).
- **Qué contiene / NO contiene**: es un valor derivado; **no** se persiste como fuente
  de verdad, **no** incluye reputación (quién afirma), **no** resuelve conflictos.
- **Relaciones**: función de la evidencia de una Claim — sus **EvidenceReference**s
  (fuerza de la fuente) y sus **EvidenceArtifact**s DISPONIBLES (presencia/tipo).
- **Ownership**: conceptualmente de la Claim (como lectura), no un dato propio.
- **Invariantes**: **advisory** — nunca decide.

## InfoRequest — *entidad pequeña (propia de la Proposal)*

- **Responsabilidad**: representar un **pedido de información** del moderador, dirigido a
  la Proposal o a un aportante puntual.
- **Identidad**: propia, dentro de su Proposal.
- **Ciclo de vida**: `ABIERTO → ANSWERED` (o queda ABIERTO). La respuesta es una
  **Contribution nueva** ligada al pedido.
- **Qué contiene**: su **alcance** (la Proposal o una Contribution/aportante), la
  referencia a la Contribution que lo responde (si la hay), su estado.
- **Qué NO contiene**: contenido de datos; no es un chat (no hay ida y vuelta libre).
- **Relaciones**: pertenece a la Proposal; puede quedar ligado a la Contribution que lo
  responde.
- **Ownership**: Proposal.
- **Invariantes**: `NEEDS_INFO` de la Proposal ⇔ existe ≥1 InfoRequest ABIERTO;
  responder = agregar Contribution (nunca editar una previa).

## Resolution (Resolución) — *concepto de decisión (registro distribuido)*

- **Responsabilidad**: el **pliegue** que el moderador decide — por atributo, qué
  claim/valor gana, incluidos los **overrides** (claim con autoría del moderador). Es la
  decisión que Apply luego traduce a Mutación.
- **Identidad**: no es una entidad persistente propia (ver revisión). Su **registro**
  vive distribuido: en el **estado de cada claim** (resultado+motivo), en el vínculo a
  la **obra resultante**, y en el **audit** de la Mutación (procedencia por atributo,
  quién resolvió, cuándo).
- **Ciclo de vida**: es un **evento** (ocurre una vez, al cerrar la Proposal); no
  perdura como objeto editable.
- **Qué contiene (conceptualmente)**: por atributo, la claim/valor ganador + su
  procedencia; los overrides del moderador; el actor (moderador) y el momento.
- **Qué NO contiene**: no escribe el catálogo (eso es Apply→Mutation).
- **Relaciones**: se produce **dentro** de la Proposal (cierre); la consume Apply.
- **Ownership**: la Proposal (produce la decisión); el audit (la registra).
- **Invariantes**: por atributo hay **exactamente una** procedencia resuelta; la
  cantidad **no** decide; la resolución es **atómica**.

## CandidateView (Vista candidata) — *proyección (read model)*

- **Responsabilidad**: mostrar el **pliegue actual** del ledger: por atributo,
  `asentado (acuerdo) | en conflicto | vacío`.
- **Identidad / ciclo de vida**: ninguna — **derivada** de las claims, recomputable.
- **Qué contiene / NO contiene**: es una lectura; **no** es autoritativa, **no** es
  editable, **preserva** los conflictos (no los aplana). No se persiste como verdad.
- **Relaciones**: proyección sobre las Claims de la Proposal.
- **Ownership**: el read model (moderación), no el aggregate.
- **Invariantes**: nunca modifica el ledger; nunca resuelve por cuenta propia.

*(**Acuerdo** y **Conflicto** son el lenguaje de negocio para las relaciones entre
claims; el agrupamiento interno que las detecta —"cluster de valor"— es abstracción del
read model, no un concepto persistente.)*

## Subscription — *Aggregate Root aparte*

- **Responsabilidad**: representar el **interés** de un usuario en una Proposal
  ("avisame cuando se resuelva"). No aporta datos.
- **Identidad**: propia (la asociación usuario↔Proposal).
- **Ciclo de vida**: `ACTIVE → CANCELLED` (el usuario se desuscribe). Al terminar la
  Proposal, la suscripción queda **inerte** tras la notificación final (ver revisión:
  no necesita un estado "consumida").
- **Qué contiene**: la referencia a la **Proposal**, la referencia al **User**, su
  timestamp.
- **Qué NO contiene**: **nada** de datos/claims; no es colección, wishlist ni voto.
- **Relaciones**: referencia a Proposal y a User **por identidad** (no las contiene).
- **Ownership**: propia (es la reificación del interés; no es dueña de ninguna de las
  dos entidades que asocia).
- **Invariantes propias**:
  1. **Única** por (usuario, Proposal).
  2. Requiere **cuenta**.
  3. Su **cantidad nunca se expone** ni influye en la moderación.

## Domain services — *sin estado, sin identidad, sin persistencia*

- **Apply**: lee una **Resolución** positiva → construye y ejecuta una **Mutation**
  (Mutation Framework, ADR-002). Es el **único** que llega al catálogo. Idempotente por
  Proposal. No es entidad; es orquestación.
- **Reconcile**: si el sujeto **aparece por otra vía** (import/hermana), cierra la
  Proposal como **SUPERSEDED** con match **conservador** (reusa `sameContentClass` +
  claves de dedup + autor concordante); ante ambigüedad **no** auto-cierra: deja aviso
  al moderador. No es entidad.
- **Notify**: reacciona a los eventos de dominio de la Proposal (resuelta / rechazada /
  supersedida / pide-info) notificando a proponente, aportantes y suscriptores. No es
  entidad (reusa el subsistema de notificaciones existente).

---

## Revisión de consistencia (antes de pasar a persistencia)

Busqué inconsistencias, responsabilidades mezcladas, aggregates mal delimitados y
conceptos redundantes. Hallazgos + recomendación (sin decidir schema):

1. **Disposición de Contribution: derivada, NO autoritativa.** Es el riesgo clásico de
   divergencia (estado de la contribución vs estado de sus claims). **Recomendación:**
   tratarla siempre como **proyección** de las claims; si por performance se materializa,
   debe ser cache derivado explícito, nunca fuente de verdad. Igual criterio para la
   **Confianza** y la **Vista candidata**: el schema **no** debe crear tablas
   autoritativas para proyecciones.

2. **Resolution no es una entidad; su registro está distribuido.** Hoy vive en
   (estado de claims + obra resultante + audit). Eso es correcto, pero deja una pregunta
   para el schema: ¿conviene además **registrar el acto de resolución** (quién resolvió,
   cuándo, el pliegue) como un evento explícito para un audit limpio, o alcanza con
   derivarlo? **Recomendación:** capturar un registro liviano del **acto** de resolución
   (por trazabilidad "quién/cuándo/qué pliegue"), sin que sea un objeto editable. Decisión
   fina = etapa de schema.

3. **Suscripción: el estado "CONSUMIDA" es redundante.** Una suscripción a una Proposal
   ya terminal es simplemente **inerte** tras la notificación final; no necesita un estado
   distinto de ACTIVE/CANCELLED. **Recomendación:** eliminar "CONSUMIDA" del ciclo de
   vida (simplificación; ya reflejado arriba).

4. **Evidence: separada en VO + entidad (inconsistencia resuelta).** Una referencia
   verificable (URL/ISBN/fuente) es un **EvidenceReference** (value object inmutable,
   sin identidad ni ciclo); una imagen subida es un **EvidenceArtifact** (entidad con
   identidad + ciclo de cuarentena/moderación). Ambas son **propias de la Claim** (para
   que la Confianza siga siendo función de la evidencia de esa claim). Esto elimina la
   contradicción previa de "un VO con ciclo de vida".

5. **Family × Target: no son redundantes, pero se correlacionan.** Family (intención) y
   Target (sujeto) son ortogonales, pero **no toda combinación es válida** (ej. `Reporte`
   solo con Target = relación; `Alta` solo con Target = sujeto nuevo). **Recomendación:**
   fijar la **matriz de combinaciones válidas** como invariante de la Proposal (no como
   restricción de datos). No hay redundancia: Corrección puede apuntar a Obra o Edición,
   así que el Target aporta información que la Family no.

6. **Estado de Proposal y estados de Claim deben moverse juntos.** La resolución atómica
   es un invariante de dominio; en persistencia implica que el evento de resolución fije
   Proposal-terminal **y** todas las claims-terminales en la **misma unidad de trabajo**.
   Es una **nota para la frontera transaccional** del schema (no una decisión aún), pero
   el modelo la exige.

7. **Aggregates bien delimitados.** Proposal (con Contributions/Claims/InfoRequests/
   Target) y Subscription son los dos únicos aggregates; Catálogo y Mutation/audit son
   BCs existentes; Apply/Reconcile/Notify son servicios sin estado. **No** se detectó
   sobrecarga: la escritura del catálogo, las suscripciones, la reconciliación y las
   notificaciones están **fuera** de la Proposal.

8. **Sin conceptos redundantes detectados** más allá del estado "CONSUMIDA" (punto 3).
   "Cluster de valor" ya quedó como interno del read model, no como concepto del dominio.

**Estado:** modelo conceptual **consistente** con ADR-006, con tres afinaciones menores
recomendadas (disposición/proyecciones como derivadas; registro del acto de resolución a
decidir; quitar "CONSUMIDA"). Listo para pasar a **diseño de schema** — que deberá
respetar estas responsabilidades, ownerships e invariantes, nunca al revés.
