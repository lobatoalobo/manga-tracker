# Bloqueante 2 · Modelo de pago (DT-02)

Artefacto de dominio. Define **cuándo y cómo se paga** un pedido, separando el **modelo general de Nakama** (lo que el dominio debe admitir) de la **configuración del piloto** (lo que se habilita para Crumb). Cierra [DT-02](../decisiones-congeladas.md) salvo un dato pendiente (el modo real del Drop piloto). Absorbe [DT-04](../decisiones-congeladas.md), validación de comprobante.

El pago es una **faceta paralela** al ciclo de cumplimiento de la promesa (reservado → apartado → listo para retirar → retirada). Son ortogonales pero **con compuertas**. El ciclo de cumplimiento se formaliza en el [Bloqueante 3](maquina-estados.md); acá se define solo la faceta de pago, sus modos y sus compuertas.

---

## A · Modelo general de Nakama

El dominio **no asume** que siempre se paga el total contra llegada. Debe admitir conceptualmente **tres modos de pago**:

| Modo | Al reservar | Al llegar / retirar |
|---|---|---|
| **`sin_pago_previo`** | nada | paga el **total** |
| **`sena`** | paga una **seña** | paga el **saldo** |
| **`total`** | paga el **total** | nada |

**`modoPago` es una propiedad configurable, no una constante:**
- Vive en la **preventa** (default para todos sus tomos).
- Admite **override por tomo** en los casos que lo requieran (p. ej. un tomo caro con seña dentro de una preventa sin pago previo).
- La **UI** para elegir/mostrar cada modo puede quedar fuera de v1, pero **el modelo de datos y los estados ya los contemplan** — no se rediseña después.

> Este es el punto que corrige la contradicción: seña y pago total no son "futuro" del dominio; son parte del modelo desde ahora. Lo que se difiere es su **interfaz**, no su **existencia**.

---

## B · Configuración del piloto (Crumb)

Para el **Drop piloto de Crumb** se habilita **un único modo**, como **configuración del piloto — no como regla universal**.

**Estado de la decisión:**
- **DT-02 general → RESUELTO.** El dominio admite los tres modos; la máquina de estados los deriva de `modoPago` ([Bloqueante 3](maquina-estados.md)).
- **`pilot.modoPago` → SIN DEFINIR**, pendiente de validación con **Agustín**. No se precarga un modo probable: esa elección afecta pantallas y transiciones, y no queremos convertir una suposición en comportamiento del piloto.
- **La implementación del piloto NO puede activarse hasta elegir `pilot.modoPago`.** La selección puede hacerse después **sin tocar el dominio** (solo habilita una UI ya contemplada).

Cuando se confirme, se documenta acá como `pilot.modoPago = <modo>` y se implementa solo esa UI; los otros modos quedan latentes en el modelo.

---

## Modelo de datos (faceta de pago de la promesa)

| Campo | Contenido | Notas |
|---|---|---|
| `total` | monto del pedido | — |
| `pagado` | monto acreditado | 0 / seña / total según modo y momento |
| `saldo` | `total − pagado` | lo que falta cobrar |
| `comprobante` | referencia + estado | uno o varios según medio |
| `modoPago` | `sin_pago_previo` \| `sena` \| `total` | en la preventa, con override por tomo |

---

## Estados (de pago)

- **sin_cargo** — aún no corresponde pagar nada (solo en `sin_pago_previo`, antes de la compuerta de cobro).
- **por_pagar** — hay un monto **exigible ahora**: la seña (al reservar, modo `sena`), el total (al reservar, modo `total`), o el total/saldo (al llegar).
- **comprobante_enviado** *(por validar)* — se envió comprobante de un pago; espera validación.
- **parcial** — se acreditó parte (típicamente la seña); queda `saldo > 0` para más adelante.
- **pagado** *(saldado)* — `saldo == 0`; habilita el retiro por el lado del dinero.

*(El momento en que un cargo se vuelve exigible lo define el `modoPago` cruzado con la fase de la promesa: reservar dispara seña/total; la llegada dispara el total/saldo.)*

---

## Transiciones · actores

| Transición | Actor | Cuándo / dónde |
|---|---|---|
| **Cobrar al reservar** (sin_cargo → por_pagar/parcial/pagado) | **Sistema** (según `modoPago`) | Al confirmar el pedido (P-05): `sena` → seña exigible; `total` → total exigible; `sin_pago_previo` → sin_cargo. |
| **Habilitar cobro por llegada** (sin_cargo/parcial → por_pagar) | **Sistema** (derivado) | Cuando la promesa pasa a *lista para retirar* (P-07 "apartar y avisar"). [SYS-03](../automatizaciones.md) avisa. |
| **Enviar comprobante** (por_pagar → comprobante_enviado) | **Cliente** | En P-05 (seña/total al reservar) o P-06 (total/saldo al llegar): transfiere y adjunta+envía ([C-07 Comprobante](../componentes.md)). |
| **Validar comprobante** (comprobante_enviado → pagado/parcial) | **Comerciante** | Ve el comprobante y confirma; acredita en `pagado`. |
| **Rechazar comprobante** (comprobante_enviado → por_pagar) | **Comerciante** | Si no coincide (monto/pedido); la persona reintenta. |
| **Registrar pago** (por_pagar → pagado/parcial) | **Comerciante** | Efectivo o transferencia saldada en el mostrador (P-08), sin comprobante adjunto previo. |

---

## Compuerta de entrega

- **Camino normal:** la entrega procede con el **saldo resuelto** (`saldo == 0`).
- **Excepción deliberada del comerciante:** puede **registrar una entrega con saldo pendiente**, mediante **confirmación explícita**, dejando **trazabilidad** (quién entregó, cuándo, `saldo` pendiente). La promesa queda *retirada* pero con una **deuda registrada**.

> Nakama **ordena y advierte**, no **bloquea de manera absoluta** una decisión comercial de la tienda (p. ej. cliente de confianza que paga mañana). El default empuja al pago; la excepción existe, es visible y queda auditada.

---

## Invariantes

1. **No hay pago antes de estar exigible** — el cobro se dispara según `modoPago` (reservar) y la fase (llegada); nunca se cobra "porque sí".
2. **Entrega normal exige `saldo == 0`** — salvo la **excepción explícita con trazabilidad** (ver compuerta). Junto con [D-014](../decisiones-congeladas.md) (no hay retirada sin *lista para retirar*).
3. **Nakama no procesa dinero** — sin pasarela ni integración bancaria; solo registra estados y comprobantes.
4. **El comprobante es evidencia, no verificación automática** — lo valida **una persona** (la tienda). Sin OCR ni verificación de banco.
5. **Un comprobante pertenece a un pedido** — no reutilizable entre pedidos.
6. **Idempotencia** — validar/registrar dos veces no acumula de más; `pagado ≤ total`.
7. **`saldo` nunca negativo.**
8. **La faceta de pago no altera el cumplimiento** — solo abre (o, con excepción, se saltea explícitamente) la compuerta de entrega.

---

## Qué pantalla consume cada estado

| Pantalla | Qué consume |
|---|---|
| **P-05 · Reserva** (cliente) | En modos `sena`/`total`, aloja la **instancia de pago al reservar** en el lugar reservado (seña o total; enviar comprobante). En `sin_pago_previo`, sin pago acá. |
| **P-06 · Vista del pedido** (cliente) | *por_pagar* (total/saldo al llegar) → transferir + adjuntar/enviar comprobante. *comprobante_enviado* → "por validar". *parcial* → "queda saldo". *pagado* → "a retirar". |
| **P-07 · Preparación** (tienda) | **Dispara** la compuerta de cobro por llegada (→ por_pagar). **No cobra.** |
| **P-08 · Entrega** (tienda) | Registrar pago / validar comprobante; **exige `saldo == 0`** para entregar, **o** la excepción con confirmación + traza. |
| **P-01 · Preventa Viva** (tienda) | Columna de pago por-persona: evidencia según modo (seña/total pagados o pendientes; en `sin_pago_previo`, *sin_cargo* durante la preventa). |
| **SYS-03 · Avisos** | Avisa al pasar a *por_pagar* ("pasá a pagar"); opcional "pago recibido". |

---

## Fuera de alcance v1 (expreso)

- **UI de los modos no habilitados en el piloto** — el dominio admite los tres; se implementa solo el modo de Crumb (por confirmar). Los demás quedan latentes.
- **UI de override de modo por tomo** — el dato lo admite; la interfaz se difiere.
- **Otros medios** integrados (tarjeta, MercadoPago, links de pago, pasarela).
- **Cobro automatizado / verificación automática** del comprobante (OCR, API bancaria).
- **Reembolsos / notas de crédito.**
- **Gestión de la deuda** tras una entrega-con-saldo (recordatorios, cobranza) — v1 solo la **registra**; su seguimiento es operativo.
