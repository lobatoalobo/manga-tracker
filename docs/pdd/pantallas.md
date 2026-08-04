# 2 · Pantallas

## Cómo se organiza esta sección

Una **pantalla** es una superficie que el usuario opera. A diferencia de un flujo (una intención con principio y fin), una pantalla puede participar en **varios flujos** y hospedar varias intenciones a la vez. Las vistas de un mismo dato (ej. *Por tomo* / *Por persona*) viven **dentro** de una pantalla, no como flujos.

**La pantalla se especifica antes del mock.** Primero qué hace, qué muestra y qué permite; recién después el diseño visual interactivo. Cuando el mock se valida, puede volver a afinarse la ficha del flujo correspondiente — por eso algunas fichas de Flujos (F-COM-04, F-COM-05) se dejaron a la espera de su pantalla.

IDs: `P-01`, `P-02`…

## Plantilla de ficha de pantalla

- **ID · Nombre**
- **Objetivo** — para qué existe la pantalla.
- **Qué pregunta responde** — la/s pregunta/s del usuario que resuelve.
- **Quién la usa**.
- **Flujos que participan** — referencias a F-COM / F-CLI / F-SYS.
- **Componentes principales**.
- **Información que muestra**.
- **Acciones que permite**.
- **Estados posibles**.
- **Casos borde**.
- **Vacíos detectados**.

## Inventario (Mapa de pantallas canónico)

Derivado de los 8 User Flows. Una pantalla puede sostener varios pasos, casos de uso y flujos. El número del ID refleja **cuándo se definió** cada pantalla (P-01/P-02 preexistían), no un orden de recorrido.

| ID | Pantalla | Actor | Propósito | User Flows | Casos de uso | Estado |
|----|----------|-------|-----------|-----------|--------------|--------|
| **P-01** | Preventa Viva | Comerciante | Seguir la preventa abierta y encaminar cuánto pedir | UF-M2 | F-COM-04 (+ previsión de F-COM-05) | ✅ mock v1 |
| **P-02** | Definir cantidades | Comerciante | Cerrar la preventa y fijar las cantidades finales | UF-M5 | F-COM-05 | ✅ mock v1 |
| **P-03** | Estudio | Comerciante | Armar la edición (novedades + portada) y publicarla | UF-M1 | F-COM-01, F-COM-02, F-COM-03 | ✅ mock v1 |
| **P-04** | Página pública de la edición | Persona | Mostrar la edición publicada para recorrerla y reservar | UF-C1, UF-C2 | F-CLI-01, F-CLI-02 *(gesto)* | ✅ mock v2 |
| **P-05** | Reserva · captura y confirmación | Persona | Revisar el pedido, dejar contacto y hacer el pedido (nace la promesa) | UF-C2 | F-CLI-02 | ✅ mock v1 |
| **P-06** | Vista pública de la reserva | Persona | Consultar y gestionar una reserva existente, sin cuenta | UF-C3 | F-CLI-03, F-CLI-04 | ✅ v1 |
| **P-07** | Workspace · Preparación | Comerciante | Apartar por persona las promesas cumplibles y detectar faltantes | UF-M3 | F-COM-06 | ✅ v1 |
| **P-08** | Workspace · Entrega | Comerciante | Cerrar promesas al retirar (cobro + entrega) | UF-M4 | F-COM-07 | 🟡 spec |

**Notas de superficie (no son pantallas aparte):**
- **P-03 Estudio** tiene dos zonas internas —*orden de trabajo* (cargar novedades) y *orden editorial* (portada en miniatura)— más el alta de un tomo fuera de catálogo. Son zonas de una misma pantalla, no pantallas separadas.
- **P-05** probablemente se presenta como capa *inline/modal* sobre **P-04** (no una página aparte); se decide al diseñarla. Consolida lo que en los recorridos aparecía como "captura de identidad" + "confirmación".
- El caso de uso **F-CLI-02** (reservar) abarca dos pantallas: el gesto de elegir el tomo ocurre en **P-04** y la captura + confirmación en **P-05**.

> **Regla de trabajo (ago 2026):** cuando una pantalla llega a "suficientemente buena" se **congela como v1** y se sigue con la siguiente. Se reabre solo si (a) aparece una contradicción con otro flujo, (b) se descubre un problema real al diseñar otra pantalla, o (c) el feedback de Agustín demuestra que algo importante no funciona. Fase de **construcción**, no de descubrimiento: mejor diez pantallas v1 conectadas que tres perfectas. El refinamiento fino se hace en una segunda pasada, sobre el conjunto.

---

## Fichas

### P-01 · Preventa Viva  ·  ✅ v1 congelada

*Mock navegable: `preventa-viva.html`. Alcance v1: solo preventa **abierta** durante la semana (fuera: cierre, transición a preparación).*

**Objetivo**
Que el comerciante siga y trabaje su edición **mientras la preventa está abierta**: sentir cómo viene la semana y decidir progresivamente cuánto va a pedir, hasta cerrarla.

**Qué pregunta responde**
Dos preguntas que conviven en una sola superficie (decisión de diseño: *una decisión que empieza como previsión y termina confirmándose*, sin cambiar de pantalla):
- *¿Cómo viene mi preventa?* → F-COM-04 (Monitorear).
- *¿Cuánto voy a pedir?* → F-COM-05 (Definir cantidades).

**Quién la usa**
El **comerciante**. Es una pantalla privada: la comunidad ve la Página pública, no esta. La respiración de la edición es privada del comerciante.

**Flujos que participan**
- **F-COM-04 · Monitorear** y **F-COM-05 · Definir cantidades** (las que esta pantalla existe para descubrir).
- Refleja **F-CLI-02** (reservas que entran) y **F-CLI-04** (bajas).
- Desemboca en el **cierre** (evento) → **F-COM-06** (Preparar).

**Componentes principales**
1. **Identidad de la edición** — número (#81), semana, estado *En preventa*, y la **fecha de cierre** como ancla temporal.
2. **Renglón de orientación** — una única línea sintética del estado de la semana (no un dashboard). Orienta "¿cómo viene?" antes del detalle.
3. **La edición (las tapas)** — la misma composición (portada + lista) que el comerciante compuso, ahora **cargando su demanda**: cada tomo muestra su demanda como **cifra**. Las reservas se **acumulan** sobre las tapas; una que entra se atestigua con movimiento mínimo, **nunca como notificación / bandeja de entrada**. La tapa sigue siendo protagonista.
4. **Lente operativa** — dos vistas del mismo dato, con drill-down entre ambas:
   - **Por tomo** (default) — cada tomo con su evidencia (reservados; pagos según el modo de la preventa) y **"A pedir"**: campo editable que **empieza vacío** ([D-003](decisiones-congeladas.md)) y madura durante la semana. El sistema solo **suma** ("Vas a pedir N ejemplares · definiste X de Y tomos"), nunca sugiere.
   - **Por persona** (pivote) — cada persona con sus tomos, total, estado de pago y contacto.
5. **Acción de cierre** — "Cerrar la preventa y armar el pedido", anclada a la fecha de cierre.

**Información que muestra**
Identidad y fecha de cierre · demanda por tomo (cifra) · evidencia de pago según el modo de la preventa · total de "A pedir" y cuántos tomos ya se definieron · por persona: su pedido, total, estado de pago y contacto. **No** muestra contadores de reserva "sociales" (eso es la pública, [D-012](decisiones-congeladas.md)); acá la demanda es dato operativo, no persuasión.

**Acciones que permite**
- Editar **"A pedir"** por tomo (previsión que madura).
- Cambiar de lente (Por tomo ↔ Por persona).
- Drill-down a la gente de un tomo ("ver gente").
- **Cerrar la preventa y armar el pedido**.

**Estados posibles**
- *En preventa · abierta* — estado normal: entran reservas, "A pedir" madura.
- *Recién publicada · sin reservas* — viva pero sin huellas todavía.
- *Próxima a cerrar* — cerca de la fecha de cierre.
- *Cerrada* — "A pedir" queda firme; el testigo pasa a preparación (F-COM-06).

**Casos borde**
- **Sin reservas aún** — la edición está viva pero vacía; no debe verse "rota" ni reprochar la falta de actividad.
- **Una baja** (F-CLI-04) — la demanda de un tomo baja; se refleja sin drama.
- **Modo de pago de la preventa** — las columnas de evidencia se adaptan: *con seña / sin seña* · *pagados / pendientes* · *solo reservados* (sin inventar un estado de pago que no existe).
- **Edición todavía editable** — [D-009](decisiones-congeladas.md) la deja viva; una corrección menor (precio, typo) es posible durante la preventa (ver Vacíos: desde dónde).

**Vacíos detectados**
1. **Fecha de cierre** *(el recurrente de todo el PDD)* — ¿se muestra como cuenta regresiva? ¿se define aquí si no se definió al crear/publicar? Es el ancla del ritmo de esta pantalla y de F-SYS-02.
2. **Semántica del cierre** — al "cerrar y armar el pedido": ¿"A pedir" se **congela**? ¿es reversible? ¿qué pasa si entra una reserva después? Define el borde entre esta pantalla y F-COM-06.
3. **Unidad de la demanda vs "A pedir"** — la cifra por tomo cuenta *ejemplares reservados*; "A pedir" puede ser mayor (stock). Mostrar la diferencia con claridad **sin** que se lea como sugerencia ([D-003](decisiones-congeladas.md)).
4. **¿Corregir la edición desde aquí o desde el Estudio?** — dónde vive la edición de contenido tras publicar.
5. **Transición al cierre** — ¿Preventa Viva se **transforma** en la superficie de preparación (F-COM-06), o son pantallas distintas? Decide si el Workspace es una pantalla que cambia de fase o varias encadenadas. *(Resuelto por el mapa de pantallas: son distintas — P-01 · P-02 · P-07.)*

---

### P-02 · Definir cantidades  ·  ✅ v1 congelada

*Mock navegable: `preventa-cierre.html`. Ajustes finos de visual/interacción diferidos a implementación.*

*Actor: Comerciante · User Flow: [UF-M5](flujos.md) · Caso de uso: [F-COM-05](casos-de-uso.md)*

> **Pregunta única que responde:** *¿Con cuánto voy a cerrar esta preventa?* Todo lo demás en la pantalla existe para ayudar a responderla.

**Objetivo de la pantalla**
Que el comerciante revise su previsión de cantidades frente a la demanda final, la confirme y cierre la preventa. Termina con la **preventa cerrada** y las **cantidades finales fijadas**. No incluye el pedido al distribuidor: el abastecimiento ocurre fuera de Nakama.

**Cambio de foco respecto de P-01**
En P-01 la pregunta es *¿cómo viene la preventa?*: la evidencia (reservados, señas) sostiene la decisión. En P-02 la pregunta es *¿con cuánto cierro?*: **la decisión manda y la evidencia la acompaña**. Mismo objeto, mismos datos, distinta jerarquía visual — el orden se invierte:
- P-01: `Reservados · Señas · A pedir`
- P-02: `A pedir · Reservados · Señas`

**Momento del flujo**
UF-M5, al llegar la fecha de cierre (o por cierre anticipado). Viene de **P-01 · Preventa Viva**, donde "A pedir" maduró durante toda la semana. Le sigue, cuando llega la mercadería, **P-07 · Workspace · Preparación**.

**Información visible**
- Identidad de la edición (#N) y que está por cerrar.
- **Por tomo** (foco Por tomo, la decisión de cierre es por tomo):
  - la **demanda final** (ejemplares reservados);
  - el valor **"A pedir"** que el comerciante venía definiendo en P-01 —su propio número, editable por última vez; **no es una sugerencia de Nakama** ([D-003](decisiones-congeladas.md)).
- **Total a pedir:** N ejemplares · X de Y tomos con cantidad definida.
- No muestra la vista Por persona: no es necesaria para decidir cuánto pedir.

**Acciones posibles**
- **Ajustar "A pedir"** por tomo (último afinado antes de fijar).
- **Cerrar la preventa y fijar las cantidades** (el acto de cierre).
- Volver a P-01 sin cerrar, si todavía no es el momento.

**Estados**
- Edición: *Preventa abierta* → *Preventa cerrada* (al confirmar el cierre); reversible con *Reabrir preventa* ([D-015](decisiones-congeladas.md)).
- "A pedir" por tomo: *"—"* (no decidido) · *número* (decidido, incluido **0** = "no pedir ninguno") · al cerrar, *confirmado*.
- El cierre está **bloqueado** mientras exista algún "—" ([D-016](decisiones-congeladas.md)).

**Acciones posibles** *(actualiza la lista de arriba)*
- Ajustar "A pedir" por tomo (0 es una respuesta válida; "—" no).
- **Cerrar la preventa** — habilitada solo cuando no queda ningún "—".
- **Reabrir la preventa** — acción administrativa desde el estado cerrado, sin dramatización.

**Casos alternativos**
- **CA-1 · Cierre anticipado** — el comerciante cierra antes de la fecha; es el mismo acto de cierre.
- **CA-2 · Queda un "—" al intentar cerrar** — el cierre se impide y la pantalla indica cuántos tomos faltan definir ([D-016](decisiones-congeladas.md)), igual que el bloqueo por precio de F-COM-03.
- **CA-3 · Ajuste de último momento** — cambia una cantidad y luego cierra; el valor confirmado es el último cargado.
- **CA-4 · Reabrir** — tras cerrar, reabre la preventa; nada se pierde, vuelve al estado editable.

**Vacíos detectados**
Ninguno nuevo. Las dos decisiones que esta pantalla destapó se congelaron en [D-015 (reabrir) y D-016 (bloqueo por "—")](decisiones-congeladas.md).

*(La **fecha de cierre** —cuándo y cómo se fija— es el disparador de esta pantalla y sigue siendo el vacío transversal abierto del PDD; se resuelve a nivel documento, no en esta ficha.)*

---

### P-03 · Estudio  ·  ✅ v1 congelada

*Mock navegable: `estudio.html`. TODOs de implementación: aire del panel con muchas destacadas · highlight lista↔portada más sutil · autocomplete en alta manual.*

*Actor: Comerciante · User Flow: [UF-M1](flujos.md) · Casos de uso: [F-COM-01](casos-de-uso.md) · [F-COM-02](casos-de-uso.md) · [F-COM-03](casos-de-uso.md)*

> **Qué resuelve:** *¿Qué sale esta semana, cómo lo presento y cuándo lo abro?* Es donde **nace el Drop**: armar la lista, componer la portada y publicar.

**Objetivo de la pantalla**
Que el comerciante arme la edición de la semana —cargar las novedades y, si quiere, componer la portada— y la publique, abriendo la preventa a su comunidad.

**Momento del flujo**
Punto de entrada del ciclo semanal. La edición ya lo espera cada lunes ([D-005](decisiones-congeladas.md)); el recorrido puede ocurrir en varias sesiones. Al **publicar**, habilita la **P-04** (lado del cliente) y **P-01 Preventa Viva** (lado del comerciante).

**Dos zonas (diseño editorial congelado)**
- **Orden de trabajo** — la lista de novedades: cargar rápido, novedades sugeridas, precio recordado.
- **Orden editorial** — la portada en miniatura, editable en vivo (llevar a portada, elegir principal). **Independiente** del orden de carga ([D-007](decisiones-congeladas.md)).

**Información visible**
- Identidad: edición #N, semana, estado *En preparación*.
- **Zona orden de trabajo:** la lista de tomos cargados (tapa, título, autor, precio); **novedades sugeridas** por el sistema ([SYS-01](automatizaciones.md)) para sumar de un toque; marca de **tomos sin precio**.
- **Zona orden editorial:** la portada en miniatura tal como la verá la comunidad (principal + secundarias), reflejo en vivo de la composición.
- **Estado de publicación:** qué falta para poder publicar (p. ej. "faltan 2 precios").

**Acciones posibles**
- Agregar una novedad (desde sugeridas o alta manual, incluido un tomo fuera de catálogo).
- Poner / editar el precio de un tomo.
- Quitar un tomo de la lista.
- **Llevar a portada** / bajar de portada / elegir principal (el primer tomo a portada se vuelve principal solo, [D-008](decisiones-congeladas.md)).
- **Publicar** — abre la preventa; **bloqueada** si faltan precios o no hay ningún tomo ([D-004](decisiones-congeladas.md)).

**Estados**
- Edición: *En preparación* (único estado de esta pantalla) → al publicar pasa a *En preventa* y el testigo va a P-01.
- Por tomo: *sugerido* / *agregado* · *con precio* / *sin precio* · *en lista* / *en portada* / *principal*.
- Portada: *vacía* (válida, [D-006](decisiones-congeladas.md)) / *con ≥1 tomo* (siempre exactamente una principal, [D-008](decisiones-congeladas.md)).

**Casos alternativos**
- **CA-1 · Semana sin sugeridas** — la fuente no trajo novedades; el comerciante arma 100% manual.
- **CA-2 · Tomo fuera de catálogo** — alta manual con datos mínimos, sin exigir vínculo a catálogo (`feat/retail-optional-catalog-link`).
- **CA-3 · Retomar entre sesiones** — la edición *En preparación* persiste; se continúa la misma ([D-001](decisiones-congeladas.md)).
- **CA-4 · Publicar bloqueado por precios** — mensaje claro de cuántos faltan ([D-004](decisiones-congeladas.md)); no es error, es un estado accionable.
- **CA-5 · Portada vacía** — se publica igual ([D-006](decisiones-congeladas.md)): la edición es una lista pura.

**Vacíos detectados**
1. **Corrección de contenido tras publicar** — la edición sigue viva ([D-009](decisiones-congeladas.md)): ¿las correcciones (precio, typo, portada) se hacen desde el Estudio reabierto o desde otra superficie? Define si el Estudio es accesible con la edición ya *En preventa*.
2. **Alta de un tomo fuera de catálogo** — datos mínimos e interacción del alta manual (identidad + precio).

*(La **fecha de cierre**: si se define al publicar, esta pantalla es uno de los lugares candidatos. Sigue siendo el vacío transversal abierto.)*

---

### P-04 · Página pública de la edición  ·  ✅ v2 congelada

*Mock navegable: `pagina-publica.html`. v2: flujo selección → pedido al pie → un formulario, con cantidad (−/+) y eliminar. Ajustes visuales finos diferidos a implementación.*

*Actor: Persona / comunidad · User Flows: [UF-C1](flujos.md) · [UF-C2](flujos.md) *(gesto)* · Casos de uso: [F-CLI-01](casos-de-uso.md) · [F-CLI-02](casos-de-uso.md) *(gesto)**

> **Qué resuelve:** *¿Qué salió esta semana?* Es **la portada de la tienda** —el front page por el que la comunidad entra— y el lugar donde nace una reserva.

**Objetivo de la pantalla**
Mostrar la edición semanal publicada como la portada de la tienda, para que la comunidad la recorra —encontrar lo que ya sigue o descubrir algo nuevo— y pueda reservar. Sin cuenta y sin fricción: alguien la abre desde un WhatsApp y reserva en menos de un minuto.

**Momento del flujo**
Punto de entrada del cliente. La persona llega por el link que compartió el comerciante o vuelve a la tienda. Existe cuando la edición está *En preventa* (publicada en P-03). El gesto de reservar entrega a **P-05 · Reserva · captura y confirmación**.

**Principios que la gobiernan (ya congelados)**
- Es **la portada de la tienda, no una grilla de catálogo**: nunca se presenta como catálogo.
- **Composición adaptativa**: la portada (principal + secundarias, tal como el comerciante la compuso en P-03) encabeza; debajo, la lista de novedades. *Portada vacía = lista pura*, válido ([D-006](decisiones-congeladas.md)).
- **La persona reconoce, Nakama no personaliza** ([D-010](decisiones-congeladas.md)): se muestra tal cual la compuso el comerciante; sin reordenar por relevancia, sin recomendar.
- **Vidriera serena** ([D-012](decisiones-congeladas.md)): **no** muestra contadores de reservas ni señales sociales. No hay huellas acá (la densidad es privada del comerciante). Muestra, no persuade.
- La **tapa es protagonista**; el color viene solo de las tapas.
- Recorrer es **anónimo y lectura pura**: no deja huella ([F-CLI-01](casos-de-uso.md)).

**Información visible**
- Identidad de la tienda + la edición (nombre de la comiquería, "Edición #81 · semana", y el estado permitido "Preventa abierta hasta el viernes").
- La **composición**: principal (grande) + secundarias + la lista de novedades. Por tomo: tapa, título, autor, precio, y su estado permitido (disponible para reservar).
- **No** muestra: cuántos reservaron, "más reservado", "trending" ([D-012](decisiones-congeladas.md)).

**Acciones posibles**
- Recorrer la edición (los dos modos conviven: buscar *lo que sigo* / descubrir *algo nuevo*).
- **Seleccionar tomos** ("Lo quiero") — marca/desmarca **sin interrumpir la navegación**; se pueden marcar varios mientras se recorre.
- **Hacer pedido** — desde un resumen al pie (N tomos · total), abre **P-05** para confirmar el pedido **completo de una vez**.
- Abrir/compartir el link (es lo que el comerciante pega en WhatsApp).

> **Flujo de reserva (ajuste ago 2026):** la reserva no es tomo-por-tomo-con-formulario, sino **seleccionar varios → un solo pedido → un formulario**. Refleja cómo se reserva en una comiquería (varios tomos en una conversación) y realiza el caso [F-CLI-02](casos-de-uso.md) CA-2 (*varias promesas = un pedido*). P-05 pide solo **Nombre + WhatsApp** (las tiendas trabajan por WhatsApp, no mail) y **recuerda esos datos** para la próxima preventa —beneficio de volver, sin exigir cuenta—. El *mecanismo* de ese recuerdo sin cuenta es el vacío ⭐ abierto de [F-CLI-03](casos-de-uso.md).

**Estados**
- Edición: *En preventa* (pública) — estado normal de esta pantalla.
- Portada: *vacía* (lista pura, [D-006](decisiones-congeladas.md)) / *con principal + secundarias*.
- Por tomo: *disponible para reservar*. (Tras el cierre, ver Vacíos.)

**Casos alternativos**
- **CA-1 · Portada vacía** — la comunidad ve una lista pura; edición completa igual ([D-006](decisiones-congeladas.md)).
- **CA-2 · Llega con la preventa cerrada** — ve la edición sin poder reservar, o un estado "preventa cerrada" (ver Vacíos).
- **CA-3 · Barrido dirigido vs descubrimiento** — la misma página sirve a los dos comportamientos.
- **CA-4 · Vuelve más tarde** — recorrer no requiere identidad; reservar sí (ocurre en P-05).

**Vacíos detectados**
1. **Detalle de un tomo** ([F-CLI-01](casos-de-uso.md)) — ¿inline/expand o vista aparte? Define desde dónde se dispara "reservar".
2. **Explorar después del cierre** — qué ve quien abre el link tarde (encadena con la fecha de cierre).
3. **Vocabulario de estado por tomo** — qué estados se muestran sin caer en métricas sociales ([D-012](decisiones-congeladas.md)): "disponible" sí; escasez/urgencia ("quedan pocos") probablemente no. A fijar.

---

### P-05 · Reserva · captura y confirmación  ·  ✅ v1 congelada

*Mock navegable: `reserva.html`. Bottom sheet sobre P-04; CTA "Hacer pedido"; éxito en lenguaje de tienda; lugar de pago reservado (sin pago: "Te avisamos cuando llegue para pagarlo").*

*Actor: Persona / comunidad · User Flow: [UF-C2](flujos.md) · Caso de uso: [F-CLI-02](casos-de-uso.md)*

> **Forma:** **bottom sheet / modal sobre P-04**, no una pantalla de navegación. La edición queda detrás: la persona no cambia de contexto, solo **cierra la conversación con la tienda** ("sí, guardame esto"). El ID representa una superficie del producto, no una pantalla completa.

> **Principio (fijado):** P-05 **no es un formulario, es una confirmación de reserva.** El centro es *lo que estoy reservando*; los datos de contacto son el **medio** para cumplir la promesa, no el objetivo de la pantalla.

**Objetivo de la pantalla**
Convertir la selección de P-04 en una promesa: que la persona confirme lo que reserva y deje sus datos de contacto para que la tienda pueda cumplir y avisarle. Al confirmar, nace la promesa ([D-011](decisiones-congeladas.md)) y la persona queda **esperada**.

**Orden de la superficie** (de arriba abajo, por importancia)
1. **Lo que reservo** — el resumen del pedido (el centro de la pantalla).
2. **Quién soy** — nombre.
3. **Cómo me avisan** — WhatsApp.
4. **Hacer el pedido** — el CTA en **lenguaje de acción** ("Hacer pedido" / "Reservar estos tomos"), nunca "Confirmar" ([D-017](decisiones-congeladas.md)). El éxito habla en idioma de la tienda ("Tu pedido ya está en la comiquería…"), no genérico de sistema.

**Qué captura**
Una sola responsabilidad: **datos de contacto**. Hoy son *Nombre + WhatsApp* (sin mail: las tiendas trabajan por WhatsApp); mañana podrían sumar alias, Instagram, etc. **La superficie hace el mismo trabajo** independientemente de qué campos concretos sean — la spec se ata a la responsabilidad, no a dos campos.

**Momento del flujo**
UF-C2, al tocar "Hacer pedido" en P-04. Se abre sobre P-04.

**Información visible**
- **El pedido (centro):** las tapas seleccionadas, cantidad por tomo, precio unitario y total. Editable en contexto (−/+, eliminar) sin salir de la hoja.
- **Datos de contacto:** los campos vigentes (Nombre + WhatsApp), **autocompletados** si la persona ya reservó antes; editables. Sin cuenta ni contraseña ([reservar no exige cuenta]).
- **Lugar reservado para el modo de pago:** un espacio en la hoja donde, según el modo de la preventa, aparecerá la instancia de pago. Hoy vacío (sin pago); el diseño **no debe romperse** cuando se agregue *seña* o *pago total*.

**Acciones posibles**
- Ajustar el pedido (−/+, eliminar) — refleja P-04, sin salir.
- Editar los datos de contacto.
- **Hacer el pedido** (CTA en lenguaje de acción, [D-017](decisiones-congeladas.md)) → nace(n) la(s) promesa(s).
- Volver a la edición sin confirmar ("Seguir mirando"); la selección se conserva.

**Estados**
- *Revisión* — pedido y datos editables.
- Datos de contacto: *nuevos* (vacíos) / *recordados* (autocompletados).
- *Confirmado* — promesa(s) en estado *Reservado* ([D-011](decisiones-congeladas.md)); la persona queda esperada; la hoja muestra el acuse ("te avisamos por WhatsApp cuando lleguen").
- *(Futuro, según modo de pago)* pendiente de pago / con seña / pagado — hoy no aplica.

**Casos alternativos**
- **CA-1 · Cliente que vuelve** — datos autocompletados; solo confirma.
- **CA-2 · Vacía el pedido** (elimina todo) — la hoja se cierra y vuelve a la edición, sin promesa.
- **CA-3 · Cierra sin confirmar** — la selección se conserva; puede reabrir "Hacer pedido".
- **CA-4 · Ajusta cantidades en la hoja** — total y promesa reflejan el último estado.
- **CA-5 · (Futuro) modo con pago** — la instancia de pago aparece en el lugar reservado, antes de o al confirmar, según el modo.

**Vacíos detectados**
1. **Modo de pago** ([F-CLI-02](casos-de-uso.md) #2) — dónde y cómo entra la instancia de pago (sin pago / seña / pago total). Se deja un **lugar reservado**; no se resuelve. La superficie queda preparada para incorporarlo **sin rediseño**.
2. **Mecanismo del dato recordado sin cuenta** ([F-CLI-03](casos-de-uso.md) ⭐) — cómo Nakama reconoce a quien vuelve para autocompletar sin login. Abierto.
3. **Puente a seguir la reserva** — tras confirmar, ¿la hoja ofrece un modo de "seguir mi reserva" (P-06)? A definir (encadena con el mecanismo de recuperación).

---

### P-06 · Vista pública de la reserva

*Actor: Persona / comunidad · User Flow: [UF-C3](flujos.md) · Casos de uso: [F-CLI-03](casos-de-uso.md) · [F-CLI-04](casos-de-uso.md)*

> **¿Qué necesita saber una persona cuando vuelve a ver una reserva que ya hizo?** Tres cosas, en este orden:
> 1. **Sigue en pie** — la tienda la recuerda; su pedido existe (tranquilidad).
> 2. **Qué reservó** — cuáles tomos, cuántos, cuánto (memoria: pudo olvidarlo).
> 3. **En qué situación está** — en lenguaje humano, no logístico: *esperando que llegue* / *¡llegó, pasá a buscarlo!* / *ya lo retiraste*; y si hay algo por pagar.
>
> **No es un tracking ni un listado de estados.** Es la continuidad natural de P-05: ya hiciste el pedido, ahora volvés.

**Objetivo de la pantalla**
Que una persona que ya hizo un pedido pueda volver, **confirmar que sigue en pie**, recordar qué reservó y en qué situación está, y —si quiere— darlo de baja.

**Momento del flujo**
UF-C3. La persona vuelve a su reserva: desde el "Seguir mi reserva" de P-05, un enlace/código guardado, o tras un aviso de [SYS-03](automatizaciones.md). El **mecanismo de acceso sin cuenta** es el vacío ⭐ abierto (ver Vacíos).

**Forma**
Una **vista propia** (se llega desde un enlace externo, típicamente WhatsApp), no un sheet sobre P-04. Mantiene el lenguaje visual de P-05 para que se sienta la misma reserva.

**Información visible**
- **Encabezado que ubica:** de qué tienda y edición es ("Comiquería Ronin · Edición #81") y que es **tu reserva**.
- **Estado general** en lenguaje humano (esperando / listo / retirado / cancelado): el titular tranquiliza.
- **Qué reservó:** la lista de tomos (tapa, título, cantidad, precio), con el estado de cada uno cuando difieren (uno llegó, otros esperando).
- **Pago:** no se paga al reservar. Cuando la mercadería **llega** y la tienda confirma, la persona paga el total (transferencia) y **adjunta el comprobante**; recién ahí retira.
- **Próximo paso** cuando corresponde: si llegó, pagar + comprobante; si ya pagó, cómo/dónde retirarlo (el aviso ya suele haber llegado por WhatsApp).

**Acciones posibles**
- **Dar de baja** la reserva ([F-CLI-04](casos-de-uso.md)), sujeto a la regla "hasta cuándo se puede cancelar" (vacío abierto).
- **Contactar a la tienda** (WhatsApp).
- *(No: agregar tomos ni "volver a comprar" acá — eso es volver a la edición, P-04.)*

**Estados** (los que ve la persona; colapsan los operativos del comerciante)
- *Esperando* — reservado, la mercadería aún no llegó. Sin pago, sin acción. "Te avisamos cuando lleguen."
- *Listo (a pagar)* — la tienda confirmó que llegaron. **Es el momento del pago:** la persona transfiere el total y **adjunta el comprobante**.
- *Pagado (a retirar)* — comprobante recibido; pasá a buscar tus tomos (aparecen dirección y horario).
- *Retirado* — cumplida; cerrado.
- *Cancelada* / *Vencida* — finales, sin acción.
- *(Los pedidos llegan juntos —los viernes—; una llegada parcial es una excepción por demora, no un estado que la pantalla muestre.)*

**Qué es ruido (no se muestra)**
- Línea de tiempo de micro-estados / tracking paso a paso.
- Vocabulario operativo interno del comerciante (*apartado*, *faltante*).
- Barras de progreso, ETA, porcentajes.
- Métricas o marketing.

**Vacíos detectados**
1. ⭐ **Mecanismo de acceso sin cuenta** ([F-CLI-03](casos-de-uso.md)) — cómo llega y reconoce la persona su reserva (enlace único / código / logueada / teléfono), y cómo se garantiza que **solo ella** la vea. Es LA decisión arquitectónica pendiente del lado del cliente; define desde dónde se entra a P-06. No se resuelve en esta ficha, pero P-06 la necesita.
2. **Hasta cuándo se puede cancelar** ([F-CLI-04](casos-de-uso.md) ⭐) — habilita o no la acción de baja según estado/tiempo.
3. **Granularidad por tomo vs pedido** (unidad, F-COM-06/07) — normalmente los pedidos llegan completos; el caso parcial (por demora) queda como excepción a resolver, no como estado de esta pantalla.
4. **Pago — parcialmente resuelto:** el pago ocurre **al llegar la mercadería** (no al reservar ni al retirar), por **transferencia + comprobante**; luego se retira. Falta cerrar: la **confirmación del comprobante** por la tienda (¿estado intermedio "comprobante en revisión"?) y si algún modo de preventa lleva **seña previa**.

---

### P-07 · Workspace · Preparación

*Actor: Comerciante · User Flow: [UF-M3](flujos.md) · Caso de uso: [F-COM-06](casos-de-uso.md)*

> **¿Cómo convierto la mercadería que llegó en pedidos listos para entregar?**
> No es una gestión de stock ni un depósito. Es el momento en que la tienda **transforma las cajas que llegaron en pedidos preparados para personas concretas.**
>
> El trabajo empieza por las **personas**, no por los libros ([F-COM-06](casos-de-uso.md), decisión humana: *¿a quién ya le puedo cumplir la promesa?*). La pantalla ordena ese trabajo como una **cola de pedidos por preparar**, no como una tabla de tomos.
>
> La preparación de un pedido **termina** cuando cada tomo prometido quedó apartado para su persona y esa promesa quedó **lista para avisar**. Preparar = vaciar la cola de arriba.

**Objetivo de la pantalla**
Que el comerciante, cuando llega la mercadería, convierta la edición cerrada en **pedidos apartados por persona**: registrar (rápido) qué llegó, apartar los ejemplares de cada persona, detectar faltantes y dejar las promesas completas **listas para avisar** ([SYS-03](automatizaciones.md)).

**Momento del flujo**
UF-M3, primer paso de la trastienda. Viene de **P-02 · Definir cantidades** (la preventa ya se cerró con un "A pedir" por tomo) una vez que la mercadería llegó al local —normalmente los viernes, junta—. Le sigue **P-08 · Entrega** cuando la persona pasa a retirar.

**Forma**
Superficie de **Workspace** (trastienda, misma familia que P-01/P-02/P-03: papel + tinta, sin adorno). Se opera de arriba hacia abajo. Dos zonas, una subordinada a la otra:
- **Recepción** (franja superior, compacta) — confirmar que llegó el envío. Una pregunta, no una planilla. No es el protagonista.
- **Pedidos por persona** (cuerpo) — el espacio central; la cola de trabajo real.

**Información visible**

*Zona Recepción (franja, entra una vez):*
- Una sola pregunta: **"¿Llegó la mercadería?"** con **"Llegó todo ✓"** (caso normal) y **"Faltó algo"** (secundaria). Ambas confirman la recepción; "Faltó algo" además muestra la ayuda para marcar lo que no entró. Confirmar es lo que **habilita** el cuerpo y, del lado del cliente, lo que —al apartar+avisar cada pedido— enciende el estado *Listo (a pagar)* de [P-06](#p-06--vista-pública-de-la-reserva). Al confirmar, un resumen ("Recepción confirmada · viernes 15 ago"), con la cuenta de tomos no llegados si los hubo. *(No hay reconciliación por título ni cantidades pedidas vs llegadas: el faltante se marca donde se descubre —sobre el pedido de la persona—, ver abajo.)*

*Zona Pedidos por persona (cuerpo), agrupada por situación:*
- **Por preparar** (arriba) — pedidos cuyos tomos **llegaron todos**: accionables ahora. Cada tarjeta: **persona** (nombre + contacto), sus **tomos** (tapa, título, cantidad) —cada tomo con un discreto *"no llegó"*—, total, y el CTA **"Apartar y avisar"**.
- **Con faltante** (debajo, separado) — pedidos con ≥1 tomo marcado *no llegó*. El faltante es **de la copia de esa persona**, no del título: marcar "no llegó" en el pedido de una persona **no afecta** a otra que pidió el mismo tomo (decidir a quién le toca una copia escasa es de la tienda, [D-019](decisiones-congeladas.md) a nivel copia). Dos sub-casos: si **algo llegó** (≥1 tomo presente), la tienda puede *esperar* (normal) o **preparar igual** (apartar lo llegado y avisar parcial); si **nada llegó**, no hay "preparar igual" (no hay qué apartar): solo *esperar* o *dar de baja el pedido*.
- **Listos · avisados** (al pie) — ya apartados y avisados (completo o parcial); salen del camino. La cola "por preparar" tendiendo a cero es la señal de trabajo terminado.
- **Dados de baja** (al pie) — pedidos cuya promesa **cayó**: al dar de baja el/los tomo(s) faltante(s), si el pedido queda sin ejemplares, no vuelve a "por preparar" (no habría nada que apartar) — pasa acá (rama *caída*).

**Acciones posibles**
- **Confirmar recepción** — **"Llegó todo ✓"** o **"Faltó algo"** ([D-018](decisiones-congeladas.md)).
- **Marcar / deshacer "no llegó"** en un tomo del pedido de una persona (por copia).
- **Apartar y avisar** un pedido completo → la promesa pasa a *lista para retirar* y dispara el aviso ([SYS-03](automatizaciones.md)). Es la unidad de trabajo de la pantalla.
- **Preparar igual** un pedido con algo llegado → aparta lo presente y avisa parcial (decisión de la tienda, [D-019](decisiones-congeladas.md)).
- **Dar de baja** un tomo faltante (o el pedido entero si nada llegó) → rama de muerte *caída* (a modelar — ver Vacíos).
- *(No: cobrar. El pago —transferencia + comprobante— ocurre entre el aviso y el retiro; la verificación del cobro es de **P-08**. P-07 prepara y avisa, no cobra.)*

**Estados** (de la promesa, que esta pantalla hace avanzar)
- *reservado* → *apartado* (el ejemplar llegó y se separó para la persona) → *listo para retirar* (apartado + avisado; habilita [P-08](#p-08--workspace--entrega) y [D-014](decisiones-congeladas.md)).
- *faltante* — el ejemplar reservado no llegó; la promesa queda retenida, no apartable, hasta que llegue o se dé de baja.

**Qué es ruido (no se muestra)**
- Inventario/stock general del local: acá solo vive **lo prometido**. Los ejemplares sin promesa (sobrante, [F-COM-06](casos-de-uso.md) CA-3) **salen de este flujo** y no aparecen.
- Vocabulario logístico del depósito (ubicaciones, códigos de caja, remitos).
- Cualquier sugerencia de cantidad o de "qué preparar primero" más allá de la situación real del pedido ([D-003](decisiones-congeladas.md)).
- Dinero (cobro, saldos, comprobantes): es de P-06/P-08.

**Vacíos detectados**
1. **Rama *caída*** ([F-COM-06](casos-de-uso.md) vacío 2) — cómo muere o se posterga la promesa cuando un faltante no llega nunca; se modela junto con las demás muertes. (En P-07 v1 "dar de baja" ya la manda a *Dados de baja*; falta el modelo de dominio.)
2. **Confirmación del comprobante** — si el estado *Listo (a pagar)* del cliente pasa a *Pagado (a retirar)* automáticamente al adjuntar, o requiere que la tienda **valide** el comprobante (posible estado intermedio). Encadena con P-06 vacío 4 y con P-08. No se resuelve acá pero condiciona si P-07/P-08 muestran "comprobante recibido / a revisar".
3. **Borde v1 · faltante parcial de una línea con cantidad >1** — si una persona pidió N copias del mismo tomo y llegan menos de N, "no llegó" hoy marca la **línea entera** (todas las copias); no se puede expresar "llegaron 1 de 2". Aceptado como **caso borde de v1** (las líneas con cantidad >1 son poco frecuentes); no se complejiza la interfaz por ahora. Si aparece como problema real en implementación/pruebas con tiendas, se resuelve entonces (posible stepper *llegaron X de N* por línea).

*Resueltos:* **unidad de cumplimiento** → [D-019](decisiones-congeladas.md). **Registro de recepción** → [D-018](decisiones-congeladas.md). **Granularidad del faltante** → por **copia del pedido de la persona** (no por título); "preparar igual" solo con ≥1 tomo llegado; baja del último tomo → *caída* (grupo Dados de baja).

---

### P-08 · Workspace · Entrega

*Actor: Comerciante (+ Persona en el mostrador) · User Flow: [UF-M4](flujos.md) · Caso de uso: [F-COM-07](casos-de-uso.md)*

> **¿Cómo termino de cumplir las promesas que ya están listas?**
> No es una caja registradora ni un sistema de cobro. El protagonista sigue siendo **la persona que vino a buscar lo suyo.** En el mostrador, el comerciante necesita responder rápido cuatro cosas y cerrar:
> 1. **Quién vino** — encontrar a la persona sin fricción.
> 2. **Qué vino a retirar** — sus tomos apartados, para reconocerlos juntos.
> 3. **Cuánto falta pagar** (si corresponde) — el dinero aparece solo cuando existe, en el idioma de la relación.
> 4. **Registrar que la entrega ocurrió** — un gesto que cierra la promesa.
>
> Todo lo demás (validar la transferencia, cobrar en efectivo, una observación) **acompaña** esa tarea; no la lidera. La promesa se cumple: es su **buena muerte** ([F-COM-07](casos-de-uso.md)).

**Objetivo de la pantalla**
Que el comerciante, cuando la persona se presenta a retirar, **cierre la promesa como cumplida**: encontrar a la persona, reconocer sus tomos, saldar el pago si falta, y registrar la entrega (*retirada*).

**Momento del flujo**
UF-M4, el mostrador. La persona vino tras el aviso ([SYS-03](automatizaciones.md)) y —en el modo de pago habitual— **ya pagó por transferencia** (adjuntó comprobante en [P-06](#p-06--vista-pública-de-la-reserva)). Viene de **P-07**, que dejó su promesa *lista para retirar*. Es la **última pantalla del arco**: cierra el ciclo que abrió P-03.

**Forma**
Superficie de **Workspace** (mostrador, misma familia P-01/P-02/P-03/P-07). Dos momentos en una pantalla:
- **Encontrar a la persona** — una **lista de "Para entregar"** (las promesas *listas para retirar*) con **búsqueda por nombre** arriba. Optimizada para la velocidad del mostrador: la persona dice su nombre, aparece su ficha.
- **Cerrar la entrega** — al elegirla, su **ficha de entrega**: sus tomos, el estado del pago y un gesto para **Entregar**.

**Información visible**

*Lista "Para entregar":*
- Cada persona con promesa *lista para retirar*: **nombre**, cantidad de tomos, y el **estado del pago de un vistazo** (*Pagado* / *falta pagar $X* / *comprobante por validar*). Ordenada para que quien llega se encuentre rápido (búsqueda por nombre; a futuro, otros modos).

*Ficha de entrega (al abrir una persona):*
- **Qué vino a retirar** — sus tomos apartados (tapa, título, cantidad), reconocibles juntos. Si su entrega es **parcial** (P-07 · preparar igual), se ve qué se lleva hoy y qué queda debiendo.
- **Pago** — solo si hay algo que resolver: *Pagado* (comprobante recibido/validado, en verde y al margen) o **falta pagar $X**. El dinero no es el centro: aparece cuando existe, en el idioma de la tienda.
- **Contacto** (WhatsApp) por si hace falta.

**Acciones posibles**
- **Buscar / seleccionar** a la persona que vino.
- **Registrar el pago** si falta — neutro respecto al modo (validar comprobante / efectivo / transferencia); no es un POS, es "quedó saldado".
- **Entregar** → marca la promesa **retirada** (cumplida). Habilitado solo si está *lista para retirar* ([D-014](decisiones-congeladas.md)) y —si el modo de la preventa exige pago previo— si el pago está saldado.
- *(Opcional)* una **observación** breve.
- *(No: agregar productos, vender suelto, cross-sell, reportes de caja. No es una registradora.)*

**Estados** (de la promesa)
- *lista para retirar* → **retirada** (cumplida) — la buena muerte, opuesta a *cancelada / vencida / caída*.
- *Dinero*: si hay **saldo**, se salda **antes** de cerrar (neutro: seña / pago total / sin pago previo, [F-COM-07](casos-de-uso.md)).

**Qué es ruido (no se muestra)**
- Caja registradora: total del día, arqueo, reportes de venta, ticket fiscal.
- Catálogo / stock / venta de productos sueltos.
- Métricas, ranking de clientes, historial largo de compras.
- Micro-estados logísticos ya resueltos en P-07 (*apartado*, *faltante*).

**Vacíos detectados**
1. **Cómo se encuentra a la persona** — búsqueda por nombre es el default; ¿hace falta también por WhatsApp / un código de retiro / mostrar el aviso? Encadena con [DT-01 · Acceso a reservas](decisiones-congeladas.md).
2. **Validación del comprobante — RESUELTO v1.** P-08 tolera los tres escenarios sin volver el pago protagonista: *pagado* validado → sello **Pagado**; *comprobante pendiente* → **Ver comprobante → Confirmar pago** desde la ficha; *saldo pendiente* → **Registrar pago** antes de entregar. La validación pudo ocurrir antes; si sigue pendiente al retirar, se resuelve acá. No se crea otra superficie para esto en v1. (Sigue abierto el modelo de pago general — vacío 5.)
3. **Retiro por un tercero — borde v1 (documentado, no impedido).** La tienda encuentra la reserva por el **nombre de quien hizo el pedido** y la entrega normalmente. En v1 **no** se agrega autorización de terceros, campos de "persona autorizada" ni flujo especial. Se documenta para validar con Agustín. ([F-COM-07](casos-de-uso.md) CA-4.)
4. **Entrega parcial y saldo del resto** — cuando la persona se lleva parte (P-07 preparar igual): qué pasa con lo que queda debiendo y con el dinero de esos tomos. Encadena con la unidad de cumplimiento ([D-019](decisiones-congeladas.md)).
5. **Modo de pago / seña** — el modelo de pago no está cerrado; P-08 debe **alojar el cobro de un saldo** sin fijar el modo (seña previa, pago total al llegar, sin pago). Vacío transversal de pago (ver [F-CLI-02](casos-de-uso.md) #2).
