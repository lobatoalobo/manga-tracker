# 3 · Casos de uso

## Cómo se organiza esta sección

Un **caso de uso** describe una **operación del dominio**: un actor y el sistema logrando una acción discreta, con precondiciones, alternativas y postcondición. Es el material que los **User Flows** ([Sección 1](flujos.md)) encadenan en recorridos, y que las **Pantallas** ([Sección 2](pantallas.md)) implementan.

> **Nota de migración (ago 2026):** estas fichas se documentaron primero como "Flujos" y luego se reconocieron como casos de uso. Conservan sus IDs originales (`F-COM-xx`, `F-CLI-xx`) para no romper las referencias de [decisiones-congeladas.md](decisiones-congeladas.md) ni de las pantallas. Las automatizaciones del sistema (antes `F-SYS-xx`) se separaron a [automatizaciones.md](automatizaciones.md).

## Plantilla

- **ID** — estable, referenciable desde otras secciones.
- **Decisión humana** *(cuando aplica)* — la intención previa a Nakama que la operación facilita.
- **Objetivo** — qué logra el actor.
- **Disparador** — el gatillo.
- **Precondiciones** — estado previo (distinto del gatillo).
- **Actores** — quién participa y en qué rol.
- **Pantallas involucradas**.
- **Estados** — por los que pasa el objeto central.
- **Casos alternativos**.
- **Resultado esperado**.
- **Vacíos detectados**.

## Inventario

### Comerciante
- **F-COM-01** · Crear una edición
- **F-COM-02** · Componer la portada
- **F-COM-03** · Publicar la edición
- **F-COM-04** · Monitorear la preventa — *ficha diferida; se descubre en la pantalla [P-01 Preventa Viva](pantallas.md)*
- **F-COM-05** · Definir cantidades — *ficha diferida; se descubre en la pantalla P-02*
- **F-COM-06** · Preparar pedidos
- **F-COM-07** · Entregar pedidos

### Cliente
- **F-CLI-01** · Explorar la edición
- **F-CLI-02** · Reservar un tomo
- **F-CLI-03** · Seguir una reserva
- **F-CLI-04** · Cancelar una reserva

---

## Fichas

### F-COM-01 · Crear una edición

**Objetivo**
Crear una nueva edición semanal y comenzar a construir su lista de novedades. La edición puede quedar incompleta: este caso de uso la deja *En preparación*, lista para componer la portada (F-COM-02) y publicar (F-COM-03).

**Disparador**
El comerciante abre el Estudio de la nueva semana. La edición ya lo está esperando: existe con su estructura heredada —número, semana, estado *En preparación*, lista vacía— y sin contenido ([D-005](decisiones-congeladas.md)). El comerciante empieza a construir la lista. Nada se publica solo (publicar es F-COM-03); el Sistema puede haber pre-cargado novedades sugeridas vía [SYS-01](automatizaciones.md), pero no decide qué entra.

**Precondiciones**
- El comerciante tiene acceso al Estudio.
- Existe una única edición *En preparación* por tienda ([D-001](decisiones-congeladas.md)); es la que este caso de uso construye.

**Actores**
- **Comerciante** — único que decide. Da de alta la edición y carga/quita tomos.
- **Sistema** — rol de apoyo: ofrece novedades sugeridas y el precio recordado de cada tomo. No decide qué entra.

**Pantallas involucradas**
- **Estudio · orden de trabajo** — la lista de novedades: alta rápida por teclado, novedades sugeridas, precio recordado. Es donde ocurre el grueso de este caso de uso.
- **Alta de tomo** — para sumar un tomo que no aparece en las sugeridas (búsqueda o carga manual).
- *(La portada en miniatura es visible pero componerla es F-COM-02.)*

**Estados** (de la edición)
- **En preparación** — existe, aún no publicada, invisible para el cliente. Es el único estado que produce este caso de uso.
- La transición a **Publicada** pertenece a F-COM-03.

Estados por tomo dentro de la edición: *sugerido* → *agregado*; y *con precio* / *sin precio*. Un tomo *sin precio* puede existir en preparación, pero **bloqueará la publicación** ([D-004](decisiones-congeladas.md)).

**Casos alternativos**
- **CA-1 · Semana sin sugeridas** — la fuente no trajo novedades. El comerciante arma 100% manual; la edición puede crearse vacía y llenarse.
- **CA-2 · Tomo fuera de catálogo** — se agrega un tomo que la fuente no tiene. Alta manual con datos mínimos, sin exigir vínculo a catálogo *(alinea con "catalog link opcional", rama `feat/retail-optional-catalog-link`)*.
- **CA-3 · Retomar entre sesiones** — la edición *En preparación* persiste; volver al Estudio otro día continúa la misma edición, nunca crea otra ([D-001](decisiones-congeladas.md)).
- **CA-4 · Quitar un tomo** — cargado por error; se remueve de la lista.
- **CA-5 · Tomo duplicado** — intento de agregar un tomo ya presente en la edición; se evita el duplicado.

**Resultado esperado**
Existe una **edición #N en estado "En preparación"** (numeración automática y correlativa, [D-002](decisiones-congeladas.md)) con su lista de tomos, cada uno con sus datos mínimos (identidad del tomo + precio). Queda lista para componer la portada y publicar. Nada es aún visible para el cliente.

**Vacíos detectados**
1. **¿Cuándo y cómo se define la fecha de cierre?** ¿La fija el comerciante al crear, al publicar (F-COM-03), automáticamente, o depende de la editorial? Se deja abierto a propósito: todavía no entendemos bien el oficio. Es el ancla de [SYS-02](automatizaciones.md) (vencimientos).

*(Decisiones ya tomadas migradas al registro: [D-001, D-002, D-004, D-005](decisiones-congeladas.md).)*

---

### F-COM-02 · Componer la portada

**Decisión humana**
*¿Qué quiero que mi comunidad vea primero cuando abra esta edición?* Es una decisión que el comerciante ya toma hoy —al armar el WhatsApp, al acomodar los tomos sobre el mostrador, al recomendar algo en persona— exista Nakama o no. Este caso de uso solo le da un lugar donde expresarla.

**Objetivo**
Permitir que el comerciante traduzca esa decisión en la composición de la edición: definir qué novedades van a la portada (ninguna, una o varias) y cuál es la principal.

> **En una línea:** F-COM-02 existe para que el comerciante decida qué quiere que su comunidad vea primero al abrir la edición de la semana, pudiendo llevar a portada ninguna, una o varias novedades y definiendo cuál es la principal.

**Disparador**
Durante la preparación, el comerciante quiere darle forma editorial a la edición. Puede ocurrir entrelazado con F-COM-01 (carga un tomo y lo lleva a portada en el mismo momento) o después, sobre la lista ya armada. No es necesariamente una visita aparte: es una decisión que se expresa dentro del mismo Estudio.

**Precondiciones**
- Existe una edición *En preparación* ([D-001](decisiones-congeladas.md)).
- Hay al menos un tomo en la lista (no hay sobre qué componer si la lista está vacía).

**Actores**
- **Comerciante** — único que decide. La jerarquía editorial es puro juicio comercial.
- **Sistema** — sin rol. Nakama **nunca sugiere qué llevar a portada** (misma línea que [D-003](decisiones-congeladas.md): muestra, no elige).

**Pantallas involucradas**
- **Estudio · orden editorial** — la portada en miniatura, editable en vivo (reordenar, elegir principal).
- **Estudio · orden de trabajo** — el gesto "llevar a portada" desde cada fila de la lista.
- *(El orden editorial es independiente del orden de trabajo — [D-007](decisiones-congeladas.md).)*

**Estados**
- La edición sigue *En preparación*: componer **no** cambia el estado de publicación.
- Composición de la portada: *portada vacía* (lista pura) · *portada con uno o más tomos* (siempre con exactamente una principal, [D-008](decisiones-congeladas.md)).
- Por tomo: *en lista* · *en portada* · *principal*.

> **Propiedad:** la cantidad de tomos en portada es **ilimitada**. La composición se adapta; nunca restringe ni penaliza la decisión editorial de la tienda.

**Casos alternativos**
- **CA-1 · Portada vacía** — respuesta válida ([D-006](decisiones-congeladas.md)): la edición es una lista pura, no un estado incompleto.
- **CA-2 · Primer tomo a portada** — al llevar el primer tomo, pasa a ser la principal automáticamente ([D-008](decisiones-congeladas.md)); sin modal, sin obligación explícita.
- **CA-3 · Cambiar la principal** — reasignar entre los tomos en portada; siempre hay exactamente una.
- **CA-4 · Bajar de portada** — el tomo vuelve a la lista; si era la principal y quedan otros en portada, la principal se reasigna sola para mantener el modelo consistente.
- **CA-5 · Muchos tomos en portada** — el layout redistribuye el espacio, nunca reprocha; una semana cargada se ve cargada, no equivocada.

**Resultado esperado**
La edición tiene una composición editorial definida: una portada —posiblemente vacía— y, si contiene tomos, exactamente una principal que la encabeza. Es lo que verá la comunidad al publicar (F-COM-03). Sigue *En preparación*.

**Vacíos detectados**
Ninguno. Las decisiones de modelo que este caso de uso destapó se congelaron en [D-006, D-007, D-008](decisiones-congeladas.md).

---

### F-COM-03 · Publicar la edición

**Decisión humana**
*¿Estoy listo para abrir esta preventa a mi comunidad?* No es "¿está lista la edición?" —la edición puede seguir cambiando—: lo que el comerciante decide es **abrir la ventana de preventa**. Hasta ese instante la edición es privada; a partir de él, la comunidad ya puede reservar.

**Objetivo**
Hacer pública la edición de la semana para habilitar las reservas de la comunidad e iniciar la preventa.

**Disparador**
El comerciante considera que la edición ya puede recibir a su comunidad y decide abrir la preventa. Es un acto manual y explícito.

**Precondiciones**
- Existe una edición *En preparación* ([D-001](decisiones-congeladas.md)).
- La edición tiene al menos un tomo (no se abre una preventa vacía).
- Todos los tomos tienen precio: sin esto, publicar está **bloqueado** ([D-004](decisiones-congeladas.md)).

**Actores**
- **Comerciante** — decide y ejecuta.
- **Sistema** — ejecutor, no decisor: hace efectivo el cambio de estado (expone públicamente, habilita reservas, arranca el tiempo de la preventa).

**Pantallas involucradas**
- **Estudio** — la acción de publicar, y el bloqueo claro cuando faltan precios ("No podés publicar porque faltan N precios", [D-004](decisiones-congeladas.md)).
- **Página pública** — destino: pasa a existir/volverse accesible para la comunidad (entra F-CLI-01).

**Estados**
- Edición: *En preparación* → *En preventa*.
- La edición **no se congela** al publicar ([D-009](decisiones-congeladas.md)): sigue viva y editable; las reservas entran, las huellas aparecen, la portada puede seguir respirando.

**Casos alternativos**
- **CA-1 · Faltan precios** — publicar está bloqueado ([D-004](decisiones-congeladas.md)); el sistema indica cuántos faltan. No es un error del comerciante: es un estado legible que le dice qué resolver.
- **CA-2 · Portada vacía** — se publica igual ([D-006](decisiones-congeladas.md)): la edición es una lista pura.
- **CA-3 · Corregir después de publicar** — la edición sigue viva ([D-009](decisiones-congeladas.md)); correcciones menores (precio, typo, imagen, portada) siguen posibles sin "despublicar".

**Resultado esperado**
La edición pasa a *En preventa*. **Qué cambia en el mundo** desde este instante:
- aparece públicamente y se puede compartir;
- la comunidad puede reservar (F-CLI-02);
- empieza a correr el tiempo de la preventa;
- pueden nacer las primeras promesas.

La edición sigue viva y editable ([D-009](decisiones-congeladas.md)).

**Vacíos detectados**
1. **Fecha de cierre** — publicar es el momento en que "empieza a correr el tiempo". ¿Publicar exige una fecha de cierre, y por lo tanto se define acá? Encadena con el vacío abierto de F-COM-01 y es el ancla de [SYS-02](automatizaciones.md). Sigue abierto a propósito.
2. **Límites de edición post-publicación** — correcciones menores sí ([D-009](decisiones-congeladas.md)), pero ¿se puede **quitar un tomo que ya tiene reservas**? Eso toca promesas vivas (F-CLI). Necesita regla; se resolverá al modelar la promesa.
3. **¿Existe "despublicar"?** Presunción: no. Lo irreversible es que la comunidad ya la vio; cerrar la preventa es un evento aparte (caso de otros flujos), no un volver-a-privado. Confirmar.

---

### F-COM-06 · Preparar pedidos

**Decisión humana**
*¿A quién ya le puedo cumplir la promesa?* Cuando llega la mercadería, el trabajo empieza por las personas, no por los libros. De esa respuesta derivan naturalmente las acciones: apartar lo prometido, detectar faltantes y dejar listas las promesas para avisar.

**Objetivo**
Que el comerciante, al recibir la mercadería, prepare las reservas que ya puede cumplir: apartar los ejemplares llegados para cada persona, detectar faltantes y dejar listas para avisar las promesas completas.

> **Observación (unidad de trabajo):** hasta acá la unidad fue la edición o el tomo. En este caso de uso la unidad parece pasar a ser la **promesa** —un tomo puede haber llegado, pero si una persona reservó dos cosas y llegó una sola, su promesa todavía no es cumplible—. No se congela; se observa si el modelo lo confirma al documentar y validar con la tienda.

**Disparador**
Llega la mercadería al local (total o parcialmente).

**Precondiciones**
- Existen reservas (promesas) sobre la edición (F-CLI-02).
- Llegó al local la mercadería correspondiente a esos tomos.

**Actores**
- **Comerciante** — recibe y prepara (trabajo de trastienda).
- **Sistema** — muestra, por persona, qué promesas ya son cumplibles y cuáles tienen faltantes; deja las completas listas para avisar ([SYS-03](automatizaciones.md)).

**Pantallas involucradas**
- **Workspace · preparación** — la vista organizada por **persona / promesa**, no como tabla de tomos.
- **Registro de llegada** — marcar qué tomos entraron (ver Vacíos).

**Estados** (de la promesa)
- *reservado* → *apartado* (el ejemplar llegó y se separó para la persona) → *listo para retirar* (la promesa está apartada y se puede avisar).
- *faltante* — el ejemplar reservado no llegó; la promesa queda pendiente, aún no apartable.

**Casos alternativos**
- **CA-1 · Llegada parcial** — llegan algunos tomos y no otros: unas promesas quedan apartables y otras faltantes.
- **CA-2 · Faltante que no llega** — un tomo reservado no vino (agotado / no despachado): la promesa no puede cumplirse aún y deriva en una decisión (esperar, o dar de baja → rama *caída*, a modelar).
- **CA-3 · Sobrante** — llegaron más copias que reservas (el comerciante pidió de más, [D-003](decisiones-congeladas.md)): los ejemplares sin promesa **salen de este flujo** y pasan a stock/catálogo (frontera operativa por origen).

**Resultado esperado**
- Los ejemplares llegados quedan apartados por persona.
- Las promesas completas quedan *listas para retirar* y para avisar ([SYS-03](automatizaciones.md)) → entregar (F-COM-07).
- Los faltantes quedan identificados.

**Vacíos detectados**
1. ⭐ **Unidad de cumplimiento: ¿promesa individual o pedido completo?** *(principal)* — si una persona reservó varios tomos y llegó parte, ¿se avisa/entrega por tomo apartado, o recién cuando su pedido está completo? Depende de cómo trabaja la tienda. Es la forma concreta de la observación sobre la unidad de trabajo.
2. **Rama *caída*** — cuando un faltante no llega nunca, cómo muere o se posterga la promesa. Se modelará junto con las demás muertes.
3. **Registro de recepción** — ¿el comerciante marca a mano qué llegó, o se asume que llegó todo lo pedido? Mecanismo del disparador "entró la mercadería".

---

### F-COM-07 · Entregar pedidos

**Decisión humana**
*¿Puedo dar esta promesa por cumplida?* La pregunta engloba, en el mostrador, verificar a la persona, cobrar un saldo si existe y entregar el ejemplar.

**Objetivo**
Que el comerciante cierre una promesa como cumplida cuando la persona viene a retirar: entregar el ejemplar apartado y, si corresponde, saldar el pago.

**Disparador**
La persona se presenta en el local a retirar su reserva.

**Precondiciones**
- La promesa está *lista para retirar* ([D-014](decisiones-congeladas.md)).
- La persona se reconoce como dueña de la reserva.

**Actores**
- **Comerciante** — atiende en el mostrador; cobra si corresponde y entrega.
- **Persona** — se presenta, salda el pago si existe y recibe su ejemplar.
- **Sistema** — marca la promesa como *retirada* (cumplida).

**Pantallas involucradas**
- **Workspace · entrega (mostrador)** — encontrar la promesa de la persona, ver si hay saldo, marcar entregada.

**Estados** (de la promesa)
- *listo para retirar* → *retirada* (cumplida). Es la "buena muerte" de la promesa, opuesta a *cancelada / vencida / caída*.
- Dinero: si la promesa tiene un **saldo pendiente**, este caso de uso contempla su cobro **antes** de darla por cumplida (neutro respecto a los tres modelos de pago: seña / pago total / sin pago previo).

**Casos alternativos**
- **CA-1 · Con saldo pendiente** — se cobra el saldo antes de marcar la promesa como cumplida.
- **CA-2 · Sin saldo** — ya estaba pagada (o el modo de la preventa no llevaba pago hasta aquí); se entrega y se cierra.
- **CA-3 · Pedido incompleto** — solo parte del pedido de la persona está lista: ¿se entrega parcial o se espera el resto? Misma pregunta de unidad que F-COM-06.
- **CA-4 · Retira un tercero** — otra persona retira en nombre de quien reservó: ¿se permite?, ¿cómo se verifica (ver Vacíos)?

**Resultado esperado**
- La promesa queda *retirada* (cumplida); el saldo, cobrado si existía.
- El ejemplar deja de estar apartado: salió del local con su persona.

**Vacíos detectados**
1. **Entrega parcial de un pedido incompleto** — misma cuestión de unidad que F-COM-06 (vacío 1); se resuelve junto con ella.
2. **Verificación de identidad en el mostrador** — cómo se confirma que quien retira es (o representa a) quien reservó, sin cuenta.
3. **Registro del cobro** — ¿el flujo registra el pago (medio, monto) o solo lo contempla como paso? Alcance a definir para el piloto.

---

### F-CLI-01 · Explorar la edición

**Decisión humana**
*¿Qué salió esta semana?* Es la pregunta con la que alguien entra a su comiquería el día de novedades —previa a Nakama, al login y a cualquier personalización—. Nakama responde mostrando la edición; la **persona reconoce** qué le interesa. La relevancia no la calcula el sistema, la pone la propia persona ([D-010](decisiones-congeladas.md)).

**Objetivo**
Que la persona pueda ver la edición de la semana y recorrerla —encontrando lo que ya seguía o descubriendo algo nuevo— sin ningún compromiso.

> Dos comportamientos conviven en el mismo recorrido, no son dos flujos: **encontrar rápido lo que ya sigo** (continuidad) y **descubrir algo que no esperaba** (browse). La edición tiene que servir a los dos a la vez.

**Disparador**
La persona abre la edición pública: llega por el link que el comerciante compartió (típicamente WhatsApp) o vuelve a la tienda.

**Precondiciones**
- Existe una edición *En preventa* (publicada por F-COM-03). Sin publicar no hay nada que explorar.
- No requiere cuenta ni login: la persona puede ser anónima.

**Actores**
- **Persona / comunidad** — recorre. Anónima en el piloto.
- **Sistema** — presenta la edición **tal como el comerciante la compuso** (portada + lista). No personaliza, no reordena por relevancia, no recomienda ([D-010](decisiones-congeladas.md)).

**Pantallas involucradas**
- **Página pública · la edición** — la portada (si tiene tomos) + la lista de novedades. Es la misma composición de F-COM-02, ahora vista por la comunidad.

**Estados**
- La edición está *En preventa* (pública).
- Explorar es **lectura pura**: no cambia el estado de nada y **no deja huella** (las huellas nacen al reservar, no al mirar). No hay estado del lado de la persona (anónima, sin sesión).

**Casos alternativos**
- **CA-1 · Portada vacía** — la persona ve una lista pura ([D-006](decisiones-congeladas.md)); la edición es completa igual.
- **CA-2 · Barrido dirigido** — la persona busca lo que ya seguía y lo reconoce sola; el sistema no se lo destaca ([D-010](decisiones-congeladas.md)).
- **CA-3 · Sin objetivo previo** — se deja tentar por la portada y la lista (descubrimiento).
- **CA-4 · Aparece el "eso sí"** — algo la agarra; el flujo entrega a **F-CLI-02 · Reservar** en ese instante. Es el puente natural.

**Resultado esperado**
La persona sabe qué salió esta semana y reconoció qué le interesa (o nada). Sin compromiso ni rastro. Si algo la agarró, queda en posición de reservar (F-CLI-02).

**Vacíos detectados**
1. **¿Detalle de un tomo?** ¿Hay una vista/estado de detalle (tapa grande, precio, info) o todo vive *inline* en la edición (principio "todo ocurre en el lugar")? Afecta el puente a F-CLI-02.
2. **Explorar después del cierre** — si la persona abre el link una vez cerrada la preventa, ¿ve la edición sin poder reservar, o un estado "preventa cerrada"? Encadena con la fecha de cierre (vacío abierto) y F-COM-06.
3. **Ediciones anteriores** — ¿son explorables (la tienda como serie con memoria) o solo la edición vigente? Decisión de alcance, probablemente futura.

---

### F-CLI-02 · Reservar un tomo

**Decisión humana**
*"Lo quiero."* Es la intención más básica, previa a Nakama y al concepto mismo de reserva. La reserva es el **mecanismo** que transforma esa intención en una **promesa** entre la persona y la tienda: la persona pasa de *me interesa* a *lo quiero, guardámelo* — y queda **esperada**.

**Objetivo**
Permitir que la persona reserve un tomo de la edición, convirtiendo su intención en una promesa: la tienda queda comprometida a guardarle ese ejemplar.

**Disparador**
Explorando la edición (F-CLI-01), la persona encuentra el "eso sí" y decide reservarlo.

**Precondiciones**
- La edición está *En preventa*, con la preventa **abierta** (no cerrada).
- El tomo tiene precio (garantizado por [D-004](decisiones-congeladas.md)).

**Actores**
- **Persona** — expresa la intención ("lo quiero") y se identifica mínimamente. Aquí **deja de ser anónima**: reservar es su primera huella.
- **Tienda** — promete guardar el ejemplar. En el piloto la promesa es **inmediata y automática** ([D-011](decisiones-congeladas.md)): el comerciante no aprueba a mano.
- **Sistema** — crea la promesa en el acto, registra la huella y la refleja en el Workspace del comerciante (F-COM-04).

**Pantallas involucradas**
- **Página pública · la edición / el tomo** — el gesto de reservar.
- **Captura de identidad mínima** — nombre + contacto, *inline*, sin burocracia (ver Vacíos).
- **Confirmación** — la promesa existe; la persona queda esperada.
- *(Reflejo en el Workspace del comerciante — F-COM-04.)*

**Estados**
- Nace la **promesa** en su primer estado: *Reservado*.
- La promesa une **persona + ejemplar + tienda**. Su ciclo posterior (apartar → avisar → entregar, y sus ramas de muerte) vive en F-COM-06/07 y F-CLI-03/04 — se modelará ahí.
- Conceptualmente *intención* (persona) → *promesa* (tienda); en el piloto, un solo instante ([D-011](decisiones-congeladas.md)).

**Casos alternativos**
- **CA-1 · Preventa cerrada** — tras el cierre no nace promesa; la persona no puede reservar. Encadena con la fecha de cierre (vacío abierto) y F-COM-06.
- **CA-2 · Varios tomos** — la persona reserva más de un tomo: son **varias promesas** (una por ejemplar) que juntas forman un **pedido** (la canasta de esa persona). Unidades rigurosas: *ejemplar* ≠ *pedido*.
- **CA-3 · Cantidad > 1 del mismo tomo** — quiere dos copias (ej. una para regalar): ¿se permite cantidad, o una promesa por ejemplar? (ver Vacíos).
- **CA-4 · Volver más tarde** — sin cuenta, ¿cómo recupera y sigue su reserva? Puente a F-CLI-03.

**Resultado esperado**
Existe una **promesa** en estado *Reservado*: la tienda queda comprometida a guardar ese ejemplar para esa persona, que queda **esperada**. Aparece la primera huella de esa persona sobre la edición, visible para el comerciante en su Workspace (F-COM-04). La vidriera pública sigue **serena**: no muestra contadores de reservas —la densidad es memoria de vida del lado del comerciante, no prueba social para persuadir a la comunidad ([D-012](decisiones-congeladas.md)).

**Vacíos detectados**
1. **Identidad mínima para reservar** — es el momento en que la persona deja de ser anónima. ¿Qué pide: nombre + un canal de contacto (para avisar el retiro)? ¿Requiere cuenta, o basta el contacto? Encadena con F-CLI-03 (seguir la reserva sin login). *(Diseño en P-04/P-05: **Nombre + WhatsApp**, sin mail; se recuerdan para la próxima.)*
2. **Pago en la reserva — aclarado (ago 2026):** la promesa **nace sin dinero**. El pago **no** ocurre al reservar ni al retirar, sino **cuando la mercadería llega a la tienda**: la persona transfiere el total y adjunta el comprobante (ver P-06, estado *Listo (a pagar)*). Falta cerrar: confirmación del comprobante por la tienda y si algún modo lleva seña previa.
3. ~~**Cantidad por tomo**~~ — **RESUELTO (ago 2026):** se permite reservar **N copias** de un mismo tomo. Cada copia es un **ejemplar = una promesa**; N copias del mismo tomo = N promesas dentro del mismo **pedido**. La cantidad se define con un stepper (− / +) en P-04, tanto al seleccionar como en "Tu pedido".

---

### F-CLI-03 · Seguir una reserva

**Decisión humana**
*¿Mi reserva sigue en pie?*

**Objetivo**
Permitir que una persona consulte el estado actual de una reserva existente, sin necesidad de crear una cuenta.

**Disparador**
La persona quiere saber si su reserva sigue vigente o si ya puede retirarla.

**Precondiciones**
- Existe una reserva (promesa) creada en F-CLI-02.
- No requiere cuenta ni contraseña.

**Actores**
- **Persona** — consulta su reserva.
- **Sistema** — le muestra el estado actual.

**Pantallas involucradas**
- **Vista pública de la reserva** — dónde la persona ve su reserva y su estado. La superficie concreta depende del mecanismo de acceso (ver Vacíos).

**Estados**
- La persona ve el estado de la promesa: *vigente* (reservado / apartado) · *lista para retirar* · *finalizada* (retirada / cancelada / vencida). El ciclo completo de la promesa se modela en F-COM-06/07 y F-CLI-04.

> **Observación:** la mayor parte del tiempo este caso de uso se usa para confirmar que una reserva sigue vigente. El momento del retiro normalmente llega por una notificación ([SYS-03](automatizaciones.md)); consultar activamente el estado **no** debería ser el camino principal para enterarse de que ya puede retirarse.

**Casos alternativos**
- **CA-1 · Lista para retirar** — la persona lo ve; normalmente ya se enteró por notificación ([SYS-03](automatizaciones.md)).
- **CA-2 · Todavía no lista** — sigue vigente; no hay acción, continúa esperando.
- **CA-3 · Finalizada** — la reserva ya fue retirada, cancelada o vencida; se ve su estado final.
- **CA-4 · No encuentra su reserva** — perdió el acceso, cambió de dispositivo o nunca guardó el enlace. Es el caso que define el vacío principal.

**Resultado esperado**
- La persona encuentra su reserva.
- Puede confirmar que sigue vigente.
- Puede conocer si ya está lista para retirar.
- Si todavía no está lista, simplemente continúa esperando.

**Vacíos detectados**
1. ⭐ **Mecanismo de recuperación de una reserva sin cuenta** *(principal)* — cómo una persona anónima vuelve a encontrar y reconocer como propia su reserva, y cómo recupera el acceso si pierde el enlace o cambia de dispositivo. Opciones abiertas: enlace único, código, teléfono, mail, WhatsApp, nombre + teléfono, etc. Probablemente **una de las decisiones arquitectónicas más importantes del MVP** del lado del cliente. No resolver el mecanismo todavía; sí reconocer que este caso de uso lo destapa.
2. **Estados visibles para la persona** — cuáles de los estados de la promesa se le muestran y con qué nombres (depende del ciclo modelado en F-COM-06/07).

---

### F-CLI-04 · Cancelar una reserva

**Decisión humana**
*Ya no quiero mantener esta reserva.* El motivo puede variar (cambié de idea, ya lo conseguí, me equivoqué, no llego con la plata, no voy a poder retirarlo…); la intención es siempre la misma e independiente del motivo.

**Objetivo**
Permitir que una persona termine una reserva existente que ya no desea mantener.

**Disparador**
La persona llega con la intención de no continuar con su reserva.

**Precondiciones**
- Existe una reserva (promesa) vigente creada en F-CLI-02.
- La reserva está en un estado que admite cancelación (ver Vacío principal).
- No requiere cuenta: mismo acceso que F-CLI-03.

**Actores**
- **Persona** — decide terminar su reserva.
- **Sistema** — termina la promesa, libera el ejemplar y refleja el cambio en el Workspace del comerciante (F-COM-04).

**Pantallas involucradas**
- **Vista pública de la reserva** — comparte superficie con F-CLI-03: se cancela desde donde se ve la reserva.
- **Confirmación de cancelación**.

**Estados**
- La promesa pasa de *vigente* a *cancelada* — una de las ramas de muerte de la promesa **por decisión de la persona**, distinta de *vencida* ([SYS-02](automatizaciones.md)) y de *caída*.
- El ejemplar reservado se libera.

**Casos alternativos**
- **CA-1 · Motivo opcional** — el sistema puede preguntar por qué, sin obligar; el flujo no depende del motivo ([D-013](decisiones-congeladas.md)).
- **CA-2 · Reserva no cancelable** — según la regla de negocio (ver Vacíos), en ciertos estados la cancelación desde la app puede no estar permitida; la persona se deriva a contactar a la tienda.
- **CA-3 · Seña / pago** — si la reserva tenía seña o pago, hay que definir qué ocurre con ese dinero (ver Vacíos).

**Resultado esperado**
- La reserva queda cancelada.
- La persona deja de estar esperada.
- El ejemplar se libera (un tomo menos que apartar/pedir para el comerciante).

**Vacíos detectados**
1. ⭐ **¿Hasta qué momento una reserva puede cancelarse?** *(principal)* — regla de negocio que depende del funcionamiento real de las tiendas: ¿hasta el cierre de preventa? ¿hasta que llega el tomo? ¿hasta que fue apartado? ¿si pagó seña? ¿si ya está lista para retirar? No inventarla; dejar abierta hasta conocer el oficio.
2. **Seña / dinero al cancelar** — si hubo seña o pago, qué ocurre con ese dinero. Encadena con el vacío de pago de F-CLI-02.
