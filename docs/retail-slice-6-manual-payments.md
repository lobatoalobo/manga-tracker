# Retail / Preventas — Slice 6: Pagos manuales

Sexta slice del dominio Retail. Permite que OWNER/STAFF **registren** pagos que ya recibieron por fuera
(transferencia, efectivo, Mercado Pago) contra una orden, mantengan el historial y vean el estado de pago
derivado. El cliente ve su estado de pago y los pagos registrados. **Nakama no procesa ni cobra**: el pago es
un registro manual. **NO** hay VOID, REFUND, ADJUSTMENT, comprobantes, pago informado por el cliente,
conciliación, edición ni borrado.

## El pago es un eje ORTOGONAL (principio central)

El dinero **no** se pliega en `order.status` (RESERVED/CANCELLED) ni en el cumplimiento por línea (Slice 4).
Es un eje propio, siguiendo el mismo patrón que el cumplimiento: un ledger append-only de movimientos
(`StorePayment`) del que se **deriva** el estado de pago de la orden. Ejes vigentes:

| Eje | Dónde vive |
|---|---|
| Ciclo comercial | `StoreOrder.status` (RESERVED/CANCELLED) |
| Cumplimiento físico | `StoreOrderLine.fulfillmentStatus` |
| **Pago** | `StoreOrder.paymentStatus` (derivado) |

## Aggregate y ledger append-only

- **`StorePayment`** cuelga de `StoreOrder` (**Restrict**: una orden con pagos no se borra). Cada fila es un
  movimiento **inmutable**: `amountCents` (magnitud positiva, centavos ARS), `method`, `note?` (interna),
  `paidAt`, `confirmedByUserId?`, `recordOperationKey` (única), `status`.
- No hay hard-delete ni edición desde UI/servicios. La corrección de un error se hará con la futura slice de
  correcciones (VOID) — no existe en este MVP (limitación aceptada).

## `CONFIRMED` / `VOIDED` — por qué `VOIDED` no es alcanzable todavía

`status ∈ {CONFIRMED, VOIDED}`. En esta slice **solo se crean movimientos `CONFIRMED`**; no existe ninguna
operación que produzca `VOIDED`. El valor queda **reservado y documentado** para la futura slice de
correcciones. Se modela ahora (y la derivación se escribe como `Σ where status = CONFIRMED`) para que sumar
`VOID` más adelante sea puramente aditivo, sin reabrir la proyección de dinero.

> **Sin campo `type`.** El aggregate representa **únicamente pagos**. `REFUND`/`ADJUSTMENT` quedan fuera.
> Cuando aparezcan se decidirá, con más contexto, entre evolucionar hacia `StoreMoneyMovement + type` o
> modelar los refunds como un aggregate separado. No hay evidencia suficiente hoy para fijar esa bifurcación.

## Proyección en `StoreOrder` (`totalCents` como ancla inmutable)

`StoreOrder.paidCents` y `StoreOrder.paymentStatus` son una **proyección denormalizada** derivada del ledger;
la fuente de verdad son los `StorePayment` `CONFIRMED`. Se recomputan dentro de la misma transacción que
registra el pago, bajo lock. La comparación es **siempre** contra `StoreOrder.totalCents`, que es **inmutable**
(se congela al reservar; la cancelación parcial de líneas de Slice 4 mueve contadores pero nunca `totalCents`).

```
paidCents      = Σ amountCents de pagos CONFIRMED de la orden
remainingCents = max(0, totalCents − paidCents)   // NO se persiste; el sobrepago no lo vuelve negativo
```

## Estados de pago

```
paid == 0        → UNPAID
0 < paid < total → PARTIALLY_PAID
paid == total    → PAID
paid > total     → OVERPAID
```

La igualdad al total se evalúa **antes** que el cero: por eso el borde `totalCents == 0` con `paid == 0`
resuelve como **PAID** (nada que cobrar), no UNPAID.

## Sobrepago (`OVERPAID`)

`OVERPAID` es **informativo** y alcanzable por un sobrepago literal (registrar más que el total). **No se
bloquea** el registro. Su resolución (devolución) queda diferida a la slice de correcciones/refunds. Los
saldos a favor generados por cancelación de líneas **no** se representan en este MVP (se comparan contra el
`totalCents` congelado, no contra un adeudado dinámico).

## Idempotencia (§6)

`recordOperationKey` única global. El payload reconciliado incluye `orderId`, `amountCents`, `method`, `paidAt`
(instante normalizado) y la **nota saneada** — decisión explícita: la nota es parte del registro histórico, así
que un cambio de nota con la misma clave es **conflicto**, no un registro silencioso distinto. Semántica:

- misma clave + mismo payload → idempotente (se devuelve el pago existente);
- misma clave + payload distinto → `PAYMENT_OPERATION_KEY_CONFLICT`;
- clave nueva → pago nuevo.

El `P2002` sobre `recordOperationKey` se traduce con la misma semántica (sin exponer Prisma). La UI mantiene la
clave estable por intento en un `useRef` y la rota tras un resultado definitivo.

## Concurrencia (§7)

`registerPayment` es transaccional: bloquea la orden (`SELECT … FOR UPDATE`), revalida acceso y estado (rechaza
`CANCELLED`), reconcilia la clave, inserta el pago y **recomputa** `paidCents`/`paymentStatus` desde todos los
pagos `CONFIRMED` bajo el lock. No bloquea líneas (el pago pertenece a la orden). Dos pagos concurrentes con
claves distintas se serializan y producen una proyección correcta.

## Permisos y privacidad

OWNER/STAFF (por `storeId` **derivado de la orden**, `requireEnabled:false` — el historial financiero se opera
aunque el comercio esté deshabilitado): registran pagos, ven pagos/resúmenes/vistas agregadas. **Cliente**:
solo ve pagos `CONFIRMED` de sus propias órdenes (monto, método, fecha) y el estado/total/pagado/restante;
**nunca** la nota interna, el actor ni las claves. Aislamiento total entre tiendas. **Retención:** al borrarse
una cuenta, `confirmedByUserId` pasa a NULL (SetNull) pero el pago se **preserva**.

## Bloqueo de cancelación (§9)

Simetría obligatoria mientras no exista devoluciones:

```
orden CANCELLED          → no acepta pagos       (ORDER_CANCELLED)
orden con paidCents > 0  → no puede cancelarse    (ORDER_HAS_PAYMENTS)
```

El bloqueo se valida dentro de `cancelWholeOrder`, bajo el mismo lock, y aplica a **ambas** vías
(cancelación administrativa y auto-cancelación del cliente). Una orden con `paidCents == 0` sigue pudiendo
cancelarse si cumple las reglas previas de fulfillment. Sin excepciones administrativas ocultas.

## Vistas

- **Cliente:** sección "Estado de pago" en `/mis-compras/preventas/[publicCode]` (estado, total, pagado,
  restante, pagos confirmados). Aclara que la tienda registró los pagos y que Nakama no cobra.
- **Admin (orden):** sección "Pagos" en `…/ordenes/[orderId]` (resumen, alerta `OVERPAID`, formulario de
  registro, historial). El botón de cancelar queda bloqueado si `paidCents > 0`.
- **Admin (campaña):** `…/[campaignId]/pagos` — total de órdenes activas, facturado, cobrado, % cobrado,
  conteo por estado y órdenes con saldo pendiente. Las métricas comerciales **excluyen** órdenes `CANCELLED`
  (misma convención que la vista de cumplimiento).

## Servicios

`registerPayment`, `listOrderPayments`, `getOrderPaymentSummary`, `getCampaignPaymentSummary`,
`listPendingPayments` (`lib/retail/payments.ts`); dominio puro en `lib/domain/retail/payment.ts`
(constantes, validaciones, `computePaidCents`/`computeRemainingCents`/`derivePaymentStatus`,
`reconcilePaymentKey`, `assertRegisterable`, `assertCancellableWithoutPayments`).

## Dinero

`Int` en centavos ARS, solo enteros, mínimo 1, techo `MAX_SAFE_TOTAL_CENTS`, sin floats ni multi-moneda
(moneda implícita del módulo). El monto del formulario llega en pesos y se convierte a centavos en el server.

## Limitaciones conocidas / qué queda expresamente fuera

Un pago mal cargado **no** puede corregirse desde la aplicación en este MVP (aceptado conscientemente). Fuera
de alcance: `VOID`, `REFUND`, `ADJUSTMENT`, campo `type`/`StoreMoneyMovement`, adeudado dinámico, saldos a
favor por cancelación, comprobantes/uploads/R2, pago informado por el cliente, conciliación, edición, borrado,
ajustes negativos, allocación de pago por línea, notificación automática al registrar, gating de
preparación/retiro, retiro, colección automática, WhatsApp, Excel, matching, multi-moneda.

## Bifurcación futura

Cuando llegue el subdominio de correcciones/refunds se decidirá, con evidencia, entre:
(a) evolucionar `StorePayment` hacia un `StoreMoneyMovement + type` (PAYMENT/REFUND/ADJUSTMENT) firmado; o
(b) mantener `StorePayment` y modelar los refunds como un aggregate separado. La derivación ya está escrita
como `Σ where status = CONFIRMED`, así que incorporar `VOID` es aditivo.
