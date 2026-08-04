> **Documento histórico.** La fuente de verdad vigente para Retail es `docs/pdd/`.

# Diseño funcional — Flujo de Retail (el Drop semanal)

> **Documento de diseño funcional y de experiencia. No es implementación, no es arquitectura, no es Execution
> Plan.** Toma como base [docs/retail-ux-review.md](retail-ux-review.md) y
> [docs/vision/retail-product-vision.md](../../../vision/retail-product-vision.md). Describe *la experiencia*, no pantallas,
> modelos ni componentes.

**Marco:** el objetivo no es "crear preventas". Es **gestionar el Drop semanal** de una comiquería, y que ese
trabajo se sienta como **una historia continua**, no como una colección de formularios. El foco es Agustín y su
semana real. No estamos diseñando el producto final; estamos diseñando el mejor flujo posible para su problema
principal.

---

## 1. El recorrido completo (la historia, todavía sin pantallas)

La semana de una comiquería tiene un **pulso**. El producto debería latir con ese pulso. La historia tiene dos
mitades con temperaturas distintas: una **tranquila** (preparar) y una **viva** (gestionar).

**Empieza la semana.** Agustín sabe que llegan novedades. Su cabeza no dice "voy a crear una campaña": dice
*"¿qué sale esta semana?"*. El producto debería recibirlo con esa pregunta ya respondida o a punto de responderse,
no con una hoja en blanco.

**Llega la lista.** Las novedades entran —pegadas, importadas, o cargadas a mano—. Este es el momento de mayor
valor y hoy el de mayor fricción. Debería sentirse como *"acá está tu semana"*, no como *"completá este
formulario"*. La lista es el **material crudo** del Drop.

**Se revisa y se corrige.** Agustín es el curador. Mira lo que llegó, saca lo que no le interesa, ajusta precios,
destaca lo importante, agrega algo que faltó. Es un trabajo de **juicio**, no de tipeo. El producto le muestra el
Drop *casi armado* y él lo deja como quiere. Esta etapa es privada: nadie afuera lo ve todavía.

**Se publica.** Un solo acto que **cambia el estado del mundo**: lo que era un borrador privado se convierte en
algo que su clientela puede ver y reservar. Este momento tiene que sentirse importante —es el hito de la semana—.
Después de publicar, el trabajo cambia de naturaleza: de *armar* a *atender*.

**Llegan las reservas.** El Drop cobra vida. La gente reserva tomos, promete plata, elige retirar. Agustín quiere
sentir ese pulso: cuántos reservaron, cuánto se movió, qué se está agotando. La preventa dejó de ser un documento
y pasó a ser **un negocio en marcha**.

**Se administra.** Acá vive el día a día: registrar pagos, pedir al proveedor, marcar lo que llegó, avisar a la
clientela, entregar. Hoy esto está roto en seis pantallas; en la experiencia nueva es **un solo lugar** donde
Agustín trabaja sobre sus reservas sin cambiar de contexto. La pregunta que se hace cambia ("¿quién me debe?",
"¿qué preparo?", "¿a quién aviso?"), pero **el lugar no**.

**Se cierra.** El arco termina. La preventa pasó de idea a entrega. El cierre no es un botón perdido: es el
**final de la historia** de esa semana, y lo que quedó registrado alimenta la próxima (qué se vendió, qué reponer).

La clave narrativa: **cada etapa hereda de la anterior y prepara la siguiente.** Nunca se vuelve a empezar. La
información fluye hacia adelante y el usuario siempre siente que *avanza*, no que rellena.

---

## 2. Las unidades de trabajo (desde la mirada del usuario)

El producto necesita una **gramática** que el usuario entienda sin pensar. Cuatro sustantivos:

- **El Drop.** Es *la semana de novedades*. La unidad de trabajo del comerciante, la que marca su ritmo. Agustín
  no gestiona entidades: gestiona **su Drop de esta semana**. Es un contenedor con temporalidad y cadencia: nace,
  se prepara, se publica, se atiende, se cierra. Es como el usuario **piensa su trabajo**.

- **La Preventa (la publicación).** Es *lo que la clientela ve y reserva*. Cuando Agustín publica un Drop, este se
  convierte en una preventa: la cara pública, con tomos, precios y fechas. Un Drop es el trabajo; la preventa es su
  **manifestación pública**. Para el usuario son casi la misma cosa vista desde dos lados —el suyo (preparar) y el
  del cliente (comprar)—.

- **La Reserva.** Es *el compromiso de un cliente*: qué tomos apartó, cuánto va a pagar, cómo lo retira. Es la
  unidad que Agustín **atiende una por una** en la segunda mitad de la historia. Cada reserva es una persona con un
  pedido y un estado.

- **El Tomo.** Es *lo que se vende*: un ítem del Drop. El usuario piensa "tomos" (o "productos"), nunca "ofertas".
  Puede venir del catálogo o cargarse a mano; para él es simplemente **una cosa que puso en la preventa de la
  semana**.

**Cómo se relacionan, en una frase que Agustín entendería:**
*"Cada semana preparo un **Drop** con los **tomos** que salen. Cuando lo publico, mi clientela lo ve como una
**preventa** y me hace **reservas**, que yo atiendo hasta entregar."*

Nótese lo que **no** aparece: campaña, oferta, orden, fulfillment, línea. Esa es la traducción que el producto
debe absorber para que el usuario nunca la vea.

---

## 3. El tablero principal (qué debe transmitir)

El tablero es lo primero que ve Agustín y hoy es lo más pobre. Debe responder, **de un vistazo y sin entrar**, la
pregunta de dueño: *"¿cómo va mi negocio esta semana?"*.

**¿Qué quiere saber cuando entra?**
- ¿Hay un Drop en marcha? ¿En qué momento está?
- ¿Cuánto se reservó y cuánta plata se movió?
- ¿Hay algo que **requiere mi atención hoy** (pagos pendientes, mercadería que llegó y no avisé, gente esperando
  retirar)?
- ¿Qué viene? ¿Ya empiezo a preparar el próximo?

El tablero **no es un archivo de campañas**: es un **panel de control del pulso semanal**. Debería estar organizado
por el **momento del ciclo** —lo que se está preparando, lo que está en venta, lo que se está cerrando— para que la
mirada caiga primero en lo vivo.

**¿Qué merece una tarjeta?** Cada Drop/preventa es una tarjeta que **cuenta su propia historia** sin obligar a
entrar:
- su nombre humano y a qué semana pertenece,
- su **estado como señal visual** (no como texto de enum),
- cuántos tomos incluye,
- **cuántas reservas** y **cuánto monto** — exactamente lo que hoy hay que excavar,
- una señal de **avance/salud** (cuánto de esto ya está pagado / pedido / llegado / entregado),
- y, si algo reclama atención, una **marca de urgencia** visible.

**¿Qué acciones rápidas?** Las que evitan entrar para lo obvio, **contextualizadas al estado**: un borrador ofrece
*seguir preparando / publicar / duplicar / descartar*; una preventa en venta ofrece *ver reservas / compartir link
/ cerrar*. Regla de contención: **una acción primaria visible + un menú para el resto**, para que el tablero no se
convierta en una botonera. Y **Duplicar** merece protagonismo: es lo que convierte "abrir la preventa de esta
semana" en un gesto de un clic, aprovechando que el trabajo semanal se repite.

El tablero exitoso hace que Agustín **entienda su semana en tres segundos** y sepa *dónde tocar* para lo único que
hoy importa.

---

## 4. El Workspace (cómo debería sentirse trabajar dentro de una preventa)

Abrir una preventa debería llevar a **un único lugar donde vive todo**. La sensación objetivo es la de un *espacio
de trabajo* (como una issue de Linear o una página de Notion), no la de un formulario con pestañas que te expulsan
a otras URLs.

**Qué información vive junta —siempre en el mismo lugar:**
- La **identidad** del Drop: su nombre, su semana, su estado, y las **acciones principales del momento**.
- Los **tomos incluidos**: agregar desde catálogo o a mano, ver precios y descuentos, sin salir. Idealmente **carga
  en lote**, porque la semana llega como lista.
- Las **reservas**: una **sola vista viva** donde cada fila es un cliente con su pedido y su **estado combinado**
  (pagó / se pidió / llegó / listo / entregado). Es el corazón de la segunda mitad de la historia.
- La **actividad**: qué pasó y cuándo. Da sensación de sistema vivo y de control.

**Lo que nunca debería obligar a navegar:** las cuatro preguntas operativas del día —cobrar, pedir/recibir,
preparar/entregar, avisar— **no son destinos**. Son **acciones sobre la reserva que estás mirando** y **filtros**
de la misma vista ("con saldo", "llegó sin avisar", "listo para retirar"). El usuario **cambia de filtro o actúa en
la fila; no cambia de pantalla**. Esa es la diferencia entre un workspace y las seis páginas actuales.

**Qué cambia según el estado** (ver §5): el workspace **no muestra todo siempre**. En borrador enseña las
herramientas de *armar*; recién al publicar aparecen las de *atender*. La complejidad se revela cuando toca, no
antes.

El principio del workspace: **una preventa = un lugar.** Si Agustín tuvo que abrir otra pantalla para responder una
pregunta sobre su preventa, fallamos.

---

## 5. Estados (el ciclo de vida y qué cambia para el usuario)

Cuatro estados, pero lo importante no es la lista: es **qué se transforma en la experiencia** al cambiar de uno a
otro. El estado no es una etiqueta; es un **modo del producto**.

- **Borrador — "lo estoy preparando".**
  *Qué ve/hace el usuario:* el foco total es **armar** (cargar y curar tomos, precios, destacados). La acción
  heroica y única es **Publicar**. No aparecen reservas, pagos ni entregas: no existen todavía, y mostrarlos sería
  ruido. Es un espacio **privado**; nadie afuera lo ve. Se puede **descartar** sin consecuencias.

- **Transición: Publicar.** Es el hito. El producto debería **cambiar de tono** visiblemente: lo privado se vuelve
  público, aparece el **link para compartir** como protagonista ("mostrale esto a tu clientela"), y el workspace
  *muta de modo*: se apagan las herramientas de armado y se encienden las de gestión. El usuario **siente** que
  cruzó un umbral.

- **En venta — "está vivo".**
  *Qué cambia:* aparece el **pulso de reservas** (cuántas, cuánto monto, qué se agota) y la **vista de reservas**
  como centro de gravedad. El trabajo pasa de *armar* a *atender*. La descripción todavía puede editarse, pero la
  estructura ya es pública y estable. Acá vive el día a día.

- **Transición: Cerrar.** Marca el fin de la recepción de reservas. No debería sentirse como apagar una luz, sino
  como **cerrar un capítulo**: lo que sigue es terminar de entregar y cobrar lo pendiente.

- **Cerrada — "ya no recibe, se termina de despachar".**
  *Qué cambia:* se corta la entrada de nuevas reservas; el foco queda en **completar** (entregas y pagos
  pendientes). Es lectura de *cierre*, con la historia casi completa. Alimenta la inteligencia de la próxima semana.

- **Cancelada — "se descartó".** (Estado de excepción.) Lectura **atenuada/tachada**: existió pero no va. Preserva
  el registro sin ensuciar la vista activa.

La regla transversal: **el estado decide qué es relevante.** Cada momento del ciclo **revela solo lo pertinente** y
**esconde lo que todavía no toca**. Así el producto acompaña la historia en lugar de abrumar con todo a la vez.

Comunicación visual de los estados: color + etiqueta humana + (donde sirva) **progreso**. Nunca un enum en
mayúscula en la cara del usuario. Un borrador se ve neutro y "en preparación"; una preventa en venta, viva y con su
avance; una cerrada, completa pero apagada; una cancelada, descartada.

---

## 6. Drops vs Campañas (exploración, sin decidir)

Hay **dos tipos de trabajo** que hoy no distinguimos y conviene pensar:

- **El Drop semanal.** Recurrente, guiado por la **cadencia**. Su valor está en la *repetición eficiente*: la misma
  coreografía todas las semanas. El usuario lo vive como **rutina**: "el drop de esta semana".
- **La campaña comercial.** Puntual, temática, guiada por un **evento** (Día del Niño, Black Friday, aniversario de
  la tienda). Su valor está en la *ocasión*: una selección curada alrededor de un motivo. El usuario lo vive como
  **proyecto especial**.

**¿Conviven?** Casi seguro sí. Una comiquería tiene su pulso semanal *y* hace acciones especiales. Ignorar
cualquiera de los dos empobrece el producto.

**¿Comparten experiencia?** Acá está la pregunta interesante. Ambos terminan en **lo mismo desde afuera**: algo
**publicado** que la clientela ve y **reserva**, y que la tienda **gestiona** igual (pagos, llegada, entrega). La
segunda mitad de la historia —reservas y gestión— es **idéntica**. Lo que difiere es la **primera mitad**: cómo
nace y cómo se arma.

Esto sugiere una hipótesis que vale explorar (no decidir): **el objeto publicado podría ser uno solo —una
"publicación" o "preventa"— y el Drop y la campaña serían dos *maneras de originarla*.** El Drop nace de la lista
semanal y de la cadencia; la campaña nace de un tema y una fecha. Pero una vez publicadas, se atienden con la misma
experiencia. Bajo esta hipótesis, el usuario aprende **un solo modelo de gestión** y solo cambia el **punto de
entrada**.

**¿El usuario los percibe distintos?** Probablemente **al crear/preparar, sí**; **al gestionar, no**. "Preparar mi
drop de la semana" y "armar la campaña de Black Friday" se sienten distintos en la cabeza. Pero "cobrarle a Juan y
avisarle que llegó" se siente igual en ambos casos. Un buen diseño podría **honrar esa diferencia en la entrada** y
**unificarla en la gestión**.

**¿"Nueva publicación" en vez de "Nueva preventa"?** Es una opción atractiva porque **abstrae el origen**: una
publicación puede ser un drop o una campaña. Alternativas a sopesar:
- *"Nueva preventa"* — concreto y entendible, pero puede quedar chico si el objeto también sirve para campañas o,
  a futuro, para venta directa sin preventa.
- *"Nueva publicación"* — más amplio y a prueba de futuro, pero más abstracto y menos evocador para el comerciante.
- *Entradas separadas por intención* — "Nuevo drop" / "Nueva campaña" como dos puertas que llevan al mismo tipo de
  trabajo publicado. Máxima claridad de propósito, a costa de más superficie.

No hay que resolverlo ahora. Lo que **sí** conviene fijar como intuición de diseño: **la gestión de reservas debe
ser una sola experiencia**, venga de un drop o de una campaña; y **el origen** es donde tiene sentido diferenciar.

---

## 7. Principios de UX (específicos, no los de la visión)

Guías concretas de experiencia para futuras implementaciones. Complementan —no repiten— los principios de producto
de la visión.

- **Minimizar el cambio de contexto.** La unidad de trabajo (la preventa) vive en un lugar. Cambiar de *pregunta*
  no debería costar cambiar de *pantalla*.

- **Una tarea, un lugar.** Cada trabajo se resuelve donde está su dato: se le cobra a la reserva que estás mirando,
  no en una sección "Pagos" aparte.

- **El estado maneja la interfaz.** La pantalla se adapta al momento del ciclo: muestra lo pertinente y esconde lo
  que todavía no toca. La complejidad se **revela progresivamente**.

- **Filtros, no URLs.** Las distintas miradas sobre las reservas ("con saldo", "listo para retirar") son facetas de
  una misma vista, no destinos de navegación.

- **La lista es el producto.** El tablero no es un índice para llegar a otro lado: es donde el dueño **entiende y
  decide**. Debe cargar significado (reservas, monto, urgencia), no solo nombres.

- **Actuar donde se mira.** Las acciones viven junto a la información que las motiva: en la fila, en la tarjeta, en
  el encabezado del workspace. Nada de "andá a otra pantalla para hacer esto".

- **Narrativa por sobre formularios.** El producto cuenta una historia continua; cada paso hereda del anterior. Se
  siente como *avanzar*, no como *rellenar*.

- **Un gesto, sus consecuencias.** Los momentos reales ("llegó la mercadería", "cerré la preventa") son un solo
  acto para el usuario; el sistema propaga el resto. Se mide la fricción en cuántas veces la persona repite algo que
  el sistema ya sabe.

- **Lenguaje del negocio, no del esquema.** Todo lo que el usuario ve habla su idioma —preventa, tomos, reservas—;
  la traducción a las entidades internas es invisible.

- **Reconocer el pulso.** El diseño respeta la cadencia semanal: recibir la semana, prepararla, publicarla,
  atenderla, cerrarla, y facilitar **empezar la próxima** (duplicar, continuidad). El producto late con el negocio.

- **Mostrar salud, no solo datos.** Preferir señales interpretables (avance, urgencia, pulso) por sobre tablas
  crudas: el usuario quiere *entender de un vistazo*, no *leer registros*.

- **Mobile como primera clase.** El tablero de tarjetas y las acciones-en-fila tienen que funcionar en el teléfono:
  una fila de reserva debe poder leerse y operarse como tarjeta apilable, no como una tabla de seis columnas.

---

*Este es diseño funcional. El siguiente paso natural —cuando se decida avanzar— son flujos/wireframes de baja
fidelidad del Tablero y del Workspace, todavía sin código. Nada aquí es trabajo aprobado ni Execution Plan.*
