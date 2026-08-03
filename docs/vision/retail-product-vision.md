# Documento de Visión — Futuro de Retail

> **Este documento registra ideas de evolución del producto. Ningún punto debe considerarse aprobado
> para implementación hasta tener su propio diseño funcional, revisión arquitectónica y Execution Plan.**

Es un **documento vivo**: captura oportunidades estratégicas que surgieron durante el diseño del producto, para que no se pierdan. No es roadmap, no es backlog, no es trabajo comprometido, y no cambia las prioridades vigentes.

---

## Contexto y no-objetivos

El foco actual del proyecto **sigue siendo**:

- la **UX de Retail**,
- el **flujo de Drops** (el ciclo semanal de novedades y preventas),
- la **automatización del proceso semanal de novedades**.

Este documento **no** compite con esa prioridad ni la reordena. Simplemente deja registradas ideas para futuras discusiones. Todo lo que sigue está escrito con voz de Product Designer: describe *oportunidades y experiencias*, no arquitectura, modelos de datos, clases ni APIs.

Una aclaración de vocabulario: uso **"Drop"** para referirme al pulso semanal de la comiquería —las novedades que salen, se anuncian y se preventan cada semana—. Es la unidad de trabajo real del negocio, y buena parte de esta visión consiste en hacer que el producto gire alrededor de ese pulso.

---

## 1. Automatización completa del Drop semanal

Hoy abrir una preventa es un acto manual de principio a fin. La oportunidad grande es que **el Drop semanal se administre casi solo**, desde que las novedades de la semana entran al sistema hasta que la preventa queda publicada y lista para compartir.

La visión no es "un botón que hace todo", sino **una cinta transportadora asistida**: las novedades de la semana aparecen, el sistema propone una preventa armada (tomos, precios sugeridos, textos), el usuario revisa y ajusta, y publica. El trabajo del dueño pasa de *cargar* a *curar y aprobar*. La semana deja de empezar con una hoja en blanco.

El valor central es el **tiempo y la repetición**: una comiquería repite la misma coreografía todas las semanas. Cuando el producto conoce esa coreografía, cada Drop cuesta minutos en lugar de horas, y la calidad es consistente sin depender de la memoria de la persona.

Un matiz de diseño importante: la automatización debe ser **asistiva y reversible**, nunca una caja negra. El humano siempre entiende qué se propuso y por qué, y puede intervenir en cualquier paso. La máquina prepara; la persona decide.

---

## 2. Importación mediante Excel

La carga manual **va a seguir existiendo** —es imbatible para casos puntuales, correcciones y tiendas chicas—. Pero para una librería real, la novedad de la semana llega como **una lista**: una planilla del distribuidor, un Excel propio, un pegado desde otra herramienta. Ese es, con alta probabilidad, el **flujo principal a escala**.

La oportunidad es tratar la importación no como una función técnica ("subir archivo") sino como una **experiencia de entrada de la semana**: pegás/subís tu lista, el producto la entiende, te muestra qué reconoció y qué no, te deja resolver las dudas, y de ahí sale un Drop casi listo. La planilla deja de ser un trámite y se convierte en la **puerta de entrada natural** al trabajo semanal.

El principio subyacente (ver §Principios): esa información se ingresa **una sola vez** y alimenta todo lo que viene después —publicación, reservas, pedidos, comunicaciones—. La planilla no es "un import"; es el **origen único** del Drop.

---

## 3. Generación automática de comunicaciones

Toda la información para comunicar **ya está cargada** en el momento de armar el Drop: qué salió, a cuánto, hasta cuándo se preventa, qué es novedad destacada. Hoy el dueño vuelve a escribir todo eso a mano en WhatsApp, en un mail, en Instagram. Es reingreso puro de datos que el sistema ya tiene.

La oportunidad es que el producto **genere los borradores de comunicación** a partir del Drop: el mensaje de WhatsApp para el grupo de clientes, el newsletter de la semana, el texto/imagen para redes. Siempre como **borrador editable** —el dueño le pone su voz—, nunca como envío automático a ciegas.

Esto conecta con la identidad de la tienda: **la comunicación es de la tienda, no de Nakama.** El producto redacta el primer borrador con los datos correctos; el comerciante mantiene el tono, la marca y la relación con su clientela. El valor es eliminar el reingreso y la fricción de "ahora tengo que avisar en cinco lados".

---

## 4. Catálogo propio de cada tienda

Hoy hay **un catálogo global** (la verdad bibliográfica compartida: qué obras y tomos existen). A futuro conviene distinguir conceptualmente **dos cosas que hoy se confunden**:

- **El catálogo global** — la referencia bibliográfica común, curada, que todas las tiendas comparten. Es *qué existe en el mundo*.
- **El catálogo operativo de una tienda** — *qué maneja esta tienda en particular*: qué vende, a qué precio, con qué disponibilidad, con qué nombre o descripción propios, qué tomos le interesan y cuáles no.

La analogía útil: el catálogo global es *la enciclopedia*; el catálogo operativo es *la góndola de esta comiquería*. Una comiquería no vende "todo lo que existe"; vende su selección, con sus condiciones. Separar ambos planos permite que cada tienda tenga su propia representación sin ensuciar la verdad compartida, y sin que dos tiendas se pisen. El catálogo global sigue siendo la autoridad; el operativo es la lente de cada negocio sobre esa autoridad.

---

## 5. Gestión de stock

Una vez que existe el catálogo operativo de una tienda, aparece naturalmente la pregunta: **¿cuánto tengo de cada cosa?** La oportunidad es que una tienda pueda administrar su **stock** apoyándose en el catálogo que ya existe, sin volver a describir productos.

Conceptualmente, stock es una capa fina sobre el catálogo operativo: *de esto que manejo, tengo tanto*. No es un sistema de inventario industrial; es la información mínima que una comiquería necesita para saber qué puede vender ya, qué está agotado, y qué conviene reponer. La oportunidad de producto es **que el stock viva pegado al catálogo y al flujo de ventas**, no como un módulo aparte que hay que mantener sincronizado a mano.

(Solo se registra la oportunidad; el cómo queda fuera de este documento.)

---

## 6. Recepción de mercadería

El complemento natural del stock es su **entrada**. Cuando llega la mercadería —incluida la que se preventó—, ese ingreso debería **actualizar el stock automáticamente**, en lugar de obligar a un segundo registro manual.

La visión es que el momento físico ("llegó la caja del distribuidor") tenga un reflejo digital de bajo esfuerzo, y que ese mismo evento **cierre varios ciclos a la vez**: sube el stock, marca como "llegó" lo que estaba preventado, y habilita avisar a los clientes que ya pueden retirar. Un solo gesto humano ("recibí esto") que el sistema propaga a todo lo que dependía de esa llegada. Otra vez el mismo principio: **registrar una vez, reutilizar en todo el flujo.**

---

## 7. Venta online

Existe la posibilidad de que Nakama evolucione hacia una **tienda online especializada para comiquerías**. El punto estratégico —y la trampa a evitar— es claro:

**No se trata de competir en cantidad de funciones con Shopify o Tienda Nube.** Esos productos son excelentes tiendas *generalistas*, y perseguirlos feature-por-feature es una carrera perdida y sin sentido.

La tesis es la **especialización**: resolver *mejor que nadie* el negocio concreto del **manga, los cómics y las preventas**. Eso incluye cosas que una tienda genérica maneja mal o no maneja: la lógica de tomos y colecciones, las novedades semanales, las **preventas de material que todavía no salió**, la relación con una clientela que colecciona y sigue series, el catálogo bibliográfico rico. Una comiquería no necesita "otra Tienda Nube"; necesita una herramienta que **entienda su rubro**. El diferencial no es amplitud, es **profundidad de dominio**.

---

## 8. Inteligencia comercial

A medida que el sistema acumula la historia real de una tienda —qué se preventó, qué se vendió, qué llegó, qué se agotó—, aparece la oportunidad de **devolverle inteligencia al comerciante**. Sin diseñarlas, quedan registradas estas líneas:

- **Sugerencias de reposición** — qué conviene volver a pedir, según lo que se movió.
- **Historial de ventas** — la memoria comercial de la tienda, consultable y útil.
- **Recomendaciones de compra** — qué sumar al próximo pedido al distribuidor.
- **Análisis de tendencias** — qué series/autores/editoriales están traccionando.
- **Productos agotados** — visibilidad de lo que falta y su demanda insatisfecha.

El hilo conductor: la tienda ya está generando estos datos como **subproducto** de operar en Nakama. La inteligencia comercial no pide cargar nada nuevo; **cosecha** lo que el flujo diario ya produjo. Es la culminación natural del principio de reutilización: la información ingresada una vez, al final del recorrido, **vuelve al dueño convertida en decisiones**.

---

## Principios de producto

Estos principios no son definitivos: se registran para futuras discusiones. Son la brújula que debería guiar cómo evoluciona Retail.

### P1 — La información se ingresa una sola vez y se reutiliza en todo el flujo

El principio rector. Un dato entra **una vez** y sirve para todo lo que sigue:

> importar una vez → reutilizar para publicar → para reservas → para pedidos → para stock → para recepción → para comunicaciones → para inteligencia comercial.

Cada vez que le pedimos al usuario que reingrese algo que el sistema ya sabe, fallamos. El norte es un **flujo sin reingreso**, donde cada etapa consume lo que produjo la anterior.

### P2 — Una sola fuente de verdad, muchas lentes

Separar lo que *es* de lo que *se muestra/opera*. El catálogo global es la verdad; el catálogo operativo, el stock, la preventa y las comunicaciones son **lentes** sobre esa verdad para distintos propósitos. Nunca duplicar la verdad; sí ofrecer vistas especializadas.

### P3 — Especialización antes que amplitud

Ganar por **profundidad de dominio** (manga, cómics, colecciones, preventas), no por cantidad de funciones. Cada decisión se mide contra "¿esto resuelve mejor el negocio específico de la comiquería?", no contra "¿esto lo tiene Shopify?".

### P4 — El producto se adapta al negocio, no al revés

La coreografía real de una comiquería (el pulso semanal del Drop, la recepción de cajas, el aviso a la clientela) es el punto de partida del diseño. El software debe **calzar sobre esa realidad**, no obligar al comerciante a pensar como una base de datos. La UI habla el idioma del negocio, no el del esquema.

### P5 — Automatización asistiva y reversible

La máquina **prepara**; la persona **decide**. Toda automatización (armar el Drop, redactar comunicaciones, sugerir reposición) se presenta como borrador transparente y editable, nunca como caja negra irreversible. El humano mantiene el control y la comprensión en cada paso.

### P6 — La tienda es dueña de su voz y sus datos

El catálogo operativo, las comunicaciones, la clientela y la historia comercial **son de la tienda**. Nakama es la herramienta que potencia esa relación, no un intermediario que la reemplaza ni la homogeneiza. La marca, el tono y el vínculo con los clientes siguen siendo del comerciante.

### P7 — Un gesto humano, muchos efectos

Los momentos del mundo real ("llegó la mercadería", "cerré la preventa") deberían requerir **un solo acto** del usuario y dejar que el sistema propague todas sus consecuencias. Menos gestos, más propagación. La fricción se mide en cuántas veces la persona tiene que decirle al sistema algo que ya es cierto.

---

*Fin del documento vivo. Agregar ideas nuevas a medida que surjan; ninguna es compromiso hasta pasar por su propio diseño, revisión y Execution Plan.*
