> **Documento histórico.** La fuente de verdad vigente para Retail es `docs/pdd/`.

# Diseño del Piloto — La primera versión de Retail que usará Agustín

> **Documento de Product Design. No es implementación, arquitectura, Execution Plan ni trabajo aprobado.**
> Cierra la trilogía de [UX Review](retail-ux-review.md) · [Product Vision](../../../vision/retail-product-vision.md) ·
> [Workflow Design](retail-workflow-design.md). Responde una sola pregunta: *si solo tuviéramos tiempo para una
> primera versión, ¿cuál es el piloto que enamora a Agustín sin construir el producto completo?*

---

## El objetivo real del piloto (no es el que parece)

El piloto **no** se mide en funcionalidades. Se mide en una emoción: que Agustín, después de correr **una semana
real** por Nakama, sienta *"esto es mío, esto entiende mi negocio, no quiero volver atrás"*.

Eso cambia todo el criterio de recorte. No preguntamos "¿qué es lo mínimo que funciona?" (eso da un backoffice
pobre). Preguntamos **"¿cuál es el conjunto más chico de cosas que produce orgullo, alivio y ganas de seguir?"**.
Un piloto puede tener menos features y aun así enamorar, si las que tiene son las que *importan emocionalmente*.

Criterio de éxito del piloto, en una frase: **Agustín gestiona un Drop real de punta a punta —preparar, publicar,
recibir reservas, atenderlas, cerrar— y en el camino tiene al menos un momento en que sonríe.**

---

## ¿Qué entra sí o sí? (la columna vertebral irrenunciable)

Cada punto está acá porque **sin él el piloto no cuenta la historia** o no produce la emoción. No por ser fácil.

1. **Un tablero que muestra el pulso, no una lista de nombres.**
   Es lo primero que ve y define si esto se siente "producto" o "planilla con estilo". Debe comunicar de un
   vistazo: qué Drop está vivo, cuántas reservas, cuánto monto, qué reclama atención. *Por qué irrenunciable:* es
   el corazón del cambio de paradigma; sin el pulso volvemos al backoffice que ya rechazamos.

2. **Un workspace único para preparar y atender la preventa.**
   Todo el trabajo de un Drop en un solo lugar: cargar tomos, poner precios, publicar y —después— ver y gestionar
   reservas. *Por qué irrenunciable:* la fragmentación en pantallas fue el defecto central del UX Review. Si el
   piloto vuelve a dispersar el trabajo, reproducimos el problema que vinimos a resolver.

3. **Cargar los tomos de la semana con poca fricción.**
   Entrada rápida (aunque sea manual/ágil, no importación masiva todavía). *Por qué irrenunciable:* es el inicio de
   la historia; si armar la semana duele, Agustín se cae en el primer paso.

4. **Publicar y obtener una página pública que se vea como una tienda moderna de verdad.**
   Un link que Agustín pueda mandarle a su clientela y quedar **bien parado**. *Por qué irrenunciable:* es
   la cara de **su** negocio y el momento de mayor orgullo (ver "WOW"). Una preventa que se ve amateur haría lo
   contrario de enamorar: lo avergonzaría frente a sus clientes.

5. **Recibir reservas y gestionarlas en el mismo lugar, con lo esencial.**
   Registrar pago, marcar que llegó, marcar entregado —como acciones sobre la reserva, no como pantallas aparte—.
   *Por qué irrenunciable:* "recibir y administrar reservas" es **la mitad de la historia**. Un piloto que publica
   pero no deja atender reservas no es un piloto del trabajo semanal; es una demo.

6. **Estados como lenguaje visual y terminología de negocio.**
   Borrador / En venta / Cerrada con color y etiqueta humana; "preventa / tomos / reservas" en todos lados.
   *Por qué irrenunciable:* es barato y es exactamente lo que hace que **no se sienta técnico**. Es el 20% de
   esfuerzo que da el 80% de la sensación de "producto".

Esta columna es **una historia completa y digna**: empieza la semana, la armo, la publico con orgullo, la
clientela reserva, yo atiendo, cierro. Nada acá es opcional sin romper el arco.

---

## ¿Qué aporta mucho valor pero puede esperar?

Cosas que Agustín va a querer pronto, pero cuya ausencia en v1 **no rompe la historia** —se pueden reemplazar por
una simplificación honesta—.

- **Importación por Excel / carga masiva.** Enorme a escala, pero para el primer Drop de una comiquería la carga
  ágil manual alcanza. *Simplificación aceptable:* cargar a mano. Se suma cuando el volumen lo justifique.
- **Duplicar un Drop.** Brilla a partir de la **segunda** semana (la repetición es donde paga). En el primer Drop
  todavía no hay nada que duplicar. *Cuándo entra:* apenas Agustín corra su segunda semana; es de las primeras
  cosas del "fast-follow".
- **Comunicaciones generadas automáticamente (WhatsApp/newsletter).** Altísimo valor futuro, pero el piloto puede
  vivir con que Agustín comparta el link y escriba él el mensaje. *Simplificación aceptable:* comunicación manual +
  un resumen copiable, no generación automática.
- **Avisos automáticos de llegada a la clientela.** En el piloto, marcar "llegó" y que Agustín avise por su canal
  habitual es suficiente. *Simplificación aceptable:* el aviso lo da él; el sistema solo registra el estado.
- **Gestión fina de pagos (saldos parciales, historial detallado).** El piloto necesita "pagó / no pagó / cuánto
  falta", no un libro contable. *Simplificación aceptable:* registro simple de pago.

El criterio para esta categoría: **agregan valor pero tienen un sustituto manual digno.** No sacan a Agustín de la
historia; solo le ahorran esfuerzo que, en la escala del piloto, todavía es tolerable.

---

## ¿Qué pertenece claramente a una versión futura?

Cosas que son **otro producto** o **otra etapa**, y meterlas ahora diluiría el foco de enamorar al primer usuario:

- **Catálogo operativo propio de cada tienda** y su separación del catálogo global.
- **Gestión de stock** y **recepción de mercadería** que actualiza inventario.
- **Venta online directa** (tienda especializada) y **self-service checkout**.
- **Inteligencia comercial** (reposición, tendencias, historial, agotados, recomendaciones).
- **Campañas comerciales** como tipo de trabajo distinto del Drop (Día del Niño, Black Friday) — ver más abajo.
- **Automatización end-to-end** del Drop (lista → publicado casi solo).
- **Escala multi-tienda** (varias comiquerías operando en paralelo con sus políticas).

Todo esto está en la Visión y es deseable; **nada de esto es necesario para que Agustín se enamore.** Su problema
es su semana, no el producto completo.

Nota sobre **Campañas vs Drops** (del Workflow Design): el piloto se enfoca **solo en el Drop semanal**. No porque
las campañas no importen, sino porque *el Drop es el problema principal de Agustín* y porque —como vimos— la gestión
de reservas es idéntica en ambos. Resolver el Drop primero construye toda la maquinaria de gestión que una campaña
reutilizará después. Es la simplificación de alcance más rentable.

---

## El momento WOW del piloto

**El WOW es publicar el primer Drop, abrir el link, y ver su preventa convertida en una tienda que se ve
profesional — y entonces ver caer la primera reserva en el tablero.**

Por qué ese y no otro:
- Es el instante donde Nakama deja de ser "una herramienta para cargar cosas" y se vuelve **la vidriera de su
  negocio**. El orgullo de "puedo mostrar esto" es una emoción más fuerte que cualquier ahorro de tiempo.
- Combina las dos mitades de la historia en un solo golpe: el **cierre de la preparación** (publiqué) y el
  **arranque de la vida** (llegó una reserva). Ver el pulso moverse por primera vez es la prueba tangible de que
  "esto funciona de verdad".
- Es **compartible**: el WOW no se queda en Agustín. Cuando le manda el link a su clientela, el producto se muestra
  solo. El mejor marketing del piloto es su propio momento WOW filtrándose a sus clientes.

Diseñar el piloto es, en buena medida, **proteger ese momento**: todo lo anterior existe para llegar ahí sin
fricción, y la página pública tiene que estar a la altura porque es el pico emocional.

---

## Los primeros diez minutos de Agustín

El recorte se valida contra esta secuencia de sensaciones. Si en algún minuto siente lo contrario, cortamos mal.

- **Minuto 0–2 — Reconocimiento.** Entra y **entiende sin manual**. Le habla en su idioma (preventa, tomos,
  reservas), el tablero muestra *su semana*, no una tabla genérica. Sensación: *"esto es de mi rubro, esto me
  entiende"*.
- **Minuto 2–5 — Impulso.** Arranca una preventa casi sin fricción (un nombre y ya está adentro), suma unos tomos,
  todo en un solo lugar. Sensación: *"esto no me hace pelear con formularios; avanzo"*.
- **Minuto 5–8 — Orgullo (WOW).** Publica. Recibe un link. Lo abre y **se ve como una tienda de verdad**, mejor de
  lo que él podría armar. Sensación: *"puedo mostrar esto y quedar bien parado"*.
- **Minuto 8–10 — Vida.** Llega la primera reserva (real o de prueba) y el tablero **late**: reservas y plata en un
  solo lugar. Sensación: *"esto es mi central de comando, no un formulario"*.

La emoción acumulada de esos diez minutos es **alivio + orgullo + pertenencia**: por fin una herramienta pensada
para lo que él hace. Ese es el estado mental que queremos dejar instalado antes de que aparezca cualquier carencia.

---

## Irrenunciables vs simplificaciones aceptables

La regla: **es irrenunciable lo que sostiene el arco o el orgullo; es simplificable lo que tiene un sustituto
manual digno.**

| Irrenunciable (sostiene la historia o la emoción) | Simplificación aceptable en v1 (tiene sustituto digno) |
|---|---|
| El Drop corre **de punta a punta** (preparar→publicar→reservar→atender→cerrar) | Que ese recorrido se haga con **carga manual** en vez de importación |
| **Un solo lugar** para preparar y atender (workspace) | **Comunicar a mano** (compartir link + mensaje propio) en vez de generación automática |
| **Página pública profesional** + link compartible | **Aviso de llegada manual** (el sistema registra, Agustín avisa por su canal) |
| **Tablero con pulso** (reservas + monto + atención) | **Registro de pago simple** (pagó/falta) en vez de gestión fina de saldos |
| Gestión **esencial** de reservas (pago, llegada, entrega) donde vive el dato | **Sin duplicar** en el primer Drop (entra apenas exista una segunda semana) |
| **Lenguaje de negocio** y **estados visuales** | **Solo Drop** (sin campañas comerciales todavía) |

Lo que **nunca** se simplifica, porque es donde vive la emoción: que se sienta **un producto de su rubro** (no un
backoffice), que la **página pública** lo haga quedar bien, y que el trabajo **no lo obligue a saltar entre
pantallas**. Todo lo demás admite una versión más humilde en v1.

---

## El piloto, en una frase

**Una primera versión que le permite a Agustín correr un Drop real de su semana, publicarlo como una tienda de la
que se enorgullece, y atender las reservas desde un solo lugar — dejándolo con la sensación de que Nakama entiende
su negocio y no quiere volver a su método anterior.**

Todo lo que no sirve directamente a esa frase puede esperar. El próximo paso natural —cuando se decida avanzar— son
los wireframes de baja fidelidad del **Tablero** y del **Workspace**, protegiendo por sobre todo el momento WOW.
