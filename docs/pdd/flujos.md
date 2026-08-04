# 1 · Flujos (User Flows)

## Cómo se organiza esta sección

Un **User Flow** es el **recorrido de una persona hacia una meta** dentro de Nakama. Atraviesa varias pantallas y encadena varios casos de uso; una misma pantalla participa en varios flujos.

No confundir con:
- **Caso de uso** ([Sección 3](casos-de-uso.md)) — una operación puntual del dominio (un actor + el sistema, con precondiciones y postcondición). Los flujos *referencian* casos de uso, no los repiten.
- **Automatización del sistema** ([automatizaciones.md](automatizaciones.md)) — responsabilidad que el producto ejecuta sin un usuario recorriendo una meta. **No es un User Flow.**

Buckets por actor: **Cliente** y **Comerciante**. **⭐ Core** marca los recorridos de los que depende el piloto.

## Plantilla de ficha (User Flow)

- **ID · Nombre**
- **Meta del usuario** — qué quiere lograr.
- **Actor**.
- **Punto de entrada** — cómo empieza el recorrido.
- **Recorrido** — los pasos, cada uno indicando la **pantalla** y el **caso de uso** que toca.
- **Ramas / decisiones** — bifurcaciones y hand-offs a otros flujos.
- **Fin** — la meta alcanzada.
- **Casos de uso referenciados**.

---

## Inventario

### Cliente
- ⭐ **UF-C1** · Descubrir novedades
- ⭐ **UF-C2** · Reservar un manga
- **UF-C3** · Gestionar mi reserva

### Comerciante
- ⭐ **UF-M1** · Armar y publicar el Drop
- ⭐ **UF-M2** · Seguir la preventa
- **UF-M5** · Cerrar la preventa y definir cantidades
- ⭐ **UF-M3** · Preparar pedidos
- ⭐ **UF-M4** · Entregar pedidos

> El número del ID refleja **cuándo se definió** cada flujo, no su orden temporal. El recorrido de una semana del comerciante es: **UF-M1 → UF-M2 → UF-M5 → UF-M3 → UF-M4**.

**Mapa User Flow → casos de uso**

| User Flow | Casos de uso que encadena |
|---|---|
| UF-C1 Descubrir novedades | F-CLI-01 |
| UF-C2 Reservar un manga | F-CLI-02 |
| UF-C3 Gestionar mi reserva | F-CLI-03 (seguir) · F-CLI-04 (cancelar) |
| UF-M1 Armar y publicar el Drop | F-COM-01 · F-COM-02 (opcional) · F-COM-03 |
| UF-M2 Seguir la preventa | F-COM-04 |
| UF-M5 Cerrar la preventa y definir cantidades | F-COM-05 |
| UF-M3 Preparar pedidos | F-COM-06 |
| UF-M4 Entregar pedidos | F-COM-07 |

---

## Fichas

### ⭐ UF-C1 · Descubrir novedades

**Meta del usuario**
Enterarse de qué salió esta semana en su comiquería y reconocer si hay algo que le interese.

**Actor**
Persona / comunidad (anónima en el piloto).

**Punto de entrada**
Abre el link del Drop que compartió el comerciante (típicamente WhatsApp) o vuelve a la tienda.

**Recorrido**
1. Llega a la **Página pública de la edición** y ve la composición tal como el comerciante la armó (portada + lista). — *Pantalla: Página pública · la edición · Caso de uso: [F-CLI-01](casos-de-uso.md)*
2. Recorre la edición en cualquiera de los dos modos que conviven: **encontrar rápido lo que ya sigue** (continuidad) o **descubrir algo nuevo** (browse). Es lectura pura: sin compromiso y sin dejar huella.
3. Reconoce qué le interesa —o nada—. La relevancia la pone la persona, no el sistema ([D-010](decisiones-congeladas.md)).

**Ramas / decisiones**
- **Portada vacía** ([D-006](decisiones-congeladas.md)) — ve una lista pura; recorrido igualmente válido.
- **Aparece el "eso sí"** — algo la agarra → hand-off a **[UF-C2 · Reservar un manga](#uf-c2--reservar-un-manga)**. Es la continuación natural del recorrido.
- **Llega con la preventa cerrada** — ve la edición pero no puede reservar (comportamiento a definir; vacío del caso de uso F-CLI-01).

**Fin**
La persona sabe qué salió esta semana y reconoció qué le interesa (o nada). Si algo la agarró, quedó encaminada a reservar; si no, sale sin rastro.

**Casos de uso referenciados**
[F-CLI-01 · Explorar la edición](casos-de-uso.md). *(Los vacíos de detalle —vista de tomo, explorar tras cierre, ediciones anteriores— viven en el caso de uso, no se duplican acá.)*

---

### ⭐ UF-C2 · Reservar un manga

**Meta del usuario**
Asegurarse un tomo que le interesa: que la tienda se lo guarde.

**Actor**
Persona / comunidad. En este recorrido **deja de ser anónima**.

**Punto de entrada**
Viene de **UF-C1** (apareció el "eso sí"), o entra directo con la intención de reservar algo que ya sabe que salió.

**Recorrido**
1. Elige sobre la edición el tomo que quiere. — *Pantalla: Página pública · la edición · Caso de uso: [F-CLI-02](casos-de-uso.md)*
2. Deja su identidad mínima (nombre + contacto) para que la tienda sepa a quién guardar. — *Pantalla: Reserva · captura y confirmación · CU: [F-CLI-02](casos-de-uso.md)*
3. Confirma: nace la promesa y queda **esperada**. — *Pantalla: Reserva · captura y confirmación · CU: [F-CLI-02](casos-de-uso.md)*

**Ramas / decisiones**
- Puede **repetir** para varios tomos: son varias promesas que juntas forman su pedido.
- **Preventa cerrada** — no puede reservar (regla en el caso de uso).
- Desde la confirmación, si quiere volver a su reserva más tarde → hand-off a **UF-C3 · Gestionar mi reserva**.

**Fin**
Existe una promesa en estado *Reservado*: la persona quedó esperada y con una forma de volver a su reserva.

**Casos de uso referenciados**
[F-CLI-02 · Reservar un tomo](casos-de-uso.md).

---

### UF-C3 · Gestionar mi reserva

**Meta del usuario**
Volver a su reserva para confirmar que sigue en pie o para darla de baja.

**Actor**
Persona / comunidad (sin cuenta).

**Punto de entrada**
Vuelve a su reserva: desde la confirmación de **UF-C2**, desde un enlace/código que guardó, o tras un aviso del sistema ([SYS-03](automatizaciones.md)).

**Recorrido**
1. Accede a su reserva y la reconoce como propia. — *Pantalla: Vista pública de la reserva · CU: [F-CLI-03](casos-de-uso.md)*
2. Ve el estado actual (vigente / lista para retirar / finalizada). — *Pantalla: Vista pública de la reserva · CU: [F-CLI-03](casos-de-uso.md)*
3. *(Camino alternativo)* Si ya no la quiere, la cancela desde la misma vista. — *Pantalla: Vista pública de la reserva · CU: [F-CLI-04](casos-de-uso.md)*

**Ramas / decisiones**
- **Confirmar** — sigue vigente; no hay acción, continúa esperando.
- **Cancelar** — termina la promesa (caso de uso F-CLI-04); del lado del comerciante se refleja como una baja en **UF-M2**.
- El aviso de retiro llega **empujado** por [SYS-03](automatizaciones.md); no depende de que la persona entre a consultar.

**Fin**
La persona confirmó que su reserva sigue vigente, o la canceló. En ambos casos sabe en qué quedó.

**Casos de uso referenciados**
[F-CLI-03 · Seguir una reserva](casos-de-uso.md) · [F-CLI-04 · Cancelar una reserva](casos-de-uso.md).

---

### ⭐ UF-M1 · Armar y publicar el Drop

**Meta del usuario**
Dejar lista la edición de la semana y abrirla a su comunidad.

**Actor**
Comerciante.

**Punto de entrada**
Abre el Estudio de la nueva semana (la edición ya lo espera, [D-005](decisiones-congeladas.md)). El recorrido puede ocurrir en varias sesiones.

**Recorrido**
1. Carga las novedades de la semana. — *Pantalla: Estudio · orden de trabajo · CU: [F-COM-01](casos-de-uso.md)*
2. *(Opcional)* Lleva a portada las que quiere resaltar y define la principal. — *Pantalla: Estudio · orden editorial · CU: [F-COM-02](casos-de-uso.md)*
3. Publica: abre la preventa a la comunidad. — *Pantalla: Estudio · CU: [F-COM-03](casos-de-uso.md)*

**Ramas / decisiones**
- El paso 2 es **opcional** ([D-006](decisiones-congeladas.md)): puede publicar sin portada.
- El recorrido **se pausa y se retoma** entre sesiones; la edición *En preparación* persiste ([D-001](decisiones-congeladas.md)).
- Publicar **bloqueado** si faltan precios ([D-004](decisiones-congeladas.md)): vuelve al paso 1 a completarlos.
- Al publicar, del lado del cliente se habilita **UF-C1** y, del lado del comerciante, arranca **UF-M2 · Seguir la preventa**.

**Fin**
La edición pasa a *En preventa*: pública, compartible y recibiendo reservas.

**Casos de uso referenciados**
[F-COM-01](casos-de-uso.md) · [F-COM-02](casos-de-uso.md) · [F-COM-03](casos-de-uso.md).

---

### ⭐ UF-M2 · Seguir la preventa

**Meta del usuario**
Sentir cómo viene la semana mientras la preventa está abierta, y encaminar cuánto va a pedir.

**Actor**
Comerciante.

**Punto de entrada**
Entra al Workspace durante la semana (viene de **UF-M1** o vuelve cada día).

**Recorrido**
1. Lee el pulso de la semana: cuánta gente entró, qué se mueve. — *Pantalla: [P-01 Preventa Viva](pantallas.md) · CU: [F-COM-04](casos-de-uso.md)*
2. Mira la demanda por tomo y, si quiere, quién reservó cada uno (Por tomo / Por persona). — *Pantalla: P-01 Preventa Viva · CU: [F-COM-04](casos-de-uso.md)*
3. Va anotando una **previsión** de cuánto pedirá ("A pedir"), que madura durante la semana. — *Pantalla: P-01 Preventa Viva · CU: [F-COM-05](casos-de-uso.md) (previsión)*

**Ramas / decisiones**
- Entra una reserva o una baja: se refleja en la misma pantalla (reflejo de **UF-C2** / **UF-C3**).
- Cuando llega la fecha de cierre → hand-off a **UF-M5 · Cerrar la preventa y definir cantidades**.

**Fin**
El comerciante entiende cómo viene la preventa y tiene una previsión encaminada. El recorrido sigue vivo hasta el cierre.

**Casos de uso referenciados**
[F-COM-04 · Monitorear la preventa](casos-de-uso.md). *(Toca la previsión de F-COM-05, que se confirma en UF-M5.)*

---

### UF-M5 · Cerrar la preventa y definir cantidades

**Meta del usuario**
Cerrar la preventa y dejar fijas las cantidades finales que va a pedir.

**Actor**
Comerciante.

**Punto de entrada**
Llega la fecha de cierre (o decide cerrar antes). Viene de **UF-M2**.

**Recorrido**
1. Revisa la demanda final y su previsión de "A pedir". — *Pantalla: P-02 Definir cantidades · CU: [F-COM-05](casos-de-uso.md)*
2. Confirma las cantidades finales por tomo. — *Pantalla: P-02 Definir cantidades · CU: [F-COM-05](casos-de-uso.md)*
3. Cierra la preventa: las cantidades quedan firmes. — *Pantalla: P-02 Definir cantidades · CU: [F-COM-05](casos-de-uso.md)*

**Ramas / decisiones**
- El **abastecimiento** (hacer el pedido efectivo al distribuidor) ocurre **fuera de Nakama**.
- Cuando llega la mercadería → hand-off a **UF-M3 · Preparar pedidos**.

**Fin**
Preventa **cerrada** y cantidades finales **definidas**. No incluye haber realizado el pedido al distribuidor.

**Casos de uso referenciados**
[F-COM-05 · Definir cantidades](casos-de-uso.md).

---

### ⭐ UF-M3 · Preparar pedidos

**Meta del usuario**
Preparar las reservas que ya puede cumplir cuando llega la mercadería.

**Actor**
Comerciante.

**Punto de entrada**
Llega la mercadería al local (total o parcial). Viene de **UF-M5**.

**Recorrido**
1. Registra qué tomos llegaron. — *Pantalla: Workspace · preparación · CU: [F-COM-06](casos-de-uso.md)*
2. Aparta, por persona, las promesas ya cumplibles y detecta faltantes. — *Pantalla: Workspace · preparación · CU: [F-COM-06](casos-de-uso.md)*
3. Deja listas para avisar las promesas completas. — *Pantalla: Workspace · preparación · CU: [F-COM-06](casos-de-uso.md)*

**Ramas / decisiones**
- **Faltante que no llega** → rama de muerte *caída* (caso de uso F-COM-06).
- **Sobrante** → sale del flujo, pasa a stock.
- Al quedar promesas *listas para retirar*, el sistema avisa ([SYS-03](automatizaciones.md)) y se habilita **UF-M4 · Entregar pedidos**.

**Fin**
Las reservas cumplibles quedan apartadas por persona y listas para avisar; los faltantes, identificados.

**Casos de uso referenciados**
[F-COM-06 · Preparar pedidos](casos-de-uso.md).

---

### ⭐ UF-M4 · Entregar pedidos

**Meta del usuario**
Cerrar las promesas como cumplidas cuando la gente viene a retirar.

**Actor**
Comerciante.

**Punto de entrada**
Una persona se presenta en el mostrador a retirar (normalmente vino tras el aviso de [SYS-03](automatizaciones.md)).

**Recorrido**
1. Encuentra la promesa de la persona. — *Pantalla: Workspace · entrega (mostrador) · CU: [F-COM-07](casos-de-uso.md)*
2. Si hay saldo pendiente, lo cobra. — *Pantalla: Workspace · entrega (mostrador) · CU: [F-COM-07](casos-de-uso.md)*
3. Entrega el ejemplar y marca la promesa como *retirada*. — *Pantalla: Workspace · entrega (mostrador) · CU: [F-COM-07](casos-de-uso.md)*

**Ramas / decisiones**
- Solo se puede entregar si la promesa está *lista para retirar* ([D-014](decisiones-congeladas.md)).
- **Pedido incompleto** — entrega parcial o espera (vacío de unidad, casos de uso F-COM-06/07).

**Fin**
La promesa queda **cumplida** (*retirada*); saldo cobrado si existía. Es la "buena muerte" de la promesa.

**Casos de uso referenciados**
[F-COM-07 · Entregar pedidos](casos-de-uso.md).

---

## Revisión de consistencia

Chequeo acotado a los cinco puntos pedidos (sin abrir discusiones conceptuales):

1. **Pasos duplicados entre flujos** — ninguno. Cada caso de uso vive en un solo flujo, con **una excepción deliberada**: `F-COM-05` aparece en UF-M2 (como *previsión* que madura) y en UF-M5 (como *confirmación* al cierre). No es duplicación: es el mismo objeto en dos momentos, por diseño ("una decisión que empieza como previsión y termina confirmándose").
2. **Hand-offs ausentes o circulares** — la cadena es lineal y sin ciclos: cliente `UF-C1 → UF-C2 → UF-C3`; comerciante `UF-M1 → UF-M2 → UF-M5 → UF-M3 → UF-M4`. Cruces sanos: UF-M1 (publicar) habilita UF-C1; UF-C2/UF-C3 se reflejan en UF-M2; [SYS-03](automatizaciones.md) habilita UF-M4 e informa a UF-C3. No hay A→B→A.
3. **Pantallas nombradas de forma inconsistente** — un punto a canonizar en la Sección 2: la superficie de reservar aparece como *"Reserva · captura y confirmación"* (consolidé "captura de identidad" + "confirmación" del caso de uso F-CLI-02 en una sola pantalla). El resto es consistente (Estudio · orden de trabajo/editorial; P-01 Preventa Viva; P-02 Definir cantidades; Workspace · preparación / entrega; Página pública · la edición; Vista pública de la reserva). **Pendiente:** fijar el inventario de pantallas en la Sección 2 y alinear estos nombres.
4. **Casos de uso sin flujo asociado** — ninguno. F-COM-01…07 y F-CLI-01…04 están todos cubiertos. Las automatizaciones (SYS-01/02/03) no son casos de uso: SYS-01 sostiene UF-M1, SYS-03 dispara hand-offs, SYS-02 produce la muerte *vencida* sin recorrido de usuario.
5. **Flujos sin comienzo o final claro** — ninguno: los ocho tienen Punto de entrada y Fin explícitos.

**Único ítem accionable:** canonizar los nombres de pantalla (punto 3) cuando cerremos el inventario de la Sección 2. No impide documentar ningún recorrido.
