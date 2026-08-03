# Revisión transversal · de las 8 pantallas al plan de implementación

Cierre del primer arco (P-01…P-08). No reabre conceptos: convierte lo diseñado en un plan concreto. Ejes: consistencia · vacíos transversales · simplificación. Entregables al final: componentes, orden de build, qué se difiere.

---

## 1 · Inconsistencias encontradas

| # | Dónde | Qué | Propuesta |
|---|---|---|---|
| I-1 | P-01 vs P-02 | El CTA "Cerrar la preventa **y armar el pedido**" (P-01) y "Cerrar la preventa **y fijar cantidades**" (P-02) usan la misma palabra *cerrar* para cosas distintas: P-01 **navega** a la superficie de cierre; P-02 **ejecuta** el cierre. | P-01 → **"Cerrar la preventa"** (abre P-02). P-02 → **"Cerrar y fijar cantidades"** (el commit). El verbo *cerrar* aparece una vez como puerta y otra como acto. |
| I-2 | P-05 vs P-06 | Sustantivo del cliente mezclado: se **hace un pedido** (P-04/P-05) pero se **vuelve a la reserva** (P-06: "tu reserva sigue en pie", "dar de baja la reserva"). | Elegir **un** sustantivo de cara al cliente para la canasta que hizo la persona. Recomiendo **"pedido"** en todo el cliente (Hacer pedido → Tu pedido → Ver mi pedido → Dar de baja el pedido). *"Promesa"* y *"ejemplar"* quedan como lenguaje de dominio, nunca de UI. |
| I-3 | P-06 (cliente) vs P-07 (tienda) | **"Dar de baja"** significa dos muertes distintas: en P-06 es *cancelar* (la persona, rama **cancelada**); en P-07 es *no poder cumplir* (la tienda, rama **caída**). | Mantener "Dar de baja" para el cliente. Para la tienda usar un verbo propio de la rama caída (p. ej. **"No lo voy a cumplir"** / "Dar de baja el faltante"), y **nombrar las ramas distinto en el dominio** (cancelada ≠ caída). |
| I-4 | P-06 / P-07 / P-08 | El ciclo de **pago/comprobante** aparece con etiquetas propias en cada pantalla: cliente "Listo (a pagar) → Pagado (a retirar)"; tienda P-08 "por validar / pagado / falta $X". | Un **único ciclo de pago** con nombres canónicos, y dos vistas (cliente/tienda) que lo espejan. Ver DT-04. |
| I-5 | Todas | Los **estados de la promesa** se nombran distinto por pantalla (dominio: reservado→apartado→listo para retirar→retirada; cliente: Esperando→Listo→Pagado→Retirado; tienda: apartado/faltante/listos/dados de baja). | **Máquina de estados única** de la promesa + tabla de mapeo `dominio ↔ etiqueta cliente ↔ etiqueta tienda`. Es el artefacto compartido más importante (ver DT-05 y Componentes). |
| I-6 | P-01/P-02/P-03/P-07/P-08 | No está definida la **navegación entre las 5 pantallas del comerciante** de una misma edición (M1→M2→M5→M3→M4). Hoy son "pantallas distintas" sin shell que las una. | Definir un **shell de Workspace** por edición (identidad #N + estado + acceso a la fase que corresponde). Ver Componentes / Simplificación S-1. |
| I-7 | P-01 "Por persona" | Muestra "estado de pago" durante la preventa, pero en el modo que implementamos (**pago al llegar**) todavía no hay pago en preventa. | Coherencia depende de DT-02: en v1 (un solo modo) la columna de pago en preventa queda vacía/N-A; se enciende solo si el modo lleva seña. |

Ninguna es una contradicción de modelo que obligue a reabrir diseño. La más cercana a "trampa" es el **modelo de pago** (I-7 + P-05 "lugar de pago" + P-06 "pago al llegar" + P-01 "señas"): describen momentos de pago distintos que solo cierran cuando se fija DT-02.

---

## 2 · Decisiones transversales a resolver antes de implementar

Cruzan ≥2 pantallas y bloquean o condicionan la implementación. Cada una con una **recomendación** para decidir rápido (no reabren concepto).

| ID | Decisión | Pantallas | Bloquea | Recomendación para v1 |
|---|---|---|---|---|
| **DT-01** · Acceso a reservas sin cuenta *(ya abierta)* | Cómo vuelve la persona a su pedido y cómo se recuerda para autocompletar, sin login; y que **solo ella** lo vea. | P-04 (recordar) · P-05 (guardar/autocompletar) · P-06 (entrar) · SYS-03 (aviso con link) | **P-05, P-06** | **Link opaco por pedido** (token no adivinable) que Nakama manda por WhatsApp (SYS-03) y la persona guarda; autocompletar por reconocimiento del mismo dispositivo/link. Sin cuenta en v1; sin listado global de reservas de una persona. |
| **DT-02** · Modelo de pago / seña | Modos: sin pago / seña / pago total, y **cuándo** se paga. | P-01 (evidencia) · P-05 (lugar de pago) · P-06 (pago al llegar) · P-07 (no cobra) · P-08 (cobra saldo) | **P-05, P-06, P-08** | v1 implementa **un solo modo**: sin pago al reservar → **pago total al llegar** (transferencia + comprobante). La promesa lleva un **sub-estado de pago genérico** para admitir seña después **sin rediseño**. Difuminar seña de la UI, no del modelo. |
| **DT-03** · Fecha y cierre de preventa *(el recurrente)* | Dónde se fija la fecha de cierre; si el cierre es manual o automático; qué ve quien llega tarde. | P-03 (fijar) · P-01 (ancla) · P-02 (disparador) · P-04 (post-cierre) · SYS-02 | **P-01, P-02, P-03, P-04** | Fecha **se fija al publicar (P-03)**, editable en P-01. Cierre **manual** en v1 (P-02); la fecha es ancla/orientación, no gatillo automático. Tras el cierre, P-04 muestra "Preventa cerrada" (sin reservar). SYS-02 (auto-cierre/vencimiento) se difiere. |
| **DT-04** · Validación de comprobante | Estado del comprobante y quién/cuándo valida. | P-06 · P-07 · P-08 | **P-06, P-08** | Ciclo: *sin pago → comprobante enviado (por validar) → validado (pagado)*. Enviar lo pone "por validar"; **la tienda valida en P-08** (o antes). No hay superficie nueva (resuelto en P-08 v1). Sub-caso de DT-02. |
| **DT-05** · Ramas de muerte de la promesa | Modelar **cancelada** (cliente) / **caída** (tienda) / **vencida** (sistema): gatillos, hasta cuándo, qué ve el cliente. | P-06 · P-07 · P-08 · SYS-02 | **P-06, P-07** | Una sola definición de dominio con las 3 ramas. **Cancelada:** cliente, permitida hasta *lista para retirar* (después no). **Caída:** tienda, cuando un faltante no llega. **Vencida:** SYS-02, difi­rible en v1 (sin vencimiento automático). El cliente ve cancelada/caída como finales en P-06. |

> Registradas también en [decisiones-congeladas.md → pendientes](decisiones-congeladas.md). DT-01 ya existía; DT-02…DT-05 consolidan vacíos que ya estaban dispersos en las fichas.

---

## 3 · Componentes compartidos a construir (antes de las pantallas)

**Fundacionales (Fase 0):**
- **Tokens/tema** — la paleta papel+tinta, `--serif/--sans/--mono`, light/dark con `prefers-color-scheme` + `[data-theme]`. Ya idénticos en los 8 mocks; codificarlos **primero**, una sola fuente.
- **`Cover`** — la tapa tipográfica (gradiente por paleta + serie + número), con variantes de tamaño (xs…xl). Aparece en las 8 pantallas.
- **`TomoLine`** — fila tapa + título/número + cantidad + precio; base de P-02, P-05, P-06, P-07, P-08.
- **`Money`** — monto en `--mono`, `$` + `tabular-nums`. Un solo formateador `es-AR`.
- **`Button`** — pill tinta (primary/ghost/warn) + estado disabled. Ya repetido idéntico.
- **`StatusPill`** — punto + etiqueta (masthead de P-01/P-03/P-07/P-08).
- **`PayChip` / bloque de pago** — Pagado / por validar / falta $X. Espeja el ciclo de DT-04 en P-01(persona)/P-06/P-08.
- **`Masthead`** — kicker + h1 + StatusPill (todas las superficies de Workspace).

**De dominio:**
- **Máquina de estados de la promesa** (I-5/DT-05) + **ciclo de pago** (I-4/DT-02/DT-04): el backbone que todas las pantallas leen/escriben. Con la tabla de mapeo dominio↔cliente↔tienda.
- **`PedidoPorPersona`** — persona (Nombre+WhatsApp) + sus tomos + total + estado(s) + acción. Variantes: lente de P-01, tarjeta de P-07, fila+ficha de P-08.
- **Modelo de contacto** (Nombre+WhatsApp, extensible) — único, usado en P-01/P-05/P-06/P-07/P-08.
- **`WorkspaceShell`** (I-6/S-1) — identidad de edición + fase, contenedor de las 5 pantallas del comerciante.

---

## 4 · Orden recomendado de implementación

**Fase 0 · Fundaciones** (sin pantalla): tokens/tema · componentes compartidos · **máquina de estados de promesa + ciclo de pago**. Todo lo demás depende de esto.

**Fase 1 · Comerciante — creación** (no toca vacíos del cliente; arranca el ciclo):
1. **P-03 · Estudio** (crear/publicar). Necesita DT-03 (fecha al publicar).
2. **P-01 · Preventa Viva + P-02 · Definir cantidades** — construir como **un componente en dos modos** (monitor/cierre; ver S-1). Necesita DT-03.

**Fase 2 · Cliente** (necesita DT-01 acceso + DT-02 pago):
3. **P-04 · Página pública** (descubrir/seleccionar) — la de menos dependencias del cliente.
4. **P-05 · Reserva** — necesita DT-01 (recordar datos) y DT-02 (lugar de pago).
5. **P-06 · Vista del pedido** — necesita DT-01 (entrar), DT-04 (comprobante), DT-05 (finales).

**Fase 3 · Comerciante — cumplimiento** (necesita llegada de mercadería + SYS-03):
6. **P-07 · Preparación** — necesita SYS-03 (aviso) y rama caída (DT-05).
7. **P-08 · Entrega** — necesita ciclo de pago/comprobante (DT-02/04) y *retirada*.

**Transversal a lo largo:** SYS-01 (sugeridas → alimenta P-03), SYS-03 (avisos → bisagra P-07→P-06). SYS-02 (vencimientos) se difiere.

---

## 5 · Qué se puede diferir sin riesgo

- **Seña / modos de pago múltiples** (DT-02) → v1 un solo modo; estados modelados genéricos. La UI de seña se difiere.
- **SYS-02 · vencimientos / auto-cierre** → v1 cierre manual; la rama *vencida* se difiere.
- **Retiro por un tercero** (P-08 CA-4) → borde documentado, sin campos de autorización.
- **Faltante parcial de línea con cantidad >1** (P-07 borde) → diferido.
- **Corrección de contenido tras publicar** (P-01 #4 / P-03 #1) → default: reabrir el Estudio sobre la edición publicada; no es superficie nueva.
- **Vocabulario de estado por tomo en la pública** (P-04 #3) y **detalle de un tomo** → default: solo "disponible" / "preventa cerrada"; detalle inline. Sin escasez/urgencia ([D-012](decisiones-congeladas.md)).
- **Personalización "para mí" literal** (D-010 futuro), listas comunitarias, métricas sociales → post-piloto / fuera por principio.

---

## Apéndice · Oportunidades de simplificación (referencia)

- **S-1 · P-01 + P-02 = un componente, dos modos.** P-02 es P-01 con foco *Por tomo* forzado, orden de evidencia invertido y CTA de cierre. No son dos pantallas a construir por separado: `PreventaWorkspace mode={monitor|cierre}`. (No reabre el concepto de que sean "vistas distintas"; unifica la construcción.)
- **S-2 · P-07 + P-08 comparten el modelo por-persona.** Preparar (por preparar/faltante) y entregar (listo para retirar) son fases sobre los mismos pedidos; comparten `PedidoPorPersona`, búsqueda por nombre y `TomoLine`. Candidatos a un mismo shell de cumplimiento filtrado por estado.
- **S-3 · Cliente:** P-05 (sheet) y P-06 (vista) comparten resumen de pedido + contacto + bloque de pago. Mismos componentes, distinta envoltura.
- **S-4 · Un solo cálculo de total** y **un solo modelo de contacto** en todo el producto (hoy recomputados en 5–6 lugares).
