> **Documento histórico.** La fuente de verdad vigente para Retail es `docs/pdd/`.

# UX Review — Retail / Preventas

**Rol:** revisión de producto (Product Design senior). **No es** un documento de implementación.
**Fecha:** 2026-07-30. **Alcance:** experiencia de administración de preventas (tienda) y su borde con el cliente.
**Encargo:** encontrar la mejor experiencia posible antes de seguir construyendo funcionalidad. No defender el diseño actual.

---

## 0. Veredicto (sin vueltas)

**Sí, hay que rehacer la navegación de Retail.** No es un problema de estética ni de "pulir": es que **la UI es un espejo 1:1 del modelo de datos**. Cada entidad del dominio se convirtió en una pantalla, y cada verbo del dominio en un formulario. El resultado funciona, pero se siente como un *panel de base de datos con estilo*, no como un producto.

El usuario no administra `Campaign`, `Offer` y `Volume`. El usuario **abre una preventa, le pone tomos, la publica, recibe reservas y las despacha.** Hoy la aplicación lo obliga a traducir su intención a nuestro esquema relacional en cada clic. Ese es el problema central del que se desprende todo lo demás.

Diagnóstico en una frase: **construimos el backoffice del dominio; falta construir la herramienta de trabajo del usuario.**

---

## 1. El problema de fondo: la UI habla el idioma de la base de datos

Hoy existe una correspondencia casi perfecta entre tablas y pantallas:

| El dominio dice | La pantalla se llama | El usuario piensa |
|---|---|---|
| `PreorderCampaign` | "Campaña" / "Nueva campaña" | "una preventa" |
| `PreorderOffer` | "Ofertas" | "los tomos que vendo" |
| `StoreOrder` | "Órdenes" | "las reservas de la gente" |
| fulfillment | "Cumplimiento" | "qué pedí y qué llegó" |
| handoff | "Preparación y retiro" | "qué está listo para entregar" |
| notifications | "Avisos" | "avisarle a la gente que llegó" |
| `status` | `DRAFT` / `PUBLISHED` (enum crudo en pantalla) | "borrador" / "en venta" |

Cuando la arquitectura de la información **es** el ERD, el usuario paga el costo de nuestra normalización: navega entre tablas en lugar de avanzar en su trabajo. Linear, Notion, Shopify o GitHub Projects hacen exactamente lo contrario: esconden el modelo y exponen el *trabajo*. Una "issue" en Linear también es una fila con FKs, pero nadie siente que está editando una fila.

---

## 2. Recorrido crítico de la experiencia actual (por tareas reales)

No describo pantallas: describo lo que le pasa a la persona.

### Tarea A — "Voy a abrir una preventa" (la más frecuente y la primera impresión de Agustín)

Recorrido real hoy:
1. Entra a **Admin de tienda**.
2. Clic a **Preventas** → aterriza en una **lista** (título · semana · "N ofertas" · estado en mayúscula).
3. Clic a **Nueva** → pantalla **"Nueva campaña"**: un formulario administrativo (título, semana, descripción, fecha de apertura, fecha de cierre). Le pedimos fechas y "semana" antes de que haya decidido siquiera qué vende.
4. Guarda → cae en el **detalle de la campaña**.
5. Busca un tomo → lo agrega → **repite búsqueda+agregar por cada tomo** (no hay carga en lote).
6. Recién ahí ve el botón **Publicar**.

**Costos:** 4–5 cambios de pantalla antes de agregar el primer tomo; un formulario de fechas/semana que interrumpe el pensamiento ("yo quería cargar tomos, no llenar metadata"); carga de tomos de a uno. La primera impresión es "esto es un ABM", no "esto es una herramienta".

### Tarea B — "Estoy laburando una preventa en marcha" (el día a día del piloto)

Acá está el daño mayor. Para operar **una sola** campaña publicada, el trabajo diario está **repartido en 6 pantallas hermanas**:

`Detalle` · `Órdenes` · `Órdenes/[id]` · `Cumplimiento` · `Preparación y retiro` · `Pagos` · `Avisos`

- Unidas por una **red suelta e inconsistente** de links: el detalle linkea a 5 sub-pantallas; "Cumplimiento" linkea a Órdenes/Preparación/Pagos/Avisos; "Pagos" y "Avisos" solo a Cumplimiento. No hay un modelo mental de "dónde estoy" ni "qué sigue". Es un anillo de páginas con flechitas.
- Cada tarea cotidiana ("¿a quién le llegó y no le avisé?", "¿quién me debe plata?", "¿qué preparo hoy?") **es una pantalla distinta**, cuando en realidad son **la misma pregunta vista por facetas**: *el estado de mis reservas*.
- El usuario **cambia de contexto constantemente** para armar en su cabeza una foto que la app nunca le da entera.

**Costo:** para el trabajo repetitivo, la fricción es altísima. Cada pregunta = una navegación. Nada vive junto.

### Tarea C — "¿Cómo van mis preventas?" (la mirada de dueño)

El **listado** —que debería ser el dashboard— comunica lo mínimo: título, semana, cantidad de ofertas y el estado. **No dice cuántas reservas hay, ni cuánta plata mueve, ni qué requiere atención.** Para saber "¿cómo viene la preventa de esta semana?" hay que **entrar** a la campaña y después a **Órdenes**. La pantalla que debería responder de un vistazo obliga a excavar.

---

## 3. Inventario de problemas (según tu lista)

- **Pasos innecesarios:** pedir semana/fechas/descripción en la creación, antes de cargar tomos. La creación debería ser un acto de una línea ("nombre → listo") y todo lo demás, opcional y en contexto.
- **Navegación redundante:** 6 sub-pantallas por campaña + volver siempre al "← Campaña". El mismo dato (una reserva) se mira desde Órdenes, Cumplimiento, Pagos, Preparación y Avisos: cinco puertas a la misma habitación.
- **Pantallas que pueden desaparecer:** **Cumplimiento**, **Preparación y retiro**, **Pagos** y **Avisos** no merecen ser destinos separados. Son *vistas/acciones* sobre las reservas. **Órdenes** y **detalle** pueden fundirse en un único workspace. (Ver §5, veredicto pantalla por pantalla.)
- **Exceso de CRUD:** todo es "listar → entrar → editar → volver". La preventa se siente como mantenimiento de tablas, no como avanzar un trabajo.
- **Cambios de contexto:** son el síntoma más caro. La unidad de trabajo real (la preventa) está fragmentada en 7 URLs.
- **Clics para tareas frecuentes:** abrir preventa ≈ 4–5 saltos + N búsquedas; operar el día ≈ un salto por pregunta. Ambas deberían ser ~1.
- **Terminología técnica:** "Campaña", "Ofertas", "Cumplimiento", "Avisos", y **estados en enum crudo** (`DRAFT`, `PUBLISHED`) mostrados tal cual al usuario. Es lenguaje de desarrollador filtrado a la superficie.
- **Fricción evitable:** carga de tomos de a uno; estado comunicado solo por texto en mayúscula; ninguna acción rápida donde se toman las decisiones (la lista).

---

## 4. La experiencia objetivo (describo el producto, no los componentes)

La idea rectora: **la preventa es la unidad de trabajo, y el ciclo de vida es la narrativa.** Todo lo demás son vistas y acciones sobre esa unidad.

### 4.1 Un tablero, no una lista

La pantalla principal es **un tablero visual de preventas** (tarjetas), organizado por el **momento del ciclo**: *Borradores · En venta · Cerradas*. Cada tarjeta cuenta la historia de esa preventa **sin entrar**:

- nombre (grande, humano),
- estado como **lenguaje visual** (color + forma + etiqueta clara), no como texto de enum,
- tomos incluidos,
- **reservas** y **monto estimado** (lo que hoy hay que excavar),
- una barra o señal de "cuánto de esto ya está resuelto" (pedido/llegado/entregado/cobrado),
- **acciones rápidas** contextualizadas al estado (un borrador ofrece *Publicar/Eliminar/Duplicar*; una activa ofrece *Ver reservas/Cerrar*).

El dueño entra al tablero y **entiende su negocio en 3 segundos**. Eso es lo que hoy no pasa.

### 4.2 Una sola pantalla de preventa (matar el anillo de 6 páginas)

Al abrir una preventa, **todo vive en un solo lugar**, sin volver a navegar entre hermanas:

- **Encabezado con estado y las acciones principales del momento** (una preventa en borrador muestra "Agregar tomos" y "Publicar"; una activa muestra "Cerrar", el link público, y el pulso de reservas).
- **Tomos incluidos** (lo que hoy son "Ofertas"): agregar desde catálogo o manual, en el mismo lugar, idealmente **carga en lote**.
- **Reservas** como una **sola tabla viva** donde cada fila es un cliente y su pedido, con su **estado combinado** (pagó / pedido al proveedor / llegó / listo / entregado). Las acciones que hoy son 4 pantallas (cumplimiento, preparación, pagos, avisos) pasan a ser **acciones en la fila o en la selección** ("marcar llegado", "registrar pago", "avisar llegada", "entregar"). El usuario **no va a Pagos**: le cobra a la reserva que está mirando.
- **Actividad / historia** de la preventa (qué pasó y cuándo), que da sensación de sistema vivo.
- Vistas por faceta como **filtros**, no como URLs: "con saldo pendiente", "llegó sin avisar", "listo para retirar" son *filtros de la misma tabla*, no destinos.

El principio: **el usuario no cambia de pantalla para cambiar de pregunta; cambia de filtro.**

### 4.3 El ciclo de vida como hilo narrativo

La app debería **contar la historia** que vos describís: *Nueva preventa → Agregar tomos → Publicar → Recibir reservas → Gestionar → Cerrar*. Eso se logra haciendo que **el estado dicte qué ve y qué puede hacer** el usuario:

- En **Borrador**, el foco es *armar* (cargar tomos, precios) y la acción heroica es **Publicar**. No mostramos "cumplimiento" ni "pagos" porque todavía no existen.
- Al **Publicar**, la pantalla *cambia de modo*: aparece el pulso de reservas y las herramientas de gestión. El link público cobra protagonismo ("compartí esto").
- En **gestión**, el trabajo es la tabla de reservas y sus acciones.
- **Cerrar** es el final del arco, no un botón perdido entre otros.

Cada estado **revela solo lo pertinente**. Hoy mostramos todo siempre; el usuario carga con complejidad que aún no le toca.

### 4.4 El estado como lenguaje visual

Cuatro estados, cuatro señales inmediatas (color + etiqueta humana +, donde sirva, progreso):

- **Borrador** — neutro/gris, "en preparación", claramente *no público*.
- **En venta** — color vivo/acento, con el pulso de reservas y el % de avance.
- **Cerrada** — apagada pero "completa", lectura de archivo.
- **Cancelada** — tachado/atenuado, lectura de descarte.

Nunca más `DRAFT` en mayúscula en la cara del usuario.

### 4.5 Terminología orientada al negocio

| Hoy (técnico) | Propuesto (negocio) |
|---|---|
| Campaña / Nueva campaña | **Preventa** / **Nueva preventa** / "Abrir una preventa" |
| Ofertas | **Tomos** (o "Productos" / "Ítems") |
| Órdenes | **Reservas** (o "Pedidos de clientes") |
| Cumplimiento | *desaparece como pantalla* → "Pedido al proveedor / Llegada" como acciones |
| Preparación y retiro | *desaparece* → "Listo para retirar / Entregar" |
| Avisos | **Avisar llegada** (acción, no sección) |
| Estados (enum) | Borrador / En venta / Cerrada / Cancelada |

### 4.6 Acciones rápidas: ¿tarjeta o detalle?

- **En la tarjeta del tablero:** las acciones de **ciclo de vida** de baja deliberación y alto uso — *Publicar*, *Cerrar*, *Duplicar*, *Eliminar* (borrador). Ventaja: el trabajo diario se resuelve sin entrar. Riesgo: acciones destructivas/irreversibles necesitan confirmación clara para no volverse peligrosas en un clic; el tablero no debe convertirse en un tablero de botones (sobrecarga visual). Regla: **máximo 1 acción primaria visible + un menú "⋯" para el resto.**
- **En el detalle:** las acciones que operan **sobre las reservas** (cobrar, marcar llegada, entregar, avisar) viven donde está el dato, en la fila.
- **Duplicar** merece destaque propio: durante el piloto vas a repetir estructuras de preventa; "Duplicar" convierte "abrir la de esta semana" en un acto de 1 clic. Es probablemente **la acción de mayor ROI** que hoy no existe.

---

## 5. Veredicto pantalla por pantalla

| Pantalla actual | Veredicto | Por qué |
|---|---|---|
| `/admin/preventas` (lista) | **Rehacer → Tablero de tarjetas** | Es el corazón de la experiencia y hoy es lo más pobre; no comunica reservas ni monto ni prioridad. |
| `/admin/preventas/nueva` | **Colapsar** | Crear una preventa debería ser inline (nombre → listo), no un formulario-destino con fechas/semana. |
| `/admin/preventas/[id]` (detalle) | **Absorber todo acá** | Debe volverse el **workspace único** de la preventa. |
| `/ordenes` + `/ordenes/[id]` | **Fundir en el workspace** | Las reservas son una tabla dentro de la preventa; el detalle de una reserva es un panel/expand, no una URL nueva. |
| `/cumplimiento` | **Eliminar como pantalla** | Es un *filtro + acción* sobre reservas. |
| `/preparacion` | **Eliminar como pantalla** | Ídem: "listo/entregar" es acción sobre la fila. |
| `/pagos` | **Eliminar como pantalla** | Cobrar es acción sobre la reserva; el "saldo pendiente" es un filtro. |
| `/avisos` | **Eliminar como pantalla** | "Avisar llegada" es acción; "llegó sin avisar" es filtro. |

De **10 pantallas** de preventas hoy, la experiencia objetivo vive esencialmente en **2**: **Tablero** + **Workspace de preventa** (con paneles/filtros internos). Esa reducción *es* la mejora.

---

## 6. Riesgos y honestidad de diseño

- **No tirar la lógica, sí la navegación.** El dominio y los servicios (que aprobaste) quedan; lo que cambia es cómo se orquestan en pantalla. Es rediseño de *front/IA*, no de back.
- **Densidad vs. simplicidad:** una "pantalla única" mal hecha se vuelve un tablero de instrumentos abrumador. La disciplina es **progressive disclosure**: el estado decide qué se muestra; lo secundario vive en paneles/filtros, no todo a la vez.
- **Mobile:** el tablero de tarjetas y las acciones-en-fila tienen que funcionar en teléfono (es un principio del proyecto). Una tabla de 6 columnas con acciones laterales no sobrevive a mobile; el diseño de reservas debe pensarse *mobile-first* (fila = tarjeta apilable).
- **Alcance del piloto:** para que **Agustín** tenga una buena primera impresión, el 80% del valor está en **(1) el tablero de tarjetas** y **(2) el workspace único con la tabla de reservas**. Los estados visuales y la terminología son baratos y de alto impacto. Duplicar es alto ROI. El resto puede seguir.

---

## 7. Qué decidir antes de diseñar en detalle (no implementar aún)

1. **¿Confirmás el cambio de paradigma?** UI alrededor del *flujo* (preventa como unidad + ciclo de vida), no de las entidades. Todo lo de abajo depende de este sí.
2. **Terminología:** ¿adoptamos "Preventa / Tomos / Reservas" como vocabulario oficial de producto? (Define copy, títulos y hasta nombres de rutas.)
3. **Prioridad del piloto:** ¿enfocamos primero en **Tablero + Workspace** (máxima primera impresión) y dejamos la reducción total de las 4 sub-pantallas operativas para una segunda pasada, o vamos por la fusión completa de una?
4. **Acciones en tarjeta:** ¿hasta dónde llevamos las acciones de ciclo de vida al tablero (Publicar/Cerrar/Duplicar/Eliminar) vs. dejarlas en el workspace?
5. **"Nueva preventa" inline:** ¿aceptamos crear con solo el nombre y mover fechas/semana a algo opcional dentro del workspace?

Cuando definas estos cinco puntos, el siguiente entregable natural es un **flujo/wireframe de baja fidelidad** (todavía sin código) del **Tablero** y del **Workspace de preventa**, para acordar la experiencia antes de tocar una línea.
