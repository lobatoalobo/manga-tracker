# Nakama — Visión de Arquitectura Objetivo (2026–2031)

**North Star Document · Constitución Técnica del Proyecto.**

Este documento no planifica un sprint. Define la dirección técnica de Nakama a cinco años y funciona como **filtro de decisiones**: toda propuesta de arquitectura futura debería poder evaluarse contra esta visión y sus principios inmutables. Si una decisión los contradice, o cambia la decisión, o cambia (con justificación explícita) el documento.

*Documento de visión conceptual. No es un ADR ni un plan de implementación.*

---

## Estatuto de este documento (regla de enmienda)

Este documento es una **constitución técnica**, no un documento vivo que crece continuamente. Se rige por estas reglas:

1. **Permanece estable.** Se modifica **únicamente** cuando existe una razón arquitectónica realmente importante.
2. **Las decisiones se resuelven por ADRs**, no editando esta North Star. Un ADR es el vehículo normal del cambio; esta constitución es el marco que los ADRs deben respetar.
3. **Solo se actualiza si un ADR entra en conflicto con un principio fundamental** de este documento. En ese caso, la tensión se resuelve explícitamente —cambiando el ADR o, con justificación registrada, enmendando esta North Star— **nunca por deriva silenciosa**.

El propósito de esta constitución es ayudar a evaluar decisiones futuras y evitar que el crecimiento del sistema haga perder la visión original.

---

## 0. La tesis central

Nakama es, en su núcleo, **un catálogo soberano de obras publicadas** (manga, cómics, y lo que venga) sobre el cual se construyen experiencias: seguir colección, comprar en preventa, descubrir, compartir. Todo lo demás es periferia.

La tesis que ordena los próximos cinco años es una sola:

> **El catálogo propio de Nakama es la única Source of Truth en runtime. Toda fuente externa es un mecanismo de ingesta, nunca una dependencia de ejecución. Si mañana desaparecen AniList, Whakoom, las APIs de editoriales y todos los archivos, Nakama sigue funcionando sin degradación funcional.**

Hoy esto **no** se cumple: `anilistId` es la llave canónica de unificación de Works, y el runtime todavía depende de identidad prestada de un tercero. El roadmap F2–F5 y la evolución del catálogo son, en el fondo, el proceso de **repatriar la identidad** desde fuentes externas hacia el catálogo propio. Cuando eso termine, la tesis se vuelve verdad estructural, no aspiración.

---

## 1. Arquitectura objetivo — Bounded contexts en madurez

En madurez, Nakama se organiza en **cuatro anillos concéntricos**. El anillo interior es soberano y no conoce a los exteriores; los exteriores dependen hacia adentro. Esta es la propiedad que garantiza la independencia de runtime.

### Anillo 0 — Núcleo soberano (la Source of Truth)
- **Catalog** — Las obras: `Work` (identidad de la obra), `Edition` (edición publicada por una editorial), `Volume` (tomo). Es el corazón. Nadie escribe acá salvo a través de Governance (anillo 2). Todo el resto del sistema **lee** de acá.
- **Identity** — Resolución de identidad de catálogo (`CatalogIdentity` + referencias externas). Responde "¿esta obra de Whakoom y esta de AniList son la misma?" y mantiene el handle propio, estable, independiente de cualquier id externo. En madurez, la identidad de Nakama es **primaria**; los ids externos son meros alias registrados.

> El Anillo 0 no importa **nada** de los anillos 1–3. Esa es la regla que hace al catálogo soberano.

### Anillo 1 — Ingesta (traducción del mundo exterior)
- **Ingestion / Sources** — Un context por naturaleza de fuente, o un context con adapters por fuente. Su única responsabilidad: tomar datos externos (AniList, Whakoom, editoriales, CSV, Excel, APIs futuras, entrada manual) y **normalizarlos a un lenguaje interno común**: propuestas de cambio al catálogo, con su procedencia. **No escribe nunca directo al catálogo.** Su salida es siempre una propuesta para el Anillo 2.

### Anillo 2 — Gobernanza (la única puerta de escritura)
- **Contributions** — La **única** vía por la que un cambio entra al catálogo, venga de un usuario, un admin, un importador automático, un proceso interno o una editorial. Toda mutación del Anillo 0 es una `Proposal` que atraviesa este context.
- **Policy Engine** — El autorizador: dado un actor, una acción y un recurso, decide si el actor **tiene derecho a proponer** ese cambio. Es la primera compuerta; opera sobre *capabilities* (ver §7).
- **Trust Engine** — El decisor de confianza: dada una propuesta **ya autorizada**, con su evidencia y procedencia, decide **autoaceptar / enviar a revisión / rechazar** con reglas determinísticas (ver §8).
- **Provenance** — La memoria: registra origen, fecha, confianza, quién aprobó e historial de **cada dato** del catálogo. Es transversal pero conceptualmente vive en gobernanza porque su razón de ser es la trazabilidad de las escrituras.

### Anillo 3 — Experiencias (lo que el usuario vive)
- **Collection** — Posesión del usuario (el eje que F2–F5 unifica). Lee del catálogo; su verdad es "qué tiene cada persona".
- **Retail** — Preventas y flujo comercial/físico (contadores-as-truth, ledger append-only). Ya es soberano de su dominio.
- **Store** — Tiendas, roles scoped, autorización por recurso.
- **Discovery** — Búsqueda, rankings, novedades, próximos lanzamientos. Puramente lectura del catálogo.
- **Social / Community** — Listas, recomendaciones, notas, moderación comunitaria.
- **Notifications** — Avisos agrupados anti-spam, reediciones, preferencias por serie.

### Relación entre contextos (las reglas de dependencia)
1. **La dependencia siempre apunta hacia adentro.** Anillo 3 → 2 → 1 → 0 para *escribir*; Anillo 3 → 0 para *leer*. Nunca al revés. El catálogo no sabe que existe Retail ni Collection.
2. **El catálogo se lee directo; se escribe solo por Contributions.** Lectura y escritura tienen caminos asimétricos a propósito: leer es barato y ubicuo; escribir es gobernado y raro.
3. **Acoplamiento de datos, no de módulo, entre contextos hermanos.** Como hoy Retail→Collection: se comunican por hechos durables (eventos, snapshots), no por imports cruzados. Esto ya está probado en el código actual y debe conservarse como norma.
4. **Identity es infraestructura del catálogo, no una fuente.** Resolver identidad es una función soberana; no depende de que un tercero esté vivo.

---

## 2. Catálogo — Evolución hacia la única fuente de verdad

### El principio de pertenencia
La pregunta que ordena todo el modelo de datos maduro es: **"¿este dato sobreviviría si la fuente externa desapareciera?"** Si la respuesta es sí, pertenece al catálogo. Si la respuesta es "no, solo existe porque lo dijo Whakoom/AniList", pertenece a la capa de procedencia como *alias* o *enriquecimiento*, no al núcleo.

### Valor vigente vs. conocimiento del catálogo
Una distinción fundamental del catálogo maduro: **"valor vigente" no es lo mismo que "conocimiento del catálogo".**

- **Conocimiento del catálogo:** el conjunto de valores atestiguados para un campo, cada uno con su procedencia. El catálogo *sabe* que AniList afirma un título y Whakoom afirma otro.
- **Valor vigente:** una **elección** de presentación — cuál de esos valores se muestra al usuario hoy. Es una *proyección* sobre el conocimiento, no una destrucción del resto.

El catálogo **elige** un valor vigente para presentar, pero **conserva** los demás valores provenientes de fuentes válidas distintas junto con su procedencia e historial. Elegir un vigente **nunca** implica descartar los otros. Esta distinción es estructural, no cosmética: el Trust Engine mide corroboración ("¿cuántas fuentes coinciden?"), y esa señal es imposible si se descartaron los valores que discrepaban. Preservar el conocimiento multi-fuente es *el insumo* del motor de confianza, no una filosofía aparte. (Ver principio inmutable #14 para el límite de preservación.)

### Qué pertenece **realmente** al catálogo (Source of Truth)
- **La identidad de la obra** (`Work`) con handle propio, estable, sin depender de `anilistId`. — *Esto es exactamente lo que F2–F5 repatria.*
- **La estructura editorial:** qué ediciones existen, de qué editorial, en qué idioma/país, con qué tomos y numeración.
- **Los títulos multi-idioma** como datos propios (no "el título que devuelve AniList hoy"), incluyendo el título original.
- **La identidad de creadores** (autores/mangakas) como entidad propia, no como string repetido — resolviendo homónimos por evidencia, no por título.
- **Las relaciones** obra↔edición↔tomo↔creador, y las correspondencias entre ediciones de una misma obra.
- **Fechas de publicación** cuando son un hecho de la obra (no la fecha que una tienda muestra hoy).

### Qué pertenece **solo** a las fuentes externas (nunca es SoT)
- **Ids externos** (`anilistId`, `whakoomId`, `muId`, `mdId`, `gcdId`): son **alias registrados** en Provenance para poder re-ingestar y reconciliar, no la identidad.
- **Datos volátiles de comercio de terceros:** precios de otras tiendas, stock ajeno, links de lectura de terceros. Pueden cachearse como *enriquecimiento con TTL*, jamás como verdad.
- **Portadas hotlinkeadas:** el catálogo posee sus portadas (en R2). Una URL externa es, a lo sumo, el origen del cual se importó el asset propio.
- **Géneros/sinopsis crudos de un proveedor:** entran como enriquecimiento con procedencia; el catálogo puede tener su propia versión curada que gana como vigente, sin descartar las demás.

### La transición
El catálogo evoluciona de **espejo de terceros** a **original con alias**. Concretamente: primero se le da identidad propia (Identity, F2–F5); luego se le da *contenido propio* (títulos, creadores, portadas, sinopsis curadas), degradando cada campo externo de "verdad" a "origen histórico". El estado final: cada campo del catálogo tiene un valor vigente propio y, colgando de él, el conjunto de valores conocidos con su procedencia, pero el valor ya no necesita a la fuente para existir.

---

## 3. Fuentes externas — Integración por tipo

Todas las fuentes comparten un mismo contrato: **entran por el Anillo 1, se normalizan a propuestas, y pasan por Contributions.** Ninguna escribe directo. Lo que cambia entre ellas es la **confianza**, la **frecuencia** y la **completitud**.

| Fuente | Rol | Naturaleza de ingesta | Confianza típica |
|---|---|---|---|
| **AniList** | Semilla de identidad (histórica) + géneros | Batch, degradándose a alias con el tiempo | Media (identidad), baja (metadata) |
| **Whakoom** | Estructura de ediciones ES, editoriales, portadas | Enriquecimiento, scrapeo local (bloqueado en Vercel) | Media-alta (estructura ES) |
| **Editoriales AR (Ivrea, etc.)** | Única fuente de **próximos/fechas** AR | Cron, respetando rate-limit/IP-ban | Alta para su propio catálogo |
| **Editoriales extranjeras (VIZ, etc.)** | Novedades/próximos de su sello | Adapter por editorial | Alta para su propio catálogo |
| **MU/MD, comics.org (GCD)** | Identidad JP + cómic occidental | Alias externos, track aparte | Media |
| **Excel / CSV** | Carga masiva puntual / editorial | Importador con preview obligatorio | Depende del emisor |
| **APIs futuras / BuscaLibre** | ISBN, artbooks, precio AR | Adapter nuevo bajo el mismo contrato | Variable |
| **Importadores manuales** | Curaduría humana experta | Propuesta directa con evidencia adjunta | Alta (revisor humano) |

### Principios que **cualquier** importador nuevo debe cumplir (el contrato de ingesta)
1. **No escribe al catálogo.** Emite propuestas a Contributions. Sin excepción.
2. **Adjunta procedencia completa** a cada dato: fuente, timestamp, id externo, versión del importador.
3. **Es idempotente y resumible.** Re-ingestar la misma fuente no duplica ni corrompe; un fallo a mitad se reanuda (patrón `dbRetry`/clave estable ya establecido).
4. **Declara su confianza**, no la asume. El Trust Engine decide qué se hace con esa confianza; el importador solo la reporta honestamente.
5. **Normaliza a la identidad de Nakama**, no impone la ajena. Resuelve contra Identity; si no puede resolver sin ambigüedad, **no adivina** — propone con marca de ambigüedad para revisión.
6. **Es un adapter reemplazable.** Si la fuente muere, se apaga el adapter y el catálogo no lo nota. Ninguna otra parte del sistema importa el adapter.
7. **Respeta los límites del proveedor** (rate-limit, IP-ban, ToS): la ingesta corre donde debe correr (cron en Vercel, script local), nunca donde daña al proyecto.

---

## 4. Contributions — La única puerta de entrada al catálogo

Contributions es **el único camino de escritura del Anillo 0**. Toda mutación del catálogo —sin importar quién la origine— es una `Proposal` que atraviesa Contributions. No hay "puerta trasera" de admin, ni de importador, ni de proceso interno. Esto es lo que hace **auditable y reversible** el 100% del catálogo.

### El pipeline de una propuesta (estado maduro)
```
Ingesta / Usuario / Admin / Proceso interno / Editorial
      │  (emite Proposal con evidencia + procedencia)
      ▼
Policy Engine   → ¿el actor está AUTORIZADO a proponer esto sobre este recurso?  (capabilities)
      │            no autorizado → rechazo 403 (nunca llega a Trust)
      ▼
Trust Engine    → ¿hay EVIDENCIA suficiente?  → { Auto-Apply | Review Queue | Reject }
      │
      ▼
Apply idempotente al catálogo  → Provenance registra el resultado
```

Las dos compuertas son **ortogonales**: Policy responde *"¿te corresponde?"* (autorización); Trust responde *"¿alcanza la evidencia?"* (confianza). Una propuesta no autorizada nunca llega a Trust.

### Cómo conviven los actores (todos por la misma puerta, distinta autorización y confianza)

| Actor | Cómo propone | Autorización (Policy) | Tratamiento por defecto (Trust) |
|---|---|---|---|
| **Usuario** | Sugerencia desde la UI | Capacidad de sugerir campos no bloqueados | A revisión salvo cambios triviales de alta evidencia |
| **Administrador** | Propuesta directa | Bundle amplio de capacidades | Alta confianza; los cambios seguros se autoaplican, pero **siempre atraviesa Trust** — Policy no es bypass |
| **Importador automático** | Batch de propuestas con procedencia | Capacidad de `propose`, nunca de `apply` | Trust decide por regla; los seguros se autoaplican, el resto encola |
| **Proceso interno** (dedup, reconciliación) | Propuestas del propio sistema | Capacidades acotadas a su operación | Tratado como un importador más, con su confianza |
| **Editorial** | Feed/planilla oficial | Capacidad acotada al **alcance de su propio sello** | Confianza alta *sobre su propio sello*; autoaplicación acotada a su dominio |

**La clave conceptual:** el admin no es una excepción al sistema, es el actor de **mayor autorización dentro** del sistema — pero incluso un admin autorizado **atraviesa el Trust Engine**. Que todo pase por Contributions —incluido el admin y los procesos internos— es lo que garantiza que cada cambio tenga procedencia, sea trazable y reversible. La conveniencia de "el admin escribe directo" se sacrifica a propósito por la propiedad de que **nada entra al catálogo sin registro**.

Este pipeline reutiliza y generaliza el motor `ApplyCatalogProposal` que ya existe (ADR-007): Draft/Patch/claimOperation/replay/gate — ese motor es el corazón mecánico de esta puerta.

---

## 5. Automatización — Evolución gradual, sin IA

El objetivo no es "todo manual para siempre" ni "todo automático ya", sino un **espectro que se corre hacia la automatización a medida que se acumula evidencia de que es seguro**. Tres bandas:

- **Verde (autoaplicable):** cambios claramente seguros → se aplican solos, quedando registrados y reversibles.
- **Amarillo (a revisión):** cambios con conflicto, ambigüedad o impacto amplio → cola humana.
- **Rojo (nunca automático):** cambios destructivos o de identidad → siempre humano, y algunos con doble confirmación.

### Cómo se decide, sin IA
Solo **reglas determinísticas + evidencia + niveles de confianza**. Nada probabilístico opaco. Una propuesta se evalúa por señales medibles: ¿cuántas fuentes independientes coinciden? ¿la fuente es autoritativa sobre este campo (editorial sobre su propio sello)? ¿el cambio es aditivo o mutativo? ¿toca identidad? ¿hay conflicto con un valor curado por humano? ¿el campo está bloqueado? Cada señal es inspeccionable y explicable en una frase — un humano siempre puede leer *por qué* el motor decidió lo que decidió.

### El corrimiento gradual
La automatización **se gana con historial**. Un tipo de cambio empieza en amarillo (siempre revisado); cuando se acumula evidencia de que los revisores humanos aprueban ~siempre ese patrón sin corrección, se promueve una regla determinística que lo mueve a verde. Nunca al revés como default: la automatización es una recompensa por evidencia acumulada, no un punto de partida. Esto es la política "evidencia antes de abstraer" del proyecto, aplicada a la automatización.

---

## 6. Provenance — Filosofía del origen del dato

**Filosofía, no esquema:** en Nakama maduro, **ningún valor del catálogo es un huérfano**. Todo dato lleva, colgando, la respuesta a: *¿de dónde salió, cuándo, con qué confianza, quién lo aprobó, y qué había antes?*

Qué se guarda, conceptualmente, por cada dato o cambio:
- **Fuente:** qué importador/usuario/proceso lo originó, y el id externo si aplica.
- **Fecha:** cuándo se ingestó y cuándo se aplicó.
- **Confianza:** el nivel declarado por la fuente y el nivel efectivo con que el Trust Engine lo trató.
- **Aprobación:** autoaplicado por regla X, o revisado por humano Y.
- **Historial:** el valor anterior y la cadena de cambios — el catálogo es **append-only en su historia**, aunque el valor vigente se sobreescriba. Se puede reconstruir "qué sabía Nakama sobre esta obra en tal fecha".

**Por qué importa:** la procedencia es lo que hace la soberanía *defendible*. Permite (a) re-ingestar sin miedo (sé qué vino de dónde), (b) revertir con precisión (sé qué cambió y quién lo aprobó), (c) degradar una fuente que resultó mala (puedo encontrar y revisar todo lo que aportó), y (d) auditar disputas ("¿por qué el catálogo dice esto?"). Sin procedencia, un catálogo soberano es solo un pozo de datos sin memoria. Con procedencia, es un registro defendible. El `MutationLog`/`correlationId` actual es el germen de esto.

---

## 7. Policy Engine — Autorización por capabilities

Un **autorizador determinístico** que, dado un actor, una acción y un recurso, decide si el actor **tiene derecho a proponer** ese cambio. Es la **primera compuerta** del pipeline de Contributions, previa al Trust Engine. Su rechazo es un **403** ("no te corresponde"), semánticamente distinto del rechazo del Trust Engine ("no alcanza la evidencia").

### Capabilities como mecanismo (no roles rígidos)
La autorización real **no** se basa en roles rígidos, sino en **capacidades y alcance sobre recursos**. Una capacidad es, conceptualmente, una tripla:

```
(acción, tipo-de-recurso, alcance)
```

y un actor es simplemente **un conjunto de capacidades**. Ejemplos:

- **Editorial** → `{ propose(Edition, scope: sello-propio) }` — puede proponer solo sobre las ediciones de su propio sello, no las de otro.
- **Moderador** → `{ approve(Proposal, scope: dominio-X) }` **sin** `merge(Identity)` — puede aprobar propuestas, pero **nunca** fusionar identidades.
- **Importador** → `{ propose(*, scope: fuente) }` **sin** `apply(*)` — puede crear propuestas, pero jamás escribir directo.
- **Admin** → un bundle amplio de capacidades, **expresado como capacidades**, no como un bypass del sistema.

### Los roles siguen existiendo — como agrupaciones convenientes
Los "roles" no desaparecen: sobreviven como **nombres convenientes para bundles de capacidades** (UX, administración). Pero la **autoridad real** vive en las capacidades, no en el rol. Esto evita la explosión de roles: cuando aparece un actor híbrido ("editorial que además modera cómic occidental"), no se inventa un rol nuevo — se compone su conjunto de capacidades. El modelo de tiendas actual ([lib/domain/store/authorize.ts](../lib/domain/store/authorize.ts)) ya hace autorización *scoped* a un recurso; el Policy Engine generaliza ese patrón probado a todo el catálogo.

### Policy no es bypass
Autorizar a un actor a **proponer** un cambio no lo autoriza a **aplicarlo**. Incluso un admin plenamente autorizado por Policy sigue atravesando el Trust Engine. Policy y Trust son capas distintas y ambas obligatorias: Policy filtra *quién puede proponer qué*; Trust decide *si esa propuesta autorizada tiene evidencia para autoaplicarse*.

---

## 8. Trust Engine — Evaluación de evidencia

Un **decisor determinístico** que, dada una propuesta **ya autorizada por Policy**, con su evidencia y procedencia, emite un veredicto: **auto-aceptar / a revisión / rechazar**, con una razón legible. El Trust Engine **no** evalúa autorización — esa responsabilidad es exclusiva del Policy Engine. Su única función es la confianza.

### Criterios de decisión (señales, todas inspeccionables)
- **Corroboración:** ¿cuántas fuentes independientes afirman lo mismo? (≥2 sube confianza — el principio de evidencia del proyecto). Requiere el conocimiento multi-fuente preservado (§2, principio #14).
- **Autoridad de la fuente sobre el campo:** una editorial es autoritativa sobre su propio sello; AniList no es autoritativo sobre precios AR.
- **Naturaleza del cambio:** aditivo (agregar un tomo faltante) vs mutativo (cambiar un título existente) vs destructivo (borrar/fusionar).
- **Superficie de impacto:** ¿afecta un campo de una obra, o re-identifica y arrastra colecciones/preventas de miles de usuarios?
- **Conflicto:** ¿contradice un valor curado por humano, o un campo bloqueado (`lock`)?
- **Reversibilidad:** ¿se puede deshacer con un DELETE acotado, o requiere restore?

### Tipos de cambio y su banda
**Seguros (candidatos a verde):**
- Agregar un tomo faltante a una edición existente, corroborado.
- Completar un campo vacío (sinopsis ausente → sinopsis de fuente autoritativa).
- Registrar un alias externo nuevo sobre una identidad ya resuelta sin ambigüedad.
- Actualizar una fecha de próximo lanzamiento desde la editorial autoritativa.

**A revisión (amarillo):**
- Cambiar un valor **existente** no vacío.
- Cualquier cosa con ambigüedad de identidad ("esta obra podría ser dos").
- Conflicto entre dos fuentes.
- Cambios que tocan muchos registros a la vez.

**Nunca automáticos (rojo, siempre humano):**
- **Fusionar o partir identidades** (`Work`/`CatalogIdentity`): arrastra colecciones y preventas reales. Es el cambio de mayor blast radius del sistema. Además requiere una capacidad especial en Policy (`merge(Identity)`) — doble llave sobre la operación más peligrosa.
- **Borrar** cualquier entidad del catálogo.
- **Sobrescribir un campo curado por un humano** o bloqueado.
- Cambios sobre datos que anclan dinero (ediciones asociadas a preventas activas).

**Principio rector del motor:** *ante la duda, escala a un humano; nunca inventa; siempre explica.* La confianza para autoaplicar se **gana** con evidencia y con historial de aprobación humana, no se asume. Un motor conservador que encola de más es infinitamente preferible a uno que corrompe el catálogo de forma silenciosa e irreversible.

---

## 9. Roadmap de capacidades — Cuándo entra cada cosa y por qué

El orden **no** es cronológico por gusto: cada capa depende de que la anterior haya vuelto verdad un supuesto. Se construye de adentro hacia afuera del modelo de anillos.

### Fase A — Identidad y colección soberanas (F2–F5) · *ahora*
Repatriar la identidad y unificar el eje de colección. **Por qué primero:** hasta que la identidad sea propia (no `anilistId`) y la colección esté unificada, el catálogo no es soberano — depende de un tercero para saber *qué es cada obra*. Es el prerrequisito de todo lo demás. *(Ya diseñado en el roadmap F2–F5.)*

### Fase B — Estabilización del catálogo · *después de F5*
Convertir cada campo externo de "verdad" en "valor vigente propio con su conocimiento multi-fuente": títulos multi-idioma propios, identidad de creadores, portadas en R2, sinopsis/géneros curados. **Por qué acá:** una vez que la identidad es propia, se le da *contenido* propio. Ahora sí "si desaparecen las fuentes, Nakama funciona" se vuelve literalmente cierto. Cierra la tesis central.

### Fase C — MVP de Preventas · *puede avanzar en paralelo con B*

**Requiere:**
- **F2–F5 completos** (identidad y colección soberanas).
- **Catálogo estable, especialmente el catálogo argentino** (las preventas AR necesitan ediciones AR confiables sobre las cuales operar).

**NO requiere:**
- Contributions como puerta única completamente desarrollada.
- Provenance completa.
- Trust Engine completo.

**Razón técnica de la independencia — aislamiento por snapshots:** Retail se insula del catálogo por su propia disciplina de snapshots. Una preventa **congela** título, precio y referencia de edición en el momento de crearse (los snapshots de Retail ya son inmutables). Entonces, aunque el catálogo siga madurando por detrás, una preventa activa **no se rompe**: no lee el catálogo vivo, lee su propia foto. La gobernanza (Fases D/E) protege *al catálogo como escritura*; **no** es un prerrequisito de *consumir* el catálogo como dato. Por eso Preventas y la evolución del catálogo soberano pueden avanzar de forma relativamente independiente, y Preventas puede arrancar sobre un catálogo *estable pero todavía no soberano-completo* sin riesgo. Retail se acopla al catálogo solo como **dato**, no como módulo.

### Fase D — Catálogo soberano: Contributions como puerta única + Policy Engine · *después de B*
Generalizar Contributions para que **toda** escritura pase por ahí (usuarios, admin, importadores, procesos internos), con Policy Engine (autorización por capabilities) y Provenance completa. **Por qué después de B:** recién cuando el catálogo tiene contenido propio tiene sentido gobernar rigurosamente *quién lo cambia*. Antes, gobernar un espejo de terceros es prematuro.

### Fase E — Automatización (Trust Engine) · *después de D*
Introducir el motor de confianza y correr propuestas por bandas verde/amarillo/rojo. **Por qué al final del núcleo:** la automatización necesita (a) una puerta única por donde interceptar (D), (b) autorización previa que garantice que solo llegan propuestas legítimas (D), (c) procedencia y conocimiento multi-fuente para decidir (B/D), y (d) historial de decisiones humanas para promover reglas a verde. Automatizar antes de tener evidencia acumulada sería exactamente el "automatizar cosas peligrosas" que el proyecto quiere evitar.

### Fase F — Marketplace · *después de C+E*
Ampliar Retail/Store a un marketplace multi-tienda maduro. **Por qué después:** necesita el flujo comercial probado (C) y un catálogo estable y gobernado (B/D) sobre el cual las tiendas listan con confianza.

### Fase G — Comunidad · *transversal, se intensifica al final*
Moderación comunitaria, listas, recomendaciones, edición estilo Whakoom. **Por qué al final (aunque semillas antes):** la edición comunitaria del catálogo **presupone** que Contributions, Policy Engine y Trust Engine existen (D+E) — si no, abrir el catálogo a la comunidad sin gobernanza lo destruiría. La comunidad es la recompensa de haber construido la puerta y los motores primero.

**Regla de oro del roadmap:** *nada que escriba al catálogo se abre a más actores antes de que la gobernanza que lo protege exista.* Ese es el hilo que justifica todo el orden: identidad propia → contenido propio → puerta única + autorización → motor de confianza → apertura (marketplace, comunidad). Preventas es la excepción explícita y justificada: consume el catálogo como dato aislado por snapshots, no lo escribe, y por eso avanza en paralelo.

---

## 10. Principios inmutables

Estos no cambian aunque cambie toda la implementación. Son el criterio para aceptar o rechazar cualquier decisión futura de arquitectura.

1. **Source of Truth única.** El catálogo propio es la única verdad en runtime. Ninguna fuente externa es autoritativa en ejecución.
2. **Independencia de runtime.** Si toda fuente externa desaparece, Nakama funciona sin degradación funcional. Las fuentes son ingesta, jamás dependencia de ejecución.
3. **Puerta única de escritura.** Todo cambio al catálogo pasa por Contributions. No hay puertas traseras — ni admin, ni importador, ni proceso interno.
4. **Trazabilidad total.** Ningún dato del catálogo es huérfano: todo tiene procedencia (fuente, fecha, confianza, aprobación, historial).
5. **Reversibilidad.** Todo cambio se puede deshacer. Lo irreversible (drops, fusiones de identidad) es raro, humano y protegido por runbook/backup.
6. **Idempotencia.** Re-ingestar, reintentar o reproyectar nunca duplica ni corrompe. Toda operación de escritura tiene clave estable.
7. **Automatización basada en evidencia.** Nada se autoaplica sin evidencia y confianza suficientes. La automatización se gana con historial; ante la duda, escala a un humano.
8. **Determinismo y explicabilidad.** Las decisiones del sistema (qué se autoaplica, qué se rechaza) son reglas inspeccionables, no cajas negras. **Sin IA en la ruta de decisión del catálogo.**
9. **La dependencia apunta hacia adentro.** El núcleo soberano no conoce a los anillos exteriores. Ingesta y experiencias dependen del catálogo, nunca al revés.
10. **Acoplamiento de datos, no de módulo, entre contextos.** Los bounded contexts se comunican por hechos durables (eventos, snapshots), no por imports cruzados.
11. **No adivinar.** Ante ambigüedad de identidad o conflicto de datos, el sistema no inventa: propone, marca y escala. Un dato faltante es mejor que un dato inventado.
12. **El historial es append-only.** El valor vigente se sobreescribe; la historia de cómo se llegó a él, nunca.
13. **Autorización y confianza son capas distintas.** El Policy Engine decide *quién puede proponer qué* (autorización por capabilities y alcance sobre recursos, nunca roles rígidos); el Trust Engine decide *si una propuesta autorizada tiene evidencia para autoaplicarse*. Ninguna capa reemplaza a la otra, y la autorización nunca es bypass: todo cambio —incluido el de un admin autorizado— atraviesa ambas.
14. **Preservación del conocimiento multi-fuente.** El catálogo elige un *valor vigente* para presentar, pero conserva el conjunto de valores provenientes de fuentes válidas distintas con su procedencia. Elegir un vigente nunca descarta el conocimiento. Límite: se preserva **una entrada por procedencia válida distinta** — no se conservan infinitas re-ingestas de la misma fuente (las deduplica la idempotencia), ni versiones superadas de la misma fuente (aunque el historial append-only las recuerde).

---

*Esta es la constitución técnica de Nakama. No dice cómo construir el próximo sprint; dice hacia dónde debe apuntar cada sprint. Cuando una decisión de arquitectura futura entre en tensión con estos principios, esa tensión debe resolverse explícitamente —cambiando la decisión o, con justificación registrada, enmendando este documento (ver Estatuto)— nunca por deriva silenciosa.*
