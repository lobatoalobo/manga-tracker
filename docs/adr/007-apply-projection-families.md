# ADR-007: Familias de proyección del motor Apply (Creation y Mutation)

- **Estado**: Aceptado (especificación oficial; decisiones de instancia de v1 resueltas — ver sección correspondiente).
- **Fecha**: 2026-07.
- **Relacionado**: ADR-002 (Mutation Framework — infraestructura transaccional/auditada), ADR-006 (Community Contributions — moderación ≠ proyección; el catálogo solo cambia por Apply).
- **Ámbito**: el motor **Apply** del bounded context de Community Contributions: el servicio que traduce una resolución positiva de una propuesta en un efecto sobre el catálogo.

---

## Contexto

Apply es el único flujo que escribe el catálogo desde Community Contributions (ADR-006, invariante de frontera). Hasta ahora se implementaron tres verticales de Apply, todos pertenecientes a un mismo patrón: **crear una entidad nueva del catálogo** a partir de las claims aceptadas de una propuesta de Alta. Ese patrón quedó caracterizado por:

- un constructor determinista que arma una entidad **completa** a partir de las claims;
- una deduplicación previa contra las claves de identidad;
- una escritura de tipo **creación**;
- una referencia de aplicación que apunta a una entidad **recién nacida**;
- una operación de claim **implícitamente afirmativa** (se asume que toda claim afirma un valor).

Sobre esa base se estabilizaron y congelaron un conjunto de invariantes transversales: el gate de idempotencia por correlación de mutación, el replay temprano, la lectura compartida de claims, el contrato del registro de resolución, la auditoría sin contenido sensible, la anti-enumeración y la atomicidad transaccional. Ese conjunto se comportó de forma idéntica en los tres verticales, sin depender del tipo de entidad.

Al analizar el primer target que **modifica una entidad existente** (una corrección), se detectó que ese target **no pertenece** al mismo patrón. Corregir no es crear: el sujeto ya existe, la identidad ya está dada, la escritura es un cambio parcial, y las operaciones de claim dejan de ser únicamente afirmativas. Esto obliga a decidir formalmente si Apply tiene **una** familia de comportamiento o **más de una**, y dónde está la frontera entre lo que es común a todo Apply y lo que es específico de cada tipo de efecto.

---

## Problema

1. ¿La modificación de una entidad existente constituye una **familia distinta** dentro de Apply, o es un caso particular de la creación?
2. Si son familias distintas, ¿**dónde** está la frontera arquitectónica que separa lo genérico de lo específico?
3. ¿Qué invariantes del patrón de creación se **heredan**, cuáles **se agregan** y cuáles **dejan de aplicar** al modificar?
4. ¿El patrón de modificación es lo suficientemente **general** para soportar en el futuro cualquier entidad del catálogo sin rediseñarse?

---

## Decisión

Se adopta el siguiente modelo, que se considera la especificación oficial de la arquitectura de Apply:

1. **Apply tiene un único kernel genérico.** El kernel resuelve una propuesta a un efecto de catálogo terminal, gateado, idempotente y auditado, y es **completamente agnóstico** del tipo de entidad y de la familia de efecto.

2. **Existen dos familias de proyección**, y solo dos:
   - **Creation** — traer una entidad nueva a la existencia.
   - **Mutation** — cambiar una entidad que ya existe.

3. **La frontera arquitectónica está exactamente en la línea de dispatch.** Todo lo que ocurre **antes** del dispatch pertenece al kernel y es común a toda familia. Todo lo que ocurre **a partir** del dispatch pertenece a una proyección y es específico de la familia (y de la entidad).

4. **Draft y Patch son conceptos de dominio distintos.** Una proyección de Creation produce un Draft; una proyección de Mutation produce un Patch. No son variantes del mismo objeto.

5. **La proyección es la única responsable** de transformar claims aceptadas en un efecto sobre el catálogo. El kernel no conoce esa transformación: recibe el efecto ya decidido y lo enmarca transaccionalmente.

6. **El gate, el replay, el registro de resolución, la auditoría, la anti-enumeración y la atomicidad permanecen en el kernel**, sin cambio y sin conocimiento de la familia.

Estas seis decisiones quedan aprobadas y no vuelven a discutirse.

---

## Modelo conceptual

Apply se modela como un **kernel único** con un **punto de dispatch** hacia una **proyección** seleccionada por dos ejes ortogonales:

- **Eje de familia**: `{ Creation, Mutation }`.
- **Eje de entidad**: el conjunto de entidades del catálogo susceptibles de Apply.

El cruce de ambos ejes forma una **matriz de proyecciones**. Cada celda de la matriz es una proyección concreta; el kernel es el mismo para toda la matriz. Hoy están pobladas únicamente celdas de la familia Creation; la familia Mutation comienza a poblarse con su primera entidad.

Flujo conceptual:

```
Propuesta resuelta positivamente
        │
   [ KERNEL ]  elegibilidad → gate de idempotencia → (replay temprano) →
        │       intake de claims aceptadas → sobre transaccional
        │
   ── línea de dispatch ──  (frontera arquitectónica)
        │
   [ PROYECCIÓN ]  familia × entidad
        │
   Creation → Draft → escritura de creación → ref de aplicación = entidad creada
   Mutation → Patch → escritura de modificación → ref de aplicación = entidad afectada
        │
   [ KERNEL ]  registro de resolución → resultado → efectos post-commit
```

El kernel entrega a la proyección el conjunto de claims aceptadas y la(s) referencia(s) resueltas, y **registra la referencia de aplicación que la proyección devuelve**, sin interpretar su naturaleza.

---

## Definiciones

- **Kernel de Apply** — la parte genérica e invariante del motor: valida elegibilidad, aplica el gate de idempotencia, ejecuta el replay, reúne las claims aceptadas, enmarca todo en una unidad transaccional, registra la resolución y produce el resultado. No conoce familia ni entidad.

- **Punto de dispatch** — el lugar donde el kernel selecciona la proyección. Es la frontera arquitectónica: separa lo común (arriba) de lo específico (abajo).

- **Proyección** — un mapeo **puro** de `(claims aceptadas + referencia)` a un **efecto de catálogo**. Pertenece a una familia y a una entidad. Es la única responsable de la semántica del cambio.

- **Efecto de catálogo** — el cambio concreto que la proyección produce sobre el catálogo (una creación o una modificación) más la **referencia de aplicación** resultante.

- **Referencia de aplicación** — la identidad de la entidad del catálogo a la que quedó ligada la resolución. En Creation apunta a la entidad **creada**; en Mutation apunta a la entidad **afectada** (preexistente). El gate trata esta referencia de forma agnóstica; su **significado** difiere según la familia.

- **Sujeto del Apply** — la entidad del catálogo sobre la que actúa la proyección. En Creation el sujeto **nace**; en Mutation el sujeto **preexiste** y es indicado por referencia.

---

## Familias de proyección

### Creation
Traer una entidad nueva a la existencia.
- El sujeto no existe antes del Apply; su identidad se **establece**.
- Requiere garantizar que la identidad no colisiona con una entidad existente.
- Produce un **Draft** (entidad completa).
- La referencia externa que acompaña a la propuesta, si la hay, designa un **padre** distinto del sujeto (o no hay referencia).
- Las claims se interpretan como afirmaciones de valor: la creación es intrínsecamente afirmativa.
- Exige que el sujeto nazca **viable**: existe un conjunto de datos mínimos sin los cuales la entidad no puede existir.
- La referencia de aplicación es la entidad **acuñada**.

### Mutation
Cambiar una entidad que ya existe.
- El sujeto **preexiste**; su identidad está dada por la referencia al target.
- No hay deduplicación: no hay nada que "encontrar o crear".
- Produce un **Patch** (cambio parcial).
- La referencia externa designa al **sujeto mismo** (el target), no a un padre.
- Las claims pueden ser afirmativas o **no afirmativas** (cambiar, quitar, marcar): la modificación requiere el vocabulario completo de operación.
- No existe un conjunto de datos mínimos: la entidad ya es viable; un cambio puede tocar un único atributo opcional.
- La referencia de aplicación es la entidad **afectada** (la preexistente).
- Puede **romper** una identidad si el cambio toca un atributo que participa de la identidad; ese es su modo de conflicto característico.

---

## Draft

Un **Draft** es la representación de dominio de una **entidad completa** derivada de las claims aceptadas.

- Es una **función total**: dado el conjunto de claims, produce el estado inicial completo del sujeto.
- Contiene todos los atributos necesarios para que la entidad exista de forma viable, más los que las claims aporten.
- No representa un cambio: representa un **estado inicial**.
- La ausencia de una claim para un atributo opcional significa "sin valor inicial"; la ausencia de una claim para un atributo requerido significa que **el sujeto no es viable** y la proyección debe rechazar.
- Es intrínsecamente afirmativo: no existe la noción de "quitar" un valor que aún no existe.

## Patch

Un **Patch** es la representación de dominio de un **cambio parcial** sobre un sujeto que ya existe. Es un concepto de primera clase, distinto del Draft.

- Es una **función parcial**: describe únicamente la **delta** decidida por la resolución, no un estado completo.
- Contiene **solo** los atributos para los que existe una claim aceptada y materializable. Cada entrada asocia un atributo con una **operación** y, según ésta, un valor.
- **Ausencia de un atributo en el Patch = "no tocar".** El valor actual del sujeto se **preserva**. La ausencia nunca significa borrado.
- **Presencia con valor nulo = "borrar".** El atributo se vacía explícitamente. El nulo nunca significa ausencia.
- La distinción entre **no tocar** y **borrar** es esencial y no debe colapsarse jamás: es la diferencia entre preservar y eliminar información del usuario.
- La forma de cada entrada la determina la **operación** de la claim (ver la sección siguiente).
- Un Patch puede ser **vacío** (ninguna claim materializable presente). Ese caso es legítimo y debe resolverse de forma explícita como una decisión de diseño, sin dejar la resolución en un estado intermedio.

---

## Semántica general de claimOperation

Toda claim porta una **operación** que declara qué se afirma sobre el atributo. La familia Creation puede ignorar la operación porque una propuesta de Alta solo puede afirmar valores. La familia **Mutation debe honrarla**, porque corregir es precisamente cambiar, quitar o marcar.

Vocabulario y semántica:

- **Afirmar un valor** (`SET`) — el atributo toma un valor concreto. Produce escritura del valor. Es la única operación admisible sobre un atributo cuyo modelo físico no admite ausencia (obligatorio): no puede vaciarse.

- **Agregar a un conjunto** (`ADD`) — sumar un elemento a un atributo de cardinalidad *conjunto*. Solo tiene sentido en atributos con múltiples valores coexistentes. Sobre un atributo **escalar** carece de significado propio y **se rechaza** como claim inválida (decisión de v1; ver Decisiones de instancia). Las **identidades externas** no son escalares: se modelan como una **colección indexada por proveedor** (un slot por proveedor). Por eso `ADD` sobre el slot externo de un proveedor se materializa como **afirmación de ese slot** (equivale a `SET`), sin ser el caso escalar rechazado.

- **Quitar** (`REMOVE`) — retirar el valor afirmado (o un elemento de un conjunto). Sobre un atributo que admite ausencia, produce un **vaciado**. Sobre un atributo obligatorio es **inválido**: no puede quitarse un valor requerido.

- **Marcar como desconocido** (`MARK_UNKNOWN`) — afirmar positivamente que el valor del atributo **se desconoce**. Es una aserción de ignorancia, no una ausencia.

- **Marcar como no aplicable** (`MARK_NOT_APPLICABLE`) — afirmar que el atributo **no corresponde** a este sujeto. Es una aserción sobre la naturaleza del sujeto, no una ausencia.

Reglas generales derivadas:

- Toda operación produce **algún** efecto de escritura (un valor o un vaciado); ninguna es un no-op declarativo.
- Las operaciones de quitar y de marcar sobre un atributo **obligatorio** son inválidas y deben rechazarse; nunca deben degradarse a un vaciado imposible ni ignorarse.
- Un cambio que resulta idéntico al estado actual (afirmar el valor vigente, quitar un atributo ya vacío) es una escritura sin efecto observable; el modelo no le asigna un tratamiento especial.

### Sobre "desconocido" vs "no aplicable" (nota explícita, no congelada)

El modelo persistente **actual** materializa tanto "marcar como desconocido" como "marcar como no aplicable" mediante un **mismo vaciado** de la columna correspondiente. Esto es una **limitación del modelo físico vigente**, no una afirmación del dominio.

Queda **explícitamente establecido** que:

- el dominio **no** afirma que "desconocido" y "no aplicable" sean conceptualmente equivalentes;
- son aserciones semánticamente distintas del proponente/moderador;
- el **ledger de contribuciones conserva** esa diferencia de forma íntegra e independiente de cómo se materialice hoy en el catálogo;
- el modelo conceptual de Apply **deja abierta** la posibilidad de materializar ambas operaciones de manera diferenciada en el futuro (mediante una capacidad de modelo que hoy no existe) **sin romper** este ADR: solo cambiaría la proyección física, no la definición de las operaciones ni la frontera kernel/proyección.

En otras palabras: la coincidencia de materialización es un **hecho del modelo físico actual**, revisable; no es una equivalencia de dominio y no debe leerse como tal.

---

## Invariantes heredados (del kernel, comunes a ambas familias)

1. **Una única unidad transaccional.** El efecto de catálogo y el registro de la resolución se confirman juntos; un fallo revierte todo.
2. **Idempotencia por correlación de mutación.** La autoridad de "ya aplicada" es la correlación registrada en la resolución; una segunda ejecución no duplica el efecto.
3. **Replay temprano.** Si la resolución ya está aplicada, el kernel retorna **antes** de cualquier lectura o escritura específica de la proyección; el replay no toca el catálogo.
4. **Gate genérico por refs esperadas.** La forma "aplicada" se valida contra las referencias que la entidad de esa proyección debe producir; cualquier referencia inesperada o incompatible es un estado inconsistente.
5. **Política de proyección cerrada por nivel.** Toda claim aceptada está clasificada explícitamente (se materializa, o se acepta sin materializar); una claim de nivel incompatible o de tipo no clasificado es un error duro; **ninguna claim aceptada se descarta en silencio**.
6. **Registro de resolución mínimo.** Solo se registran la referencia de aplicación y la correlación de mutación; nunca se altera el estado ni la versión de la propuesta.
7. **Auditoría sin contenido sensible.** La traza no incluye valores de claims (títulos, identificadores externos, números, textos).
8. **Anti-enumeración.** La existencia de una propuesta no se revela; los accesos no autorizados o inexistentes producen una respuesta genérica indistinguible.
9. **Frontera de conflicto acotada.** Un conflicto de identidad se traduce a un error de conflicto de catálogo; cualquier otro error del catálogo se propaga y revierte, sin re-clasificarse.
10. **Sin efectos externos dentro de la transacción.** Los efectos fuera de la base (notificaciones, promociones de recursos) son post-commit y no condicionan la atomicidad.

## Invariantes nuevos (propios de la familia Mutation)

1. **Nunca crea entidades.** La familia Mutation solo altera el sujeto referenciado.
2. **Nunca re-parenta.** No cambia el vínculo del sujeto con su entidad contenedora; mover un sujeto de contenedor es una operación estructural ajena a esta familia.
3. **Cambio parcial.** Solo se escriben los atributos con claim materializada presente; el resto del sujeto se **preserva**.
4. **Escrituras tipadas por operación.** El efecto de cada atributo lo determina la operación de su claim (afirmar / quitar / marcar), respetando las reglas del vocabulario.
5. **Referencia de aplicación = sujeto preexistente.** La resolución queda ligada a la entidad afectada, no a una entidad acuñada.
6. **Guard de vaciado sobre atributos obligatorios.** Quitar o marcar un atributo que el modelo físico exige presente es un error duro.
7. **Conflicto por mutación de identidad.** Si el cambio toca un atributo que participa de la identidad y colisiona con otra entidad, es un conflicto de catálogo; el resultado no deja estado parcial.

## Invariantes que dejan de aplicar (respecto de Creation)

1. **Deducción/creación por identidad.** No hay deduplicación previa: el sujeto ya existe y se indica por referencia.
2. **Conjunto de datos mínimos (viabilidad de nacimiento).** El sujeto ya es viable; no existe un requerido para "nacer" ni el error asociado a su ausencia.
3. **Validación de existencia de un padre distinto.** La referencia es el propio sujeto; no hay una entidad contenedora separada que validar como en las Altas.
4. **Invariantes de visibilidad y síntesis de nacimiento.** Las garantías propias de "producir una entidad visible" y los valores sintéticos de creación son concerns de nacimiento, ajenos a la modificación.
5. **Protección por aislamiento de nacimiento.** La estrategia de proteger un dato aplicado aislando la entidad recién creada del resto del ecosistema no está disponible al modificar una entidad compartida (ver Riesgos).

---

## Consecuencias

1. **El kernel queda confirmado como activo estable.** Los futuros verticales, de cualquier familia, no reabren el kernel: se conectan por dispatch. La superficie de cambio de un vertical nuevo queda contenida en su proyección.

2. **La matriz familia × entidad guía la evolución.** Agregar una entidad a una familia es poblar una celda; agregar la familia Mutation es habilitar una fila entera. El costo de cada incorporación es local a la proyección.

3. **La familia Mutation es general.** La forma "cargar el sujeto por referencia → construir un Patch tipado por operación → aplicar el cambio → registrar la entidad afectada" sirve para cualquier entidad del catálogo. La varianza entre entidades es de **datos**, no de rediseño: qué atributos se materializan, cuáles son obligatorios y cuáles participan de la identidad.

4. **La materialización diferenciada de las marcas queda como evolución posible.** Cualquier futura capacidad del modelo para distinguir "desconocido" de "no aplicable" encaja como un cambio de proyección física, sin tocar el modelo conceptual.

5. **La deuda de una política de clasificación compartida se refuerza pero permanece ortogonal.** Con dos familias que comparten el esqueleto de clasificación de claims por nivel, unificar esa maquinaria gana justificación; sigue siendo una decisión separada de la separación de familias, y su tratamiento se evalúa aparte (ver Preguntas abiertas).

6. **El concepto de Patch habilita correcciones ricas a futuro.** Al definir el Patch con operaciones (incluidas las de conjunto), las entidades con atributos de múltiples valores se soportan sin rediseñar la familia, aunque las primeras entidades solo ejerciten atributos escalares.

---

## Riesgos

- **BLOCKER (de decisión, no técnico)** — Habilitar la familia Mutation es un compromiso arquitectónico: el arco venía congelado en solo-creación. La decisión ya se toma en este ADR; el riesgo se traslada a respetar sus invariantes en cada vertical.

- **HIGH — Semántica de operación.** Si la modificación no honra el vocabulario completo de operación, "quitar" y "marcar" se malinterpretan. Es el núcleo de correctitud de la familia y la principal fuente de defectos.

- **HIGH — Sobrescritura accidental (parcial vs total).** Confundir "ausente" con "vacío", o materializar un estado completo en vez de una delta, **pisa datos del usuario**. Es el riesgo de corrección más alto de la familia Mutation.

- **HIGH — Protección del dato aplicado sobre entidades compartidas.** ADR-006 establece que un dato aplicado desde una contribución queda protegido de ser sobrescrito por procesos automáticos. La familia Creation podía honrarlo aislando la entidad nueva; la familia Mutation actúa sobre entidades que otros procesos también poseen, y **no todas** las entidades del catálogo disponen de un mecanismo de protección por atributo. Para esas entidades, esta invariante es hoy **insatisfacible sin evolución del modelo**. Es un riesgo de integridad de datos que debe decidirse por entidad (aceptar sin protección, o habilitar un mecanismo).

- **MEDIUM — Conflicto por mutación de identidad.** Cambiar un atributo de identidad puede colisionar con otra entidad; debe resolverse como conflicto de catálogo sin estado parcial.

- **MEDIUM — Vaciado de atributos obligatorios.** Quitar o marcar un atributo requerido debe ser un error explícito, nunca un vaciado imposible ni un silencio.

- **MEDIUM — Cambio vacío.** Una corrección cuyas claims aceptadas no materializan nada debe resolverse de forma explícita, sin dejar la resolución a medio aplicar.

- **LOW — Colapso de materialización de las marcas.** "Desconocido" y "no aplicable" se materializan hoy igual; el matiz vive en el ledger. Aceptable y explícitamente reversible (ver la nota de la sección de operaciones).

- **LOW — Idempotencia de la modificación.** El gate cubre la doble aplicación; sin el gate, una modificación se re-aplicaría. El gate es autoritativo.

---

## Alternativas descartadas

1. **Proyección única unificada ("crear-o-modificar").** Rechazada: crear y modificar tienen sujeto, identidad, forma de escritura, vocabulario de operación, conjunto de requeridos y superficie de conflicto distintos. Unificarlos obligaría a ramificar internamente en cada vertical, reproduciendo la separación de familias dentro de una cáscara única y perdiendo claridad y auditabilidad.

2. **Modificación fuera de Apply (servicio aparte).** Rechazada: la modificación también es "traducir una resolución positiva en un efecto de catálogo, transaccional, idempotente y auditado". Sacarla de Apply duplicaría el kernel (gate, replay, registro de resolución, auditoría, anti-enumeración) y crearía dos motores con las mismas invariantes.

3. **Diferir la modificación por completo.** Rechazada como decisión permanente: las correcciones son parte del ciclo de vida del catálogo comunitario y no pueden posponerse indefinidamente. Sí se acota el **alcance** de la primera incorporación (ver Alcance).

---

## Preguntas abiertas

1. **Protección del dato aplicado por entidad.** ¿Se acepta que las correcciones sobre entidades sin mecanismo de protección queden expuestas a sobrescritura automática, o se condiciona su habilitación a una evolución del modelo que provea protección por atributo? Debe decidirse por entidad. — **Resuelta para v1** (ver Decisiones de instancia).
2. **Semántica del cambio vacío.** ¿Un Patch vacío es un éxito no-operativo o un error de datos insuficientes? Debe definirse una sola respuesta consistente. — **Resuelta para v1** (ver Decisiones de instancia).
3. **Operación de agregado sobre atributos escalares.** ¿Se trata como afirmación o se rechaza? Debe fijarse antes de la primera entidad con atributos de conjunto. — **Resuelta para v1** (ver Decisiones de instancia).
4. **Unificación de la clasificación de claims por nivel.** Con dos familias compartiendo el esqueleto de clasificación, ¿se consolida en una pieza común? Se evalúa como decisión ortogonal, no forzada por este ADR. — *Abierta.*
5. **Materialización diferenciada de "desconocido" vs "no aplicable".** ¿Cuándo y cómo el modelo físico distinguirá ambas marcas? Queda abierta sin comprometer el modelo conceptual. — *Abierta.*

---

## Decisiones de instancia (v1 — primera incorporación: Mutation × Volume)

Las siguientes decisiones **resuelven para v1** las preguntas abiertas 1–3 en el marco de la primera celda de la familia Mutation. Son decisiones de **instancia**: fijan una respuesta consistente sin alterar el modelo conceptual, la frontera kernel/proyección ni el contrato de resultado del Apply.

1. **Cambio vacío = no-op exitoso.** Un Patch vacío (ninguna claim aceptada materializa un atributo) se resuelve como una aplicación **exitosa sin efecto sobre el sujeto**: no es un error, no deja la resolución a medio aplicar y no rompe el replay. La resolución se registra igual (referencia de aplicación + correlación).

2. **`ADD` sobre atributos escalares = rechazo explícito.** Sobre atributos escalares (número, ISBN, etc.) `ADD` no tiene referente y se rechaza como claim inválida. Las **identidades externas** son la excepción por su modelo de colección indexada por proveedor: `ADD` sobre su slot se materializa como afirmación del slot (ver semántica de operación).

3. **Protección del dato aplicado = limitación conocida de v1.** Para las entidades sin mecanismo de protección por atributo, se **acepta explícitamente** que una corrección quede expuesta a sobrescritura por procesos automáticos. **No se introduce** ningún mecanismo nuevo, columna ni cambio de modelo en v1; la protección por atributo queda diferida (ver Riesgos y Pregunta abierta 1).

4. **`affected` es una estimación conservadora, no un conteo exacto.** El conteo de operaciones que la infraestructura (ADR-002) registra para política y auditoría es un **best-effort**: refleja la forma del efecto (crear/modificar y qué entidades), no el número exacto de sentencias SQL ejecutadas. En el caso del Patch vacío se reporta deliberadamente un update de más (el sujeto y el registro de resolución), aunque físicamente solo se escriba el registro de resolución. Este **over-count es intencional**, cae siempre en la dirección segura para la política, y **no altera el dominio ni el contrato `ApplyOutcome`** (la referencia de aplicación, la correlación y las entidades afectadas siguen siendo exactas). Se prefiere a inyectar detalle operacional de bajo nivel en ese contrato.

---

## Alcance

- **Dentro de este ADR:** la definición del kernel, las dos familias de proyección, la frontera en la línea de dispatch, los conceptos de Draft y Patch, la semántica general del vocabulario de operación, y el conjunto de invariantes por familia.
- **Primera incorporación de la familia Mutation:** una única entidad, elegida como caso de menor fricción, que ejercita solo atributos escalares. Sirve para validar la familia sin arrastrar las capacidades más complejas (atributos de conjunto, protección por atributo).
- **Fuera de alcance de este ADR:** la implementación; los verticales concretos de modificación de las demás entidades; las operaciones estructurales (mover, fusionar, dividir, reportar), que no pertenecen a ninguna de las dos familias de proyección aquí definidas; y la resolución de las preguntas abiertas.

---

## Estado final

Este ADR reemplaza la discusión exploratoria previa y se considera la **especificación oficial** de la arquitectura de Apply para las familias **Creation** y **Mutation**. Las decisiones de su sección **Decisión** quedan congeladas. La implementación futura de cualquier vertical de modificación debe **derivarse** de este modelo: conectar una proyección de la familia Mutation al kernel existente, respetando los invariantes heredados, incorporando los nuevos y no reintroduciendo los que dejan de aplicar. Las **preguntas abiertas** deben resolverse explícitamente antes de, o durante, el diseño del primer vertical concreto, sin alterar el modelo conceptual aquí fijado.
