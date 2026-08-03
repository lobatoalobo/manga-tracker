> **Documento histórico.** La fuente de verdad vigente para Retail es `docs/pdd/`.

# Diseño de Experiencia del Cliente — Retail

> **Documento de Product Design (lado cliente). No es implementación, arquitectura, modelos ni diseño de
> autenticación.** Completa la serie: [UX Review](retail-ux-review.md) ·
> [Product Vision](../../../vision/retail-product-vision.md) · [Workflow Design](retail-workflow-design.md) ·
> [Pilot Design](retail-pilot-design.md). Diseña *la experiencia* de quien **recibe el link de una preventa**.

**El momento que estamos diseñando:** alguien recibe un WhatsApp de su comiquería y, en **menos de un minuto**,
pasa de la curiosidad a *"sí, reservame ese tomo"*. Si Nakama quiere ser el sistema operativo de una comiquería, no
alcanza con el backoffice: tiene que ganar **ese** momento.

**Doble criterio de éxito.** El cliente termina pensando *"reservar fue más fácil de lo que esperaba"*, y el
comerciante termina pensando *"compartir este link fue una buena decisión"*. Las dos frases tienen que ser verdad
al mismo tiempo; si una falla, el producto falla.

---

## 1. El principio rector: reservar nunca debería exigir crear una cuenta

Lo pongo primero porque **condiciona todo lo demás**.

> Comprar o reservar **nunca** debería requerir crear una cuenta. La autenticación aparece **solo cuando le aporta
> valor al usuario**, nunca cuando le simplifica la vida a la implementación.

### Por qué (ventajas)
- **Se compra en el pico de intención.** El momento de mayor deseo es el segundo en que abre el link. Cada paso
  entre ese segundo y "reservado" pierde gente. Un formulario de registro ahí es tirar la venta a la basura.
- **Respeta el canal.** Un link por WhatsApp es un gesto casual y de confianza. Pedir "creá tu cuenta" rompe esa
  casualidad: convierte "apartame ese" en un trámite.
- **Coincide con el mundo real.** Reservar en una comiquería siempre fue decir "apartámelo". Nunca hubo papeleo.
  El producto debe sentirse igual de liviano que el mostrador.
- **Incluye a todos.** El que odia crear cuentas, el que está apurado en el colectivo, el menos digital: todos
  reservan igual.

### Sus riesgos (y por qué no invalidan el principio)
- **Continuidad e identidad:** ¿cómo sabe la tienda quién reservó? ¿cómo vuelve el cliente a su reserva? Real, pero
  se resuelve con **identidad liviana** (nombre + contacto), no con una cuenta. Ver §2 (el límite).
- **Recuperación:** si pierde el mensaje de confirmación, ¿cómo retoma? Se resuelve con una confirmación **guardable
  y reencontrable** por su canal, no con login.
- **Relación de largo plazo:** sin ningún rastro persistente cuesta construir recurrencia. Cierto — y ahí es
  exactamente donde la cuenta **gana su lugar** (§3), pero *después*, no como peaje de entrada.

### El límite del principio (importante, para no malinterpretarlo)
"Sin cuenta" **no** significa "sin identidad". Para reservar, la tienda **necesita** saber a quién apartarle el tomo
y cómo coordinar el retiro: **un nombre y un contacto**. Eso **es parte de la transacción**, no un registro. La
línea que no se cruza es distinta:
- **Sí** pedir nombre + contacto para reservar (es lo que haría en el mostrador).
- **No** pedir contraseña, "crear cuenta", verificar mail, ni poner el botón de reservar detrás de un signup.

Dar tu nombre y tu WhatsApp para que te aparten algo **no se siente como registrarse**. Poner una contraseña antes
de ver si te conviene, sí. El diseño vive de esa diferencia.

### Cuándo *sí* tiene sentido invitar a crear cuenta
Nunca **antes** de aportar valor; siempre **después** y **atado a un beneficio concreto que el cliente ya entiende**:
- **Justo después de reservar**, como *upgrade* opcional: "¿querés seguir tu reserva y que te avise cuando llegue?".
- **En la segunda o tercera vez**: "guardá tus datos para la próxima" — la recurrencia justifica el ahorro.
- **Cuando quiere algo que solo la persistencia da**: seguir su colección, ver su historial con la tienda, manejar
  sus avisos. Ahí la cuenta **es** el valor, no la barrera.

En todos los casos: **la cuenta se ofrece, no se impone**; siempre hay un "ahora no" que no cuesta nada.

---

## 2. La historia completa (con lo que se siente en cada paso)

El flujo de ejemplo no es obligatorio; es el arco emocional que hay que cuidar.

**Recibo un WhatsApp.** Viene de mi comiquería (o de alguien que la sigue). Llego con **confianza prestada**: no es
un anuncio frío, es alguien en quien confío mandándome algo. El producto tiene que **honrar esa confianza** desde
el primer pixel, no dilapidarla.

**Abro el link.** Primer test, milisegundos: *¿esto es de verdad, es de mi tienda, vale la pena seguir?* Si la
página se ve amateur, lenta o genérica, la confianza prestada se evapora. Si se ve como **la tienda que conozco**,
me quedo.

**Descubro la preventa.** Necesito entender rápido tres cosas: **qué es esto** (la preventa de la semana / de tal
cosa), **de quién es** (la tienda, su identidad), y **cuál es el trato** (qué hay, a cuánto, hasta cuándo, cómo se
retira/paga). No quiero leer un manual; quiero *captar* la propuesta.

**Recorro los tomos.** Ojeo lo que hay. Reconozco portadas, series, autores. Quizás me interesa uno, quizás varios.
Debería poder mirar **sin compromiso** y sin que nada me frene: explorar es gratis y placentero.

**Reservo.** Encuentro lo que quiero y digo "sí". Este acto tiene que ser **de un pulgar y de pocos segundos**: elijo
lo que aparto, doy mi nombre y mi contacto, confirmo. Sin cuenta, sin contraseña, sin desvío.

**Recibo confirmación.** Necesito **certeza**: ¿quedó? ¿qué reservé? ¿cuánto es? ¿qué sigue ahora (cómo y cuándo
pago, cuándo retiro)? La confirmación debe **tranquilizar** y **decir qué pasa después**, y ser algo que pueda
**guardar y reencontrar** (por su canal). Acá —y recién acá— aparece la invitación amable a la cuenta.

**Más adelante, retiro.** Me avisan que llegó, voy, pago si falta, me lo llevo. Idealmente pude **seguir el estado**
de mi reserva en el camino (reservado → llegó → listo → retirado) sin haber tenido que crear nada.

La regla narrativa del lado cliente: **entender rápido, reservar fácil, quedar tranquilo, volver sin fricción.**

---

## 3. Las preguntas clave, respondidas

**¿Qué siente al abrir el link?** Una mezcla de curiosidad y evaluación instantánea. Está decidiendo, sin darse
cuenta, si esto es *serio* y *suyo*. El trabajo del diseño es convertir esa duda en confianza en el primer vistazo.

**¿Qué información necesita primero?** En este orden: **de quién es** (la tienda, reconocible), **qué es** (una
preventa, con su naturaleza: se aparta ahora, llega después), y **el trato** (qué incluye, precios, fecha límite,
cómo se paga y se retira). Todo lo demás es secundario.

**¿Qué la hace confiar?** Que la página **se vea como la tienda que conoce** (identidad clara, no un template
anónimo); que las **reglas sean transparentes** (cuándo llega, cómo se paga, qué pasa si no puede retirar); que se
sienta **cuidada** (rápida, prolija, sin errores). La confianza se gana con claridad, no con sellos.

**¿Qué la hace reservar?** Deseo (reconoce algo que quiere) + **cero fricción** (el "sí" está a un toque) +
**seguridad** (entiende que reservar no es un salto al vacío: sabe qué se compromete y qué no). Bajar la fricción y
subir la certeza mueven la aguja más que cualquier persuasión.

**¿Qué debería poder hacer sin cuenta?** Prácticamente **todo lo esencial**: descubrir, recorrer, **reservar**,
recibir confirmación, **seguir el estado** de su reserva y llegar hasta el retiro. La cuenta no debería ser
condición de nada de eso.

**¿Qué valor adicional obtiene si crea cuenta?** **Continuidad y memoria**: todas sus reservas con la tienda en un
lugar, avisos de llegada y de próximos drops, su **historial**, y —el diferencial de Nakama— **seguir su
colección**. La cuenta convierte transacciones sueltas en una **relación**.

**¿Cómo evitar que el registro interrumpa la compra?** No poniéndolo **nunca** antes del "reservado". El dato de
identidad que la reserva ya pide (nombre + contacto) es suficiente para operar; la cuenta se ofrece **después**,
como consecuencia, y siempre saltable. Idealmente la cuenta se siente como algo que **"aparece" de lo que ya
hiciste**, no como un formulario nuevo que hay que llenar de cero.

---

## 4. Los tipos de cliente (qué comparten, dónde divergen)

**Lo que TODOS comparten:**
- Llegan por un **link de confianza** (alguien o algo que siguen).
- Hacen el mismo test inicial: *¿qué es, es legítimo, cuál es el trato, hasta cuándo?*.
- Quieren el **reservar** simple y rápido.
- Necesitan **tranquilidad después** (¿quedó?, ¿y ahora qué?).
- Ninguno quiere que le pidan crear una cuenta para poder comprar.

**Dónde divergen:**

- **El cliente habitual.** Ya confía, compra seguido, odia repetir sus datos cada semana. Quiere **velocidad y
  reconocimiento** ("hola de nuevo, tu retiro de siempre"). Es el **mejor candidato a cuenta**, pero porque la
  cuenta le **ahorra** algo real (no re-tipear, ver sus reservas), no porque se la impongamos. Su riesgo de fuga es
  la fricción repetida.

- **Quien compra por primera vez.** No conoce la tienda ni Nakama. Es el más sensible a la **confianza** y a
  cualquier cosa que huela raro. Necesita más señales de legitimidad y explicación del "cómo funciona esto". La
  cuenta acá es **prematura**: primero que viva una buena reserva, después hablamos.

- **Quien hace un regalo.** Compra para otro. Necesita **claridad de que es preventa** (llega después) y
  logística de retiro/entrega; puede **no querer** que eso figure como "su colección". Divergencia clave: el ítem
  **no es suyo**, y su relación con el producto es puntual, no coleccionista.

- **Quien llega desde redes sociales.** Lead más **frío y escéptico**, quizás solo mirando. Necesita el "qué es +
  es legítimo" más fuerte y el camino de **menor compromiso**. Puede **no reservar** en la primera visita. Cualquier
  fricción (formulario largo, registro) lo pierde de inmediato. La cuenta está a años luz de su cabeza.

- **Quien solo quiere un tomo específico.** Alta intención, foco angosto. No le importa el resto de la preventa;
  quiere **ese** tomo y listo. Necesita un camino **láser**: encontrarlo, reservarlo, chau. Obligarlo a recorrer
  todo el catálogo es fricción para él.

**La tensión de diseño:** la misma página tiene que servir al **frío escéptico** (que necesita confianza y bajo
compromiso) y al **caliente de alta intención** (que quiere reservar ya). Se resuelve con **compromiso progresivo**:
la página **abre con claridad y confianza** (para el frío) pero mantiene el **reservar a un toque en todo momento**
(para el caliente); se **explora sin identificarse**, se **identifica solo al reservar**, y se **ofrece cuenta solo
después**. Una sola experiencia, distintos niveles de compromiso según quién sea.

---

## 5. Más allá de la reserva: la relación completa tienda ↔ cliente

La reserva es **el primer apretón de manos, no la relación entera**. Si Nakama va a ser el sistema operativo de la
comiquería, tiene que resolver también lo que pasa **antes y después** de ese "sí".

- **Antes:** el cliente llega con confianza prestada por el canal (WhatsApp, redes). El producto **hereda** esa
  confianza y su primer trabajo es no traicionarla.
- **Durante:** reservar es liviano; identificarse es parte natural del apartado, no un registro.
- **Después (la parte que hoy nadie resuelve bien):** el cliente puede **seguir su reserva** camino al retiro
  (reservado → llegó → listo → retirado) y recibir el **aviso de llegada**, sin haber creado nada. Ese seguimiento
  es, por sí solo, una experiencia mejor que "avisame por WhatsApp cuando llegue".
- **A lo largo del tiempo:** con cada preventa, el cliente **acumula historia** con esa tienda. Ahí la cuenta se
  vuelve deseable **por sí misma**: es el lugar donde viven "mis reservas", "mis avisos", "mi historial" y "mi
  colección". La cuenta deja de ser barrera y pasa a ser **la memoria de una relación que ya existe**.

Este es el **principio de producto más fuerte** que "los usuarios deben registrarse": **la cuenta como consecuencia
de haber encontrado valor.** Primero entregamos algo que valga la pena (una reserva fácil, un seguimiento claro, un
aviso oportuno); recién entonces ofrecemos guardarlo. El registro no interrumpe la relación: **la corona**.

Para la tienda, esta relación completa es lo que convierte "mandé un link" en "gané un cliente que puedo volver a
alcanzar la semana que viene". El link no es una venta suelta: es **el inicio de un vínculo recurrente**, y Nakama
es el que lo recuerda por ambas partes.

---

## 6. Principios de experiencia del cliente

- **Reservar en menos de un minuto, con un pulgar, sin cuenta.** La métrica emocional del lado cliente.
- **Confianza primero.** La página abre dejando claro *de quién es*, *qué es* y *cuál es el trato*. La confianza se
  gana con claridad y prolijidad, no con fricción ni sellos.
- **Explorar es gratis; identificarse llega tarde; la cuenta, más tarde aún.** Compromiso progresivo: mirar sin
  dar nada, dar nombre+contacto solo al reservar, cuenta solo después y siempre saltable.
- **Identidad ≠ cuenta.** Pedir a quién apartar y cómo contactarlo es parte de la transacción; no es registrarse.
  Nunca contraseña ni signup antes del "reservado".
- **La confirmación tranquiliza y orienta.** Dice *quedó*, *qué reservaste*, *cuánto* y *qué sigue*; es guardable y
  reencontrable.
- **Seguir la reserva sin cuenta.** El estado camino al retiro es visible sin login; el aviso de llegada, también.
- **La cuenta corona, no interrumpe.** Se ofrece después del valor, atada a un beneficio concreto (colección,
  historial, avisos), y como algo que casi *aparece* de lo que ya hiciste.
- **Una página, muchos niveles de compromiso.** Sirve al frío escéptico y al caliente de alta intención sin obligar
  a ninguno a moverse al ritmo del otro.
- **Mobile primero, siempre.** Todo esto ocurre en un teléfono, llegando desde un chat. Si no es impecable en
  mobile, no existe.

---

*Cierre: el objetivo es que el cliente piense "reservar fue más fácil de lo que esperaba" y el comerciante piense
"compartir este link fue una buena decisión" — y que, con el tiempo, la cuenta aparezca no como un peaje sino como
la consecuencia natural de haber encontrado valor. Este es diseño de experiencia; no hay aquí decisiones técnicas
ni trabajo aprobado.*
