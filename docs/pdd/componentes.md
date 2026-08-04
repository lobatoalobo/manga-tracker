# 4 · Componentes (UI Kit)

Catálogo de piezas reutilizables extraídas de las ocho pantallas congeladas y **depurado por la revisión de arquitectura** (ago 2026). La vara fue una sola: *¿encapsula una responsabilidad reutilizable con interfaz estable, o es un arreglo de otras piezas que solo existe una vez?* De 20 nombres iniciales quedaron **11 componentes reales**; el resto pasó a **composición/patrón** o **se movió al dominio**.

**Cómo leer cada ficha:** ID · Responsabilidad · Dónde se usa · Props · Estados · Variantes · Qué NO hace · Dependencias.

> **Interfaces implementadas (Fase 0 · UI Kit 11/11, `components/retail/ui/`).** Las líneas **Props** reflejan la interfaz **implementada y aprobada** (algunas renombran/expanden la ficha original por decisiones de C3–C11 — ver `components/retail/ui/README.md`). Responsabilidades, estados y "qué NO hace" no cambian.

**Dos cosas viven en el dominio (Fase 0), no acá; los componentes las *consumen*:**
- La **máquina de estados de la promesa** y el **ciclo de pago**, con sus **mapeos estado → etiqueta** (cliente/tienda). `Pill`, y las composiciones de pago/estado, los renderizan; no los deciden.
- El **modelo de contacto** `{nombre, whatsapp, …}`.

Las **decisiones transversales** (DT) tampoco viven acá: un botón es un botón aunque el acceso sea por link o por login.

---

## Inventario

| ID | Componente | Tipo | Usado en |
|---|---|---|---|
| C-00 | Tokens & Tema | fundación | todas |
| C-01 | Button | primitivo | todas |
| C-02 | Money | primitivo | P-01·02·04·05·06·07·08 |
| C-03 | Cover | primitivo | todas |
| C-04 | Pill | primitivo | P-01·03·04·06·07·08 |
| C-05 | TomoLine | compuesto | todas |
| C-06 | Portada | compuesto | P-03·04 |
| C-07 | Comprobante | compuesto | P-06·08 |
| C-08 | WorkspaceShell | estructura | P-01·02·03·07·08 |
| C-09 | ActionBar | estructura | P-01·02·03·04 |
| C-10 | BottomSheet | estructura | P-05 |
| C-11 | Search | estructura | P-08 |

> Los IDs se **renumeraron** tras el refactor (C-00…C-11). Las composiciones y lo movido al dominio están más abajo, sin ID de componente.

---

## Primitivos

### C-00 · Tokens & Tema
**Responsabilidad** — Única fuente de color, tipografía y tema. Nadie hardcodea un hex.
**Dónde se usa** — Todas.
**Props / contenido** —
- *Color:* `--paper/-2/--card` · `--ink/-2/-3` · `--hair/-2` · `--mark/-2/-soft` (acento) · `--warn/-soft` (atención) · `--go/-soft` (éxito).
- *Tipografía:* `--serif` (cuerpo editorial) · `--sans` (etiquetas/UI) · `--mono` (datos y dinero).
- *Roles semánticos:* **mark** = acento/acción destacada · **warn** = atención (faltante, pago pendiente) · **go** = cerrado bien (pagado, cumplido).
**Estados** — Tema **light/dark** vía `prefers-color-scheme` + override `:root[data-theme=…]` en ambas direcciones.
**Qué NO hace** — No introduce color fuera de las tapas en superficies públicas. No define componentes.
**Dependencias** — Ninguna.

### C-01 · Button
**Responsabilidad** — Disparar la acción principal o secundaria. El texto **describe la acción** ([D-017](decisiones-congeladas.md)).
**Dónde se usa** — Todas.
**Props** *(implementada)* — `children` (contenido; reemplaza `label` para admitir ícono) · `variant` (primary | ghost | warn) · `size` (default | small) · `type` (button | submit) · `disabled` · `loading` (`aria-busy`, sin spinner) · `onClick` · `ariaLabel` (solo-ícono).
**Estados** — default · hover · disabled.
**Variantes** — primary (relleno tinta) · ghost (hairline) · warn (contorno, acciones de baja).
**Qué NO hace** — No navega solo ni contiene lógica. Nunca dice el estado del formulario ("Confirmar").
**Dependencias** — C-00.

### C-02 · Money
**Responsabilidad** — Mostrar un monto de forma consistente.
**Dónde se usa** — Precios y totales en P-01·02·04·05·06·07·08.
**Props** *(implementada)* — `cents` (garantía de unidad; siempre vía `formatArsCents`; reemplaza `amount`) · `variant` (inline | total; reemplaza `size`).
**Variantes** — inline (`$3.200`) · total destacado.
**Qué NO hace** — No calcula (recibe el número). No conoce el modo de pago.
**Dependencias** — C-00 (`--mono`, `tabular-nums`, `es-AR`).

### C-03 · Cover
**Responsabilidad** — Representar visualmente un tomo (la tapa).
**Dónde se usa** — Todas.
**Props** *(implementada)* — `serie` · `volumen?` · `imagen?` (opcional; hoy greybox tipográfico si falta) · `estadoVisual?` (normal | faltante | atenuada) · `size?` (xs…xl). Componente cliente (`<img>` con fallback greybox por `onError`); **sin `next/image`** (el repo usa `<img>`).
**Estados** — normal · **faltante** (grayscale) · **atenuada** (lo que se debe).
**Variantes** — por tamaño: fila (24×34) → principal de portada (74×110).
**Qué NO hace** — Ninguna lógica de reserva ni pago. Sabe pintar un tomo.
**Dependencias** — C-00.

### C-04 · Pill
**Responsabilidad** — Píldora de etiqueta: informativa o accionable. **Unifica** lo que antes eran StatusPill, Chip y PayChip.
**Dónde se usa** — Estado de edición (masthead), novedades sugeridas (P-03), tag "Principal" (P-04), estado de pago a un vistazo (P-01/06/08).
**Props** *(implementada)* — `children` (reemplaza `label`) · `tono` (neutral | mark | warn | go) · `dot?` (decorativo, `aria-hidden`) · `prefijo?` (p. ej. "+") · `onClick?`. Sin `onClick` → `<span>` display-only; con `onClick` → `<button>` nativo.
**Estados** — default · hover (si es accionable).
**Variantes semánticas** (no son componentes, son usos): **status** (con dot, en masthead) · **chip-sugerida** (prefijo "+", agrega al tocar) · **tag** (no accionable) · **pay** (tono según ciclo de pago).
**Qué NO hace** — No decide el estado; lo refleja. La verdad vive en la máquina de dominio.
**Dependencias** — C-00.

---

## Compuestos de contenido

### C-05 · TomoLine
**Responsabilidad** — Una fila que representa **un tomo dentro de una lista o pedido**: tapa + identidad + cantidad + precio + **una acción contextual inyectada por slot**.
**Dónde se usa** — Todas (la pieza más transversal).
**Props** *(implementada)* — `tomo` ({serie, volumen?, autor?, imagen?}) · `cantidad?` · `precioCents?` (reemplaza `precio`+`mostrarPrecio`: presencia = mostrar) · `aux?` (contenido auxiliar) · **`accion?` (slot)** · `estadoVisual?` (normal | sin-precio | faltante | atenuada; absorbe `marca?`). Tapa `aria-hidden` (la identidad textual es el nombre accesible); fila no clickeable; semántica de lista a cargo de la pantalla.
**Estados** — normal · **sin precio** (warn, borde punteado) · **faltante** · **atenuada** (debe).
**Variantes** (por lo que va en el slot) — lectura (P-06) · precio editable (P-03) · "A pedir" numérico ("—" ≠ 0, [D-016](decisiones-congeladas.md)) · stepper −/+ y × (P-04/05) · "no llegó"/dar de baja (P-07) · se lleva/debe (P-08).
**Qué NO hace** — No conoce el pedido completo ni el total. No dispara la reserva. **No conoce el catálogo de acciones**: recibe la que corresponde (evita volverse god-component).
**Dependencias** — C-03, C-02, y el componente que vaya en el slot (p. ej. C-01).

### C-06 · Portada
**Responsabilidad** — La **composición editorial** de una edición: principal + secundarias, tal como se compone (P-03) y se muestra (P-04). Acciones de edición **por slot**.
**Dónde se usa** — P-03 (editor mini), P-04 (pública, grande).
**Props** *(implementada)* — `principal?` (PortadaItem | null) · `secundarias?` (PortadaItem[], orden recibido) · `tamano?` (mini | grande; **reemplaza `modo`**: escala de tapas + info) · `vacio?` (contenido del estado vacío). Cada `PortadaItem` = { tomo, precioCents?, aux?, **`accion?`** } → las acciones editoriales entran **por item** (reemplaza `accionesTomo` render-prop). En `grande` la tapa va `aria-hidden`; en `mini` es informativa. *Límite: `Cover` tope `xl`; escala hero pública puede requerir extender `Cover` (P-04).*
**Estados** — **vacía** (válida = lista pura, [D-006](decisiones-congeladas.md)) · **con ≥1** (siempre exactamente una principal, [D-008](decisiones-congeladas.md)).
**Variantes** — editor · pública.
**Qué NO hace** — No decide qué va en portada. No reordena por relevancia ([D-010](decisiones-congeladas.md)). Independiente del orden de carga ([D-007](decisiones-congeladas.md)).
**Dependencias** — C-03.

### C-07 · Comprobante
**Responsabilidad** — El artefacto del comprobante de pago: **adjuntar/enviar** (cliente) y **ver/confirmar** (tienda).
**Dónde se usa** — P-06 (cliente), P-08 (tienda).
**Props** *(implementada)* — `contexto` (cliente | tienda) + `estado` (sin-comprobante | seleccionado | enviado | confirmado | rechazado) — **reemplazan `modo`**, matchean la máquina de pago · `archivo?` ({nombre, fecha?}) · `referencia?` (monto ya formateado; la pantalla pasa `Money`) · `nota?` (motivo de rechazo) · callbacks `onSeleccionar/onQuitar/onEnviar/onVer/onConfirmar/onRechazar` (un botón se muestra solo si su callback existe). **Controlado**; incluye `<input type="file">` nativo que **solo captura el `File`** (sin upload/OCR/backend).
**Estados** — sin adjuntar · adjuntado · **enviado (por validar)** · **validado**.
**Variantes** — cliente (adjuntar→enviar) · tienda (ver→confirmar).
**Qué NO hace** — No procesa pagos reales (no es pasarela). No hace OCR ni verifica el monto: la tienda decide ([DT-04](decisiones-congeladas.md), parte de la máquina de estados de pago).
**Dependencias** — C-01, C-00, ciclo de pago (dominio).

---

## Estructura / layout

### C-08 · WorkspaceShell
**Responsabilidad** — Contenedor de las pantallas del **comerciante** para una edición: identidad #N + estado + **navegación entre fases**. **Absorbe el Masthead** (kicker + h1 + `Pill` de estado). Resuelve la inconsistencia I-6.
**Dónde se usa** — P-01·02·03·07·08.
**Props** *(implementada)* — `edicion` ({numero, semana, estado: {label, tono?}}) · `faseActual` (creacion | preventa | cierre | preparacion | entrega) · `fasesDisponibles?` (inyectadas; default todas) · `onNavegar?` (callback **neutro**, sin rutas) · `children` (main) · `aside?` (2ª columna, apila por flex-wrap) · `pie?` (región inferior siempre visible por **flex**). Landmarks `header`/`nav[aria-label]`/`main`; `aria-current="page"` en la fase activa; llena su padre (la página provee el wrapper full-height).
**Estados** — Por fase (la fase disponible depende del estado de la edición).
**Qué NO hace** — No implementa cada fase. Su **forma exacta** (tabs/stepper) se fija al abrir Fase 1; acá se documenta la necesidad, extraída del recorrido M1→M2→M5→M3→M4.
**Dependencias** — C-04 (Pill de estado), C-00.

### C-09 · ActionBar
**Responsabilidad** — Barra fija al pie con síntesis del estado + CTA principal, a veces **bloqueado con motivo**.
**Dónde se usa** — P-03 (publicar), P-04 (resumen del pedido), P-01/02 (cerrar).
**Props** *(implementada)* — `resumen?` (síntesis/progreso; reemplaza `status`) · `acciones?` (slot de `Button`; reemplaza `botones`) · `bloqueo?` (motivo en `role="status"`, marca `data-bloqueada`; **no calcula** el bloqueo) · `loading?` (`aria-busy`) · `sticky?` (solo standalone; dentro del shell la posiciona el layout). Componente independiente (se usa sin shell en P-04).
**Estados** — activa · **bloqueada** con motivo accionable ("faltan 2 precios" [D-004](decisiones-congeladas.md); "queda un —" [D-016](decisiones-congeladas.md)).
**Variantes** — publicación · resumen de pedido con total · cierre.
**Qué NO hace** — No calcula el bloqueo (recibe si puede o no y por qué).
**Dependencias** — C-01, C-02, C-00.

### C-10 · BottomSheet
**Responsabilidad** — Capa modal inferior **sobre** la página, sin cambiar de contexto.
**Dónde se usa** — P-05 (sobre P-04).
**Props** *(implementada)* — `abierta` · `onCerrar` · `titulo?` · `descripcion?` · `children` · `acciones?` · `ariaLabel?` (fallback de rótulo). Componente cliente; portal a `document.body`; `role="dialog"` + `aria-modal="true"`; cierra por botón/overlay/**Escape**; foco inicial + restauración + Tab-wrap mínimo; **scroll lock** reversible del `body`; sin animación (diferida).
**Estados** — abierta / cerrada.
**Qué NO hace** — No es navegación de página. Respeta `prefers-reduced-motion`.
**Dependencias** — C-00.

### C-11 · Search
**Responsabilidad** — Encontrar rápido **por nombre** dentro de una lista (ritmo del mostrador).
**Dónde se usa** — P-08.
**Props** *(implementada)* — `valor` (controlado) · `onChange` ((valor)=>void, en vivo) · `placeholder?` · `disabled?` · `onSubmit?` (Enter, opcional) · `ariaLabel?`. **Elimina `resultados`**: no filtra, no conoce personas/pedidos, no renderiza resultados (los pone la pantalla). `<form role="search">` + `<input type="search">` + botón limpiar.
**Estados** — con resultados · vacío.
**Qué NO hace** — No busca en el catálogo. En v1 filtra del lado del cliente.
**Dependencias** — C-00.

---

## Composiciones y patrones (NO son componentes)

Se **arman en cada pantalla** con los componentes de arriba. Se documentan para que la implementación los reconozca y no los reinvente ni los promueva a componente sin evidencia.

- **PedidoPorPersona** *(patrón)* — "una persona + sus tomos + total + estado + acción de la fase". Se ensambla con `TomoLine[]` + `Pill` + `Money` + línea de contacto + `Button`/`Comprobante` según la fase. Sus formas (fila de P-08, ficha de P-08, tarjeta de P-07, resumen de P-05/06, lente de P-01) **divergen demasiado** para un solo componente. *Si al implementar emerge un marco común mínimo (cabecera contacto+total con cuerpo en slot), se extrae ahí, con evidencia.*
- **Bloque/línea de pago** *(composición)* — el "Pagado / Comprobante / Falta $X" y su resolución = `Pill` + `Money` + `Comprobante`. El chip es literalmente Pill+Money; las acciones son `Comprobante` en su modo (cliente envía / tienda confirma-cobra). El mapeo *estado de pago → etiqueta* es **dominio**.
- **HeroEstado** *(composición, P-06)* — título + subtítulo alimentados por el mapeo *estado de la promesa → copy de cliente* (dominio). Render tipográfico trivial.
- **Lente** *(composición, P-01)* — segmented toggle + pivote Por tomo/Por persona. Si el toggle reaparece, se extrae un `Segmented` primitivo entonces.
- **PanelRecepción** *(detalle de P-07)* — 2 `Button` ("Llegó todo"/"Faltó algo") + línea de resumen ([D-018](decisiones-congeladas.md)). Específico de la recepción.

---

## Movido al dominio (Fase 0)

No son UI. Viven en la capa de dominio; los componentes los consumen.

- **Modelo de contacto** — `{ nombre, whatsapp, (extensible: alias, instagram…) }`. La *captura* (P-05) y el *display* (línea en los pedidos) son renders triviales sobre este modelo.
- **Máquina de estados de la promesa** + sus **mapeos a etiqueta** (dominio → cliente → tienda). Alimenta `Pill`, HeroEstado, PedidoPorPersona.
- **Ciclo de pago** (incluida la validación de comprobante) + su mapeo a etiqueta. Alimenta el bloque de pago y `Comprobante`.

> Estos tres son parte de los **bloqueantes de implementación** que se definen antes de Fase 0 (ver [dominio/](dominio/)).

---

## Grafo de dependencias (actualizado)

```
C-00 Tokens
 └─ C-01 Button · C-02 Money · C-03 Cover · C-04 Pill      (4 primitivos)
     ├─ C-05 TomoLine     (Cover + Money + [slot acción])
     ├─ C-06 Portada      (Cover + [slot acciones editor])
     ├─ C-07 Comprobante  (Button)
     ├─ C-09 ActionBar    (Button + Money)
     ├─ C-10 BottomSheet · C-11 Search
     └─ C-08 WorkspaceShell (Pill + absorbe Masthead)

Composiciones (por pantalla, no son piezas):
   PedidoPorPersona · bloque de pago (Pill+Money+Comprobante) · HeroEstado · Lente · PanelRecepción

Dominio (Fase 0, consumido por los componentes):
   Modelo de contacto · máquina de estados de promesa · ciclo de pago (+ mapeos a etiqueta)
```

**Dividendo:** los 4 primitivos + `TomoLine`/`Comprobante` desbloquean todas las composiciones; con `WorkspaceShell` alrededor, **P-07 y P-08 se ensamblan casi solas**, P-01 reutiliza la mitad y P-02 casi entera. Y los "estados como texto" ya no son componentes: son mapeos de dominio, lo que elimina de raíz el patrón duplicado.
