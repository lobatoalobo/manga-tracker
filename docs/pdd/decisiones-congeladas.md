# Decisiones congeladas

Registro de decisiones de producto ya tomadas. Corto, sin filosofía. Cada una tiene un ID estable; las fichas y pantallas la referencian por ID en vez de volver a argumentarla.

Una decisión congelada **no es inmutable**: se revisa si aparece una necesidad real. Hasta entonces, gana la regla simple.

---

**D-001 · Una sola edición "En preparación" por tienda.**
No pueden coexistir dos borradores. Con dos, no hay respuesta a "cuál es esta semana / cuál abre el Workspace / cuál continúa el lunes". — *Origen: F-COM-01.*

**D-002 · La numeración de la edición es automática, correlativa y no editable.**
El número es identidad interna de la tienda; no comunica nada al cliente, no hay motivo para editarlo. — *Origen: F-COM-01.*

**D-003 · Nakama nunca sugiere cantidades de compra.**
El producto muestra la información; la tienda decide. Prohibido: sugerencias, fórmulas o valores precargados de "A pedir". — *Origen: principio de diseño "Nakama muestra; la tienda decide".*

**D-004 · Una edición no puede publicarse sin precio.**
No se puede reservar algo cuyo precio no se conoce. Un tomo sin precio puede existir en preparación, pero bloquea la publicación. — *Origen: F-COM-01 / F-COM-03.*

**D-005 · Una nueva edición hereda estructura, no contenido.**
Cada lunes la edición de la semana ya existe: número, semana, estado *En preparación*, lista vacía. Nunca copia tomos, portada ni destacados. Sostiene la sensación "todos los lunes ya hay una edición esperándote". — *Origen: F-COM-01.*

**D-006 · La portada es opcional.**
Una edición puede no tener ningún tomo en portada y seguir siendo una edición completa: la respuesta "esta semana no sobresale ninguna, toda la edición es la lista" es válida, no un estado incompleto. Impacta Workspace, composición pública, estados vacíos, layout y futuras campañas. — *Origen: F-COM-02.*

**D-007 · El orden editorial es independiente del orden de trabajo.**
La jerarquía con la que una edición se presenta a la comunidad nunca depende del orden en que sus tomos fueron cargados al Workspace. — *Origen: F-COM-02.*

**D-008 · La portada siempre tiene exactamente una principal cuando contiene uno o más tomos.**
Con la portada vacía no existe principal. Al llevar el primer tomo a portada, ese tomo pasa a ser la principal automáticamente; luego puede reasignarse, pero nunca hay un estado "portada con tomos sin principal". El modelo se mantiene consistente sin exigencias explícitas ni modales. — *Origen: F-COM-02.*

**D-009 · Publicar inicia la preventa; no congela la edición.**
Publicar hace pública la edición y habilita las reservas, pero no petrifica el objeto: la edición sigue viva —correcciones de precio, typo, imagen o portada siguen posibles; las reservas entran, las huellas aparecen—. Lo único irreversible es que la comunidad ya la vio. — *Origen: F-COM-03.*

**D-010 · Nakama no calcula relevancia; la pone la persona.**
La edición se presenta tal como el comerciante la compuso; el sistema no reordena, filtra ni recomienda según quién mira. La persona reconoce sola qué le interesa. Extiende "Nakama muestra; la tienda decide" → **"Nakama muestra; la persona reconoce."** (En el piloto no hay personalización; si a futuro hay cuenta/colección, "para mí" podría volverse literal — se revisará entonces.) — *Origen: F-CLI-01.*

**D-011 · Reservar crea inmediatamente una promesa.**
No existe un estado de solicitud pendiente ni aprobación manual: cuando la persona reserva, la promesa nace en el acto. Conceptualmente hay dos hechos —la persona expresa la *intención* de reservar, la tienda *promete* guardar el ejemplar—; en el piloto ocurren de forma inmediata y se perciben como un solo evento, pero el modelo los distingue. — *Origen: F-CLI-02.*

**D-012 · La página pública no utiliza métricas sociales como elemento de persuasión.**
Permitido: estado del ejemplar/edición ("Preventa abierta hasta el viernes", "Disponible para reservar", "Agotado"). Fuera: contadores y señales de prueba social ("48 personas lo reservaron", "el más reservado", "trending"). Protege "muestra, no persuade". — *Origen: F-CLI-02.*

**D-013 · Cancelar una reserva nunca exige explicar el motivo.**
El motivo puede pedirse de forma opcional ("¿querés contarnos por qué?"), pero jamás como condición para cancelar. — *Origen: F-CLI-04.*

**D-014 · Una promesa solo puede marcarse como entregada si previamente está lista para retirar.**
No hay entrega sin preparación: el estado *retirada* solo se alcanza desde *listo para retirar*. — *Origen: F-COM-07.*

**D-015 · Cerrar la preventa es reversible mediante una acción explícita.**
Estado normal *Preventa abierta* → acción *Cerrar preventa* → *Preventa cerrada* → acción secundaria *Reabrir preventa*. Es una acción administrativa, sin dramatización (nada de warnings enormes ni "¿estás seguro?"). El sistema **nunca pierde información** al cerrar o reabrir. Cubre la realidad: el distribuidor extendió el cierre, apareció un cliente, hubo un error, se cerró antes de tiempo. — *Origen: P-02 / UF-M5.*

**D-016 · No se puede cerrar la preventa con cantidades "A pedir" sin definir.**
El "—" (no decidido) no sobrevive al cierre: el cierre se impide mientras exista algún "—". No obliga a *comprar*, obliga a *decidir* —que es la única pregunta de P-02 ("¿con cuánto cerrás?")—. Por eso **0 es una decisión válida** ("no pedir ninguno"), distinta de "—" (ausencia de decisión). — *Origen: P-02 / UF-M5.*

**D-017 · Lenguaje de acción, no de sistema.**
El CTA principal **describe la acción que la persona realiza** ("Hacer pedido", "Reservar estos tomos", "Publicar la edición"), nunca el estado del formulario ("Confirmar", "Aceptar", "Enviar formulario"). El feedback de éxito habla en el **idioma de la relación tienda–cliente** ("Tu pedido ya está en la comiquería; te avisan por WhatsApp"), no genérico de sistema ("Reserva creada correctamente"). Aplica a todo el producto. — *Origen: P-05.*

**D-018 · La recepción se optimiza para el caso normal: "Llegó todo" + excepciones.**
Al registrar la llegada de la mercadería, la recepción es **una pregunta, no una planilla**: acción principal **"Llegó todo ✓"** y secundaria **"Faltó algo"**; ambas confirman el envío. **Nunca** se presenta como una planilla de stock a completar título por título ni pide "pedido vs llegado". El faltante concreto (qué copia no entró) **no se marca en la recepción** sino sobre el pedido de la persona (ver D-019). Optimiza el caso normal y hace **explícita solo la excepción**, donde se descubre. — *Origen: P-07.*

**D-019 · Nakama no impone la unidad de cumplimiento; la tienda decide cómo trabajar. El faltante es por copia de la persona.**
El sistema muestra el estado de cada pedido (completo / con faltante) y **organiza la cola para el caso normal** —cumplir cuando el pedido está completo—, pero **no impide** apartar y avisar un pedido **incompleto**: una tienda puede cumplir parcial si esa es su política ("pasá a buscar Dandadan, Berserk te lo debo"), y hay clientes que lo prefieren. "Cumplir por pedido completo" es el **flujo principal de la interfaz, no una regla del dominio**. Corolario: **el faltante es de la copia concreta de una persona, no del título** —marcar "no llegó" en el pedido de alguien no afecta a otra persona que pidió el mismo tomo—, porque decidir a quién le toca una copia escasa también es de la tienda. Extiende "Nakama muestra; la tienda decide" → **"Nakama muestra el estado; la tienda decide cómo trabajar."** — *Origen: P-07 / F-COM-06 vacío 1.*

---

## Decisiones transversales pendientes

Cruzan varias pantallas; se resuelven **una sola vez** para no reaparecer como vacío en cada una. (Aún abiertas.)

- **DT-01 · Acceso a reservas** ✅ *(CERRADA — [dominio/acceso-sin-cuenta.md](dominio/acceso-sin-cuenta.md))* — **enlace-capacidad por pedido**: token no adivinable (≥128 bits, hasheado, sin PII en la URL, revocable/rotable por la tienda), la URL es la credencial, entregado por WhatsApp/[SYS-03](automatizaciones.md). Dos mecanismos: M1 token-capacidad (única llave, no enumerable, Nombre+WhatsApp no dan acceso) + M2 recuerdo device-local (opt-in explícito, editable/borrable, solo autocompleta, nunca credencial, sin sync). Consumen P-04/P-05/P-06/SYS-03/Workspace. Fuera de v1: cuentas, índice "mis reservas", recuperación self-service, expiración automática, OTP. Origen: [F-CLI-03](casos-de-uso.md) ⭐.
- **DT-02 · Modelo de pago / seña** 🟡 *(estructura CERRADA — [dominio/modelo-pago.md](dominio/modelo-pago.md); falta 1 dato)* — El **modelo general** admite los tres modos (`sin_pago_previo` / `sena` / `total`) como propiedad configurable de la preventa (con override por tomo); el dominio **no** asume "pago total contra llegada". La **configuración del piloto (Crumb)** habilita **un solo modo**. Compuerta de entrega: normal exige `saldo==0`, con **excepción explícita del comerciante** (entrega con saldo pendiente, con confirmación + trazabilidad). **Pendiente únicamente:** confirmar con **Agustín** el modo real del Drop piloto. — *Origen: [revisión transversal](revision-transversal.md).*
- **DT-03 · Fecha y cierre de preventa** *(ABIERTA, el recurrente)* — dónde se fija la fecha; cierre manual vs automático; qué ve quien llega tarde. Toca P-01/P-02/P-03/P-04/SYS-02. *Recomendación: fecha al publicar (P-03), editable en P-01; cierre manual en v1; P-04 tras cierre = "Preventa cerrada".* — *Origen: recurrente del PDD, consolidado en [revisión transversal](revision-transversal.md).*
- **DT-04 · Validación de comprobante** ✅ *(CERRADA — absorbida en [dominio/modelo-pago.md](dominio/modelo-pago.md) y [maquina-estados.md](dominio/maquina-estados.md))* — ciclo *por_pagar → comprobante_enviado (por validar) → pagado*, con *rechazar* que vuelve a por_pagar. La tienda valida en P-08 (o antes); sin superficie nueva.
- **DT-05 · Ramas de muerte de la promesa** ✅ *(CERRADA en dominio — [maquina-estados.md](dominio/maquina-estados.md))* — **cancelada** (cliente, self-service solo hasta *apartado*, sin motivo [D-013](decisiones-congeladas.md)) · **caída** (comerciante, faltante que no llega) · **vencida** (sistema, SYS-02, disparador automático **diferido en v1**). Terminales, sin resurrección. Dinero de una promesa muerta ya cobrada = saldo a favor registrado, devolución fuera de v1.
