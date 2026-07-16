# ADR-006: Contribuciones comunitarias al catálogo (dominio)

- **Estado**: Accepted (Domain Model) — 2026-07-15. **Alcance: solo dominio.**
  El schema, la persistencia, los endpoints, la UI y el plan de fases se deciden
  DESPUÉS, en documentos aparte.
- **Fecha**: 2026-07-15
- **Relacionado**: ADR-002 (Mutation Framework — la infraestructura de aplicación),
  ADR-004 (Identidad Externa), memoria `crosstype-guard-arc` (guard `sameContentClass`),
  `community-editing`, `data-architecture-redesign`. **Identidad de creadores
  (ADR-005) permanece congelada y este ADR no la toca.**

> **Principio fundacional:**
> *Una Proposal no representa la verdad. Representa evidencia estructurada y
> atribuida sobre una posible verdad — que la moderación resuelve, no la mayoría.*

---

## 1. Problema que queremos resolver

La misión del catálogo es ser **único, limpio y sin duplicados** de lo publicado en
Argentina. Ninguna fuente automática (Ivrea, Whakoom, VIZ, MU/MD) cubre el 100%:
siempre van a existir faltantes, errores y productos que las fuentes no traen — box
sets, ediciones especiales, cómics, editoriales nuevas, portadas, créditos, fechas,
sinopsis, tomos faltantes, series ausentes.

Necesitamos que **la comunidad** pueda proponer altas y correcciones. Pero el
historial reciente mostró que **los errores de dedup y clasificación corrompen
información** (fusiones manga/cómic, splits por idioma). Por lo tanto:

- Esto **no** puede ser edición libre estilo wiki.
- Una contribución **no** puede modificar producción sin moderación.
- El sistema debe **priorizar la prevención de corrupción sobre la velocidad**.
- No todo es automatizable: hay un juicio humano irreductible.

Este ADR define **cómo piensa el sistema** sobre las contribuciones: qué son, qué
garantiza y qué nunca hace. No define cómo se guarda ni cómo se ve.

## 2. Principios del dominio

1. **La Proposal no representa la verdad.** Es un cuerpo de afirmaciones, no un hecho.
2. **Representa evidencia estructurada y atribuida sobre una posible verdad.** Cada
   dato tiene autor y respaldo; nada es anónimo ni sin fundamento.
3. **La moderación resuelve; la mayoría no decide.** La cantidad de personas que
   afirman o apoyan algo **nunca** lo vuelve verdadero ni lo aprueba automáticamente.
4. **El catálogo solo contiene hechos aceptados.** Lo pendiente **no existe** como
   obra: no aparece en el catálogo, no se colecciona, no entra en estadísticas, no
   genera entidad de catálogo, no lo tocan los crons. Regla mental única: *todo lo
   que ves en el catálogo existe.*

## 3. Ubiquitous Language

El vocabulario oficial del sistema. Los términos de UI ("proponer una obra",
"tengo una portada mejor") son **puntos de entrada** que se traducen a estos
conceptos; el dominio piensa en estos, no en "campos".

- **Proposal** — el **aggregate root** que **encapsula la identidad del sujeto** que
  se discute ("esta obra/edición/corrección debería incorporarse"). Esa identidad es
  **propia y opaca** (no derivada de ningún atributo), más **discriminadores
  estructurales** (nivel del Target + clase de contenido manga/cómic), sembrados al
  originarse e **inmutables por las claims**. La Proposal acumula contribuciones y
  custodia esa identidad; **no es** el sujeto ni una obra del catálogo. Nunca escribe
  el catálogo.

- **Familia** — la intención de una Proposal, de tres tipos con comportamiento de
  dominio distinto: **Alta** (traer un sujeto nuevo a existir), **Corrección**
  (completar o corregir atributos de un sujeto existente) y **Reporte** (afirmar un
  problema estructural entre/dentro de entidades existentes: duplicado, mala fusión).

- **Target** — *qué* sujeto: un sujeto nuevo a nivel Obra / Edición / Tomo, una
  referencia a una entidad existente, o una relación estructural. Separa el *qué*
  de la *intención* (Familia).

- **Contribution** — un **envío**: inmutable en su contenido, atribuido a un autor,
  con evidencia, agregado de forma **append-only** a una Proposal. La primera
  contribución **origina** la Proposal (y siembra sus discriminadores); no es
  especial: es solo la primera evidencia. Una contribución contiene una o más claims.

- **Claim (afirmación)** — un par *(atributo, valor)* dentro de una contribución,
  con su evidencia y su **Confianza**. Es la **unidad de conocimiento y la unidad de
  resolución**: lo que el moderador acepta o no es la claim, no la contribución.

- **Confianza** — propiedad **derivada** de una claim a partir de su evidencia
  (Alta / Media / Baja). Es **advisory**: ayuda al moderador, **nunca** resuelve un
  conflicto por sí sola. Es ortogonal a reputación (confianza = qué tan respaldada
  está *esta* afirmación; reputación = quién suele acertar — fuera de este ADR).

- **Acuerdo** — dos o más claims que afirman el **mismo** valor para un atributo
  (corroboración). Es lenguaje del negocio, no una entidad.

- **Conflicto** — dos o más claims con valores **distintos** para el mismo atributo.
  **Coexisten** sin resolverse hasta la moderación.

- **Vista candidata** — la **proyección** de la Proposal: por atributo, su estado
  emergente **asentado** (acuerdo / valor único), **en conflicto** (varios valores)
  o **vacío** (sin claim). Es una **lectura derivada del ledger**, no autoritativa y
  **no editable**; preserva los conflictos, no los aplana.

- **Resolution (Resolución)** — el **pliegue** que el moderador **decide**: por
  atributo, qué claim/valor gana (o un **override**, que es una claim con autoría
  del moderador). Es una decisión interna al cierre de la Proposal. **No** toca el
  catálogo.

- **Apply** — el **domain service** que traduce una Resolución positiva en una
  **Mutación**. Es el **único** que llega al catálogo.

- **Mutation** — la operación de catálogo del Mutation Framework (ADR-002):
  transaccional, auditada, idempotente. Es el **mecanismo** de cambio; vive en el
  bounded context del catálogo, no en el de contribuciones.

- **Subscription (Suscripción)** — interés en una Proposal ("avisame cuando se
  resuelva"). **No** es colección, wishlist ni voto; no aporta datos. Requiere
  cuenta. Su cantidad **nunca** se expone ni influye en la moderación.

## 4. Aggregate: por qué la Proposal es el Aggregate Root

Una Proposal es la frontera natural de **consistencia** de una discusión sobre un
sujeto. Todo lo que debe permanecer coherente junto vive dentro: la identidad del
sujeto, sus discriminadores estructurales, el ledger append-only de contribuciones
y claims, y el estado de moderación/resolución. Nada de eso tiene sentido fuera de
la Proposal, ni se referencia desde afuera salvo por su identidad.

- **Las Contributions son entidades internas**, no aggregates propios: solo existen
  dentro de una Proposal, su ciclo de vida está atado a ella, y sus invariantes
  (no se puede aceptar una claim si la Proposal fue rechazada; nada modifica el
  catálogo mientras está pendiente) son invariantes de la Proposal.
- **Las Claims son value-objects dentro de una contribución** (más su estado de
  resolución, que sí cambia — ver §7).
- **Quedan FUERA del aggregate** (referenciados por identidad, no contenidos):
  - la **Subscription** (aggregate propio, minúsculo): suscribir no afecta la
    validez de la Proposal;
  - el **Catálogo** (Work/Edition/Volume — bounded context existente): la Proposal
    lo referencia por id y lo escribe **solo** vía Mutación;
  - **Apply**, **Reconcile** y **Notify** son **domain services** (orquestan
    entre/sobre aggregates; no son dueños de estado);
  - el **audit** de la aplicación (MutationLog de ADR-002).

Esta partición evita que la Proposal se sobrecargue: no es dueña de las
suscripciones, ni de la escritura del catálogo, ni de la reconciliación, ni de las
notificaciones. Es dueña únicamente de *la evidencia acumulada sobre el sujeto y su
resolución*.

## 5. Invariantes

**De identidad y estructura**
1. La Proposal **encapsula** la identidad del sujeto; esa identidad es opaca y no
   deriva de ningún atributo. La Proposal es el aggregate que la custodia, no el
   sujeto en sí.
2. Los **discriminadores estructurales** (nivel del Target, clase de contenido) se
   siembran al originarse y son **inmutables por las claims**: una claim puede
   enriquecer la descripción (título nativo, romaji, alternativo, autor, fechas)
   pero **no puede cambiar el sujeto**. Manga y cómic con el mismo título son
   **sujetos distintos** (se reusa `sameContentClass`).
3. El `normTitle` que usan búsqueda y dedup es una **clave derivada** de la mejor
   claim de título — **no** es la identidad.

**De acumulación y autoría**
4. Las contribuciones son **append-only**; su **contenido es inmutable**. Nadie
   edita ni sobrescribe la contribución de otra persona. Toda información nueva
   entra como **contribución nueva** (incluida la respuesta a un pedido de
   información del moderador).
5. **Mientras no sea terminal**, una Proposal permanece activa mientras tenga **≥1
   contribución no retirada**; si no queda ninguna, se **abandona**. Un estado terminal
   (ACEPTADA / RECHAZADA / SUPERSEDED / ABANDONADA) es **definitivo**: no vuelve a estar
   activa por conservar contribuciones. El proponente **no** es dueño privilegiado:
   retirar su contribución no borra el trabajo de otros.
6. Todo atributo tiene siempre una **procedencia trazable** hacia una claim (o un
   override). Nunca se aplica un dato sin fuente atribuida.

**De verdad y resolución**
7. **Acuerdo ≠ verdad.** La cantidad de claims o de autores que coinciden es una
   señal, **nunca** una decisión ni una auto-aprobación.
8. Los **conflictos coexisten** hasta que la moderación resuelve; nunca se
   auto-fusionan ni se resuelven por conteo.
9. La **Confianza** de una claim es advisory: **nunca** resuelve un conflicto sola.
10. La unidad de resolución es la **claim**. La resolución de una Proposal es
    **atómica**: no existe una Proposal "parcialmente resuelta" (ver §7).

**De frontera con el catálogo**
11. Una Proposal **pendiente no existe** como obra: no está en el catálogo, no se
    colecciona, no entra en estadísticas, no genera entidad de catálogo, no la tocan
    los crons.
12. La Proposal **nunca escribe el catálogo**. El catálogo solo cambia por una
    **Mutación** ejecutada por **Apply**.
13. Un dato aplicado desde una contribución queda **protegido** (curated): ningún
    cron/enrich lo pisa después.
14. Un **Alta** debe producir una obra **visible**: incluye una edición mínima
    (editorial + país + idioma) o se marca como próxima (`upcoming`); si no, el
    resultado sería una obra invisible.

## 6. Flujo conceptual

```
Proposal ──contiene──▶ Contributions ──contienen──▶ Claims
   │                                                   │
   │  (moderación observa la Vista candidata:          │
   │   por atributo → asentado / conflicto / vacío)    │
   ▼                                                   ▼
Resolution (el moderador elige un pliegue: por atributo, qué claim/valor gana)
   │
   ▼
Apply (domain service: traduce la Resolución en una Mutación)
   │
   ▼
Mutation (Mutation Framework: transacción + audit + idempotencia)
   │
   ▼
Catálogo (Work / Edition / Volume)   ← el único lugar donde hay HECHOS
```

Leído en una frase: **la Proposal acumula contribuciones y claims; la moderación
resuelve un pliegue; Apply lo traduce en una mutación; la mutación produce un hecho
del catálogo.** La Proposal no aplica: **resuelve**.

Tres domain services acompañan el flujo, sin ser parte del aggregate:
- **Apply** — descrito arriba.
- **Reconcile** — si el sujeto **aparece por otra vía** (un cron de import lo crea,
  o se aprueba una Proposal hermana) mientras esta está pendiente, la reconciliación
  la cierra como **SUPERSEDED** con un **match conservador** (reusa `sameContentClass`
  + claves de dedup + autor concordante). Ante ambigüedad **no** auto-cierra: deja
  un aviso al moderador. Los datos aportados aún no reflejados se le muestran como
  posibles correcciones. **Nunca** supersede la Proposal equivocada.
- **Notify** — reacciona a los eventos de dominio (resuelta, rechazada, superseded,
  pide-info) notificando al proponente, a los aportantes y a los suscriptores.

## 7. Qué es append-only y qué no

**Append-only e inmutable (el ledger de hechos):**
- Las **contribuciones**: una vez enviadas, su **contenido** (claims, valores,
  evidencia, autoría, timestamp) **nunca** cambia. Corregir = agregar otra
  contribución.
- Las **claims**: su contenido es inmutable. Una claim nunca se "edita".

**No es append-only (metadata que sí evoluciona, sin tocar el contenido):**
- El **estado de resolución de una claim**: `PROPUESTA → ACEPTADA | NO_USADA |
  RETIRADA`. Es un **resultado**, separado de su **motivo** (una anotación
  explicativa, que puede crecer sin desestabilizar el estado):
  - sobre **ACEPTADA**: rol `procedencia` (la citada) o `corroboración` (afirmó el
    mismo valor ganador — también positiva para su autor);
  - sobre **NO_USADA**: motivo `desplazada` (ganó otro valor), `descartada`
    (quedó como vacío / dejada de lado — **sin** juicio) o `rechazada` (**juzgada
    incorrecta** — la única señal negativa);
  - **RETIRADA**: la quitó su autor antes de la resolución (acto del autor).
  Separar *resultado* de *motivo* mantiene honesto el modelo: **"no usada" no
  significa "incorrecta"**.
- La **disposición de una contribución**: es **derivada** de sus claims (no un
  estado autoritativo, salvo el retiro):
  `ABIERTA` · `RETIRADA` (acto del autor) · `ACEPTADA` (todas sus claims aceptadas)
  · `PARCIALMENTE ACEPTADA` (≥1 aceptada y ≥1 no) · `RECHAZADA` (0 aceptadas y ≥1
  rechazada) · `NO USADA` (0 aceptadas, 0 rechazadas). **"Parcialmente aceptada"**
  = parte de sus datos se volvió hecho del catálogo y parte no; una contribución
  **nunca** se acepta o rechaza como bloque.
- El **estado de la Proposal**: `SUBMITTED ⇄ NEEDS_INFO → { ACEPTADA | RECHAZADA |
  SUPERSEDED | ABANDONADA }`. **La resolución es atómica**: al alcanzar un estado
  terminal, **todas** las claims alcanzan estado terminal en el mismo evento. No
  existe Proposal "a medio resolver"; **"parcial" solo existe a nivel contribución.**
  El terminal positivo se llama **ACEPTADA** (no "aplicada"): aplicar es lo que hace
  Apply/Catálogo, no la Proposal.
- La **visibilidad de una contribución** (metadata de moderación, ortogonal):
  `VISIBLE | OCULTA | EN_CUARENTENA`. Permite manejar PII / contenido ofensivo /
  uploads maliciosos **sin** editar el contenido (respeta append-only).

## 8. Qué cosas son proyecciones

Derivadas, no autoritativas, recomputables, nunca persistidas como fuente de verdad:
- La **Vista candidata** (pliegue del ledger: por atributo asentado/conflicto/vacío).
- Los **Acuerdos** y **Conflictos** (relaciones emergentes entre claims). El
  agrupamiento interno que los detecta —"cluster de valor"— es una **abstracción del
  read model**, **no** parte del vocabulario del negocio.
- La **Confianza** de una claim (función pura de su evidencia inmutable).
- El **`normTitle`** y demás claves de dedup/búsqueda (derivadas de las claims).
- La **disposición** de una contribución (derivada de sus claims).

## 9. Qué cosas son decisiones de moderación

Actos de un moderador (juicio humano irreductible), siempre auditados:
- **Resolver** por atributo: elegir una claim/valor ganador, o hacer un **override**
  (una claim con autoría del moderador; las claims de usuario para ese atributo
  quedan `NO_USADA/desplazada`).
- **Aceptar / no usar / rechazar** claims (fija el estado + motivo).
- **Pedir información** (a la Proposal o a un aportante puntual) → `NEEDS_INFO`; la
  respuesta es una **contribución nueva**.
- **Rechazar** la Proposal (con un motivo **público** breve — nunca las notas
  privadas de moderación).
- **Ocultar / cuarentena** de una contribución (PII/abuso), sin editar su contenido.
- **Confirmar** identidades externas propuestas por usuarios antes de usarlas.
- **Resolver** un Reporte (duplicado → fusión; mala fusión → split) vía la mutación
  correspondiente.

Lo que **no** es una decisión de moderación: nada se decide por **cantidad** (de
claims, de aportantes o de suscriptores).

## 10. Qué queda explícitamente fuera del alcance de este ADR

**Fuera del documento (se deciden después, en su propio momento):**
- Schema / persistencia / Prisma; endpoints y contratos; UI y formularios;
  nombres finales de campos; plan de fases y rollout; métricas; políticas concretas
  de evidencia por atributo, de uploads (formatos/tamaños/retención) y de rate
  limiting. Son **decisiones de diseño e implementación**, no de dominio.

**Excluido del modelo de dominio (decisiones firmes, no omisiones):**
- **Edición directa estilo wiki**: nada modifica el catálogo sin moderación.
- **Votación / mayoría / ranking público**: la cantidad nunca decide.
- **Comentarios públicos / chat / hilos / edición colaborativa en tiempo real**: la
  Proposal es acumulación de evidencia + resolución, **no** una conversación.
- **Auto-aprobación** (por interés, por reputación o por cantidad de aportes).
- **Objetos temporales en colección o wishlist** para obras pendientes.
- **Reputación activa** (el modelo deja el audit preparado para computarla en el
  futuro — propuestas aceptadas, claims aceptadas/rechazadas por autor — pero **no**
  hay puntos ni niveles en este dominio).
- **Identidad de creadores (ADR-005)**: los créditos que aporte la comunidad son
  datos del catálogo, **no** tocan el grafo de identidad, que sigue congelado.

---

## Consecuencias

**Buenas:** el catálogo mantiene una sola regla mental (lo que existe, existe); la
corrupción se previene por diseño (nada se aplica sin moderación, nunca se
auto-fusiona, cross-type imposible); la autoría y la evidencia se preservan de forma
auditable; la infraestructura de aplicación se reusa (Mutation Framework, ADR-002)
en vez de construir una paralela; el modelo soporta múltiples aportantes desde el
día uno aunque la UI los habilite después.

**Malas / costos:** la moderación es un cuello de botella deliberado (juicio humano
irreductible); el modelo tiene más conceptos que un "form de sugerencias" simple
(Proposal/Contribution/Claim/Resolution) — la complejidad se justifica por la
prevención de corrupción, que es el requisito central.

## Alternativas consideradas (y por qué se descartaron)

- **Edición directa (wiki) con historial**: descartada — el historial no previene la
  corrupción en vivo; el catálogo quedaría inconsistente entre ediciones.
- **Una sola entidad `Contribution` que lo abarque todo** (propuesta + aportes +
  moderación + reconcile + aplicación + notificaciones + suscripciones): descartada
  por sobrecarga del aggregate; se partió en Proposal (root) + Subscription (aparte)
  + domain services + Catálogo/Mutation (BC existente).
- **Aprobar/rechazar por contribución**: descartada — pierde información cuando una
  contribución trae datos mixtos; la unidad correcta es la **claim**, con la
  disposición de la contribución **derivada**.
- **Votación / apoyo de la comunidad como criterio**: descartada — viola el
  principio "la mayoría no decide" y habilita brigading.
- **Confianza/estado de claim codificando el motivo**: descartada — mezcla resultado
  con motivo; se separaron en dos dimensiones para estabilidad a largo plazo.

## Relación con la implementación

Este ADR define **únicamente el modelo conceptual del dominio**. Las decisiones de
persistencia (schema), APIs, UI o implementación **no pueden contradecir estas
invariantes**. Si una decisión técnica entra en conflicto con este documento, debe
**adaptarse la implementación, no el modelo**. El schema se diseña **a partir** de
este ADR, nunca al revés.
