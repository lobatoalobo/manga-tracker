/**
 * Dominio de Retail / Cumplimiento (Slice 4) — estado OPERATIVO de una StoreOrderLine y su agregación por
 * orden. PURO (sin Prisma, `now` inyectado por el servicio). Es una propiedad de la LÍNEA (unidad de
 * cumplimiento), distinta del estado COMERCIAL de la orden (RESERVED|CANCELLED, Slice 3).
 *
 * ## Estrategia B: cantidades parciales (decisión congelada)
 * Una tienda real recibe mercadería en tandas, así que una línea con `quantity > 1` puede pedirse/llegar de a
 * partes. Modelamos TRES contadores acumulativos + un `fulfillmentStatus` DERIVADO de ellos (una sola fuente
 * de verdad: los contadores; el status se recalcula y se persiste sólo como índice/display):
 *   - `orderedQuantity`  — unidades pedidas al proveedor.
 *   - `arrivedQuantity`  — unidades recibidas en la tienda.
 *   - `cancelledQuantity`— unidades canceladas (no llegarán).
 *   - `pendingQuantity`  = quantity − arrived − cancelled  (DERIVADO, no se persiste).
 *
 * Invariantes: `0 ≤ arrived ≤ ordered ≤ quantity`, `0 ≤ cancelled ≤ quantity`, `arrived + cancelled ≤
 * quantity`. La **llegada directa** (RESERVED→ARRIVED sin registrar el pedido) está permitida: al recibir se
 * sube `ordered` a la par (auto-pedido). Al cancelar unidades en tránsito se baja `ordered` a `quantity −
 * cancelled` (clamp) para preservar la partición. NUNCA se modifica `quantity` (dato comercial).
 */
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

export const FULFILLMENT_STATUS = {
  RESERVED: "RESERVED",
  ORDERED: "ORDERED",
  ARRIVED: "ARRIVED",
  CANCELLED: "CANCELLED",
} as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUS)[keyof typeof FULFILLMENT_STATUS];

/** Tipos de evento operativo inmutable (§9). Slice 7 suma el tramo outbound (PREPARED/PICKED_UP). */
export const LINE_EVENT_TYPE = {
  MARKED_ORDERED: "MARKED_ORDERED",
  MARKED_ARRIVED: "MARKED_ARRIVED",
  CANCELLED: "CANCELLED",
  PREPARED: "PREPARED",
  PICKED_UP: "PICKED_UP",
} as const;
export type LineEventType = (typeof LINE_EVENT_TYPE)[keyof typeof LINE_EVENT_TYPE];

/** Vista mínima del evento ya persistido con una `operationKey`, para reconciliar un reintento. */
export interface ExistingEventView {
  readonly orderLineId: number;
  readonly type: string;
  readonly quantity: number;
}

/**
 * Reconcilia un reintento que reusa una `operationKey` ya usada (PURA):
 *  - sin evento previo → `false` (es una operación nueva, hay que aplicarla);
 *  - evento previo con la MISMA línea + tipo + cantidad → `true` (idempotente: mismo intento lógico);
 *  - cualquier discrepancia (otra línea, otro tipo u otra cantidad) → `OPERATION_KEY_CONFLICT`.
 * Nunca devuelve éxito silencioso para una operación DISTINTA que reusó la clave (accidental o maliciosamente).
 */
export function reconcileOperationKey(
  existing: ExistingEventView | null,
  expected: { orderLineId: number; type: LineEventType; quantity: number },
): boolean {
  if (!existing) return false;
  if (existing.orderLineId === expected.orderLineId && existing.type === expected.type && existing.quantity === expected.quantity) return true;
  throw new RetailError(RETAIL_ERROR.OPERATION_KEY_CONFLICT, "la operationKey ya se usó para otra operación");
}

/** Contadores de una línea (la `quantity` comercial es inmutable). */
export interface LineCounters {
  readonly quantity: number;
  readonly orderedQuantity: number;
  readonly arrivedQuantity: number;
  readonly cancelledQuantity: number;
}

/** Unidades aún sin resolver (ni llegadas ni canceladas). DERIVADO. */
export function pendingQuantity(c: LineCounters): number {
  return c.quantity - c.arrivedQuantity - c.cancelledQuantity;
}
/** Unidades reservadas que todavía NO se pidieron al proveedor. DERIVADO. */
export function reservedNotOrdered(c: LineCounters): number {
  return c.quantity - c.cancelledQuantity - c.orderedQuantity;
}

function assertPositiveInt(qty: number): void {
  if (!Number.isInteger(qty) || qty < 1) throw new RetailError(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY, "la cantidad debe ser un entero ≥ 1");
}

/** Deriva el estado operativo a partir de los contadores (fuente de verdad). */
export function deriveFulfillmentStatus(c: LineCounters): FulfillmentStatus {
  if (c.cancelledQuantity >= c.quantity) return FULFILLMENT_STATUS.CANCELLED;
  if (c.arrivedQuantity > 0 && c.arrivedQuantity + c.cancelledQuantity >= c.quantity) return FULFILLMENT_STATUS.ARRIVED;
  if (c.orderedQuantity > 0 || c.arrivedQuantity > 0) return FULFILLMENT_STATUS.ORDERED;
  return FULFILLMENT_STATUS.RESERVED;
}

/** Marca `qty` unidades como PEDIDAS al proveedor. No excede las reservadas-sin-pedir. */
export function applyOrdered(c: LineCounters, qty: number): LineCounters {
  assertPositiveInt(qty);
  const room = reservedNotOrdered(c); // lo que aún se puede pedir
  if (room <= 0) throw new RetailError(RETAIL_ERROR.NOTHING_PENDING, "no hay unidades pendientes de pedir");
  if (qty > room) throw new RetailError(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY, `no podés pedir más de ${room} unidades`);
  return { ...c, orderedQuantity: c.orderedQuantity + qty };
}

/** Registra `qty` unidades LLEGADAS. Permite llegada directa (auto-sube `ordered`). No excede lo pendiente. */
export function applyArrived(c: LineCounters, qty: number): LineCounters {
  assertPositiveInt(qty);
  const room = pendingQuantity(c); // lo que aún puede llegar
  if (room <= 0) throw new RetailError(RETAIL_ERROR.NOTHING_PENDING, "no hay unidades pendientes de llegada");
  if (qty > room) throw new RetailError(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY, `no podés recibir más de ${room} unidades`);
  const arrivedQuantity = c.arrivedQuantity + qty;
  const orderedQuantity = Math.max(c.orderedQuantity, arrivedQuantity); // llegada directa ⇒ auto-pedido
  return { ...c, arrivedQuantity, orderedQuantity };
}

/** Cancela `qty` unidades PENDIENTES (nunca las ya llegadas). Baja `ordered` en tránsito (clamp). */
export function applyCancelled(c: LineCounters, qty: number): LineCounters {
  assertPositiveInt(qty);
  const room = pendingQuantity(c); // sólo se cancela lo no llegado
  if (room <= 0) throw new RetailError(RETAIL_ERROR.NOTHING_PENDING, "no hay unidades pendientes de cancelar");
  if (qty > room) throw new RetailError(RETAIL_ERROR.INVALID_FULFILLMENT_QUANTITY, `no podés cancelar más de ${room} unidades`);
  const cancelledQuantity = c.cancelledQuantity + qty;
  const orderedQuantity = Math.min(c.orderedQuantity, c.quantity - cancelledQuantity); // clamp del pedido en tránsito
  return { ...c, cancelledQuantity, orderedQuantity };
}

/** ¿Empezó la operación física de la línea? (algo pedido o llegado). Usado por la cancelación de orden. */
export function hasFulfillmentStarted(c: Pick<LineCounters, "orderedQuantity" | "arrivedQuantity">): boolean {
  return c.orderedQuantity > 0 || c.arrivedQuantity > 0;
}

/**
 * Precondición de cancelación de ORDEN completa (§12, MVP seguro): NINGUNA línea puede tener operación física
 * iniciada. Si empezó, la tienda debe cancelar explícitamente las unidades pendientes por línea (nunca se
 * cancela mercadería ya llegada). PURA.
 */
export function assertNoFulfillmentStarted(lines: readonly Pick<LineCounters, "orderedQuantity" | "arrivedQuantity">[]): void {
  if (lines.some(hasFulfillmentStarted))
    throw new RetailError(RETAIL_ERROR.ORDER_FULFILLMENT_STARTED, "la operación de proveedor ya comenzó; cancelá las líneas pendientes");
}

// --- Resumen de cumplimiento a nivel ORDEN (§13) ---------------------------------------------------------

export const ORDER_FULFILLMENT = {
  NOT_STARTED: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  FULLY_ARRIVED: "FULLY_ARRIVED",
  PARTIALLY_CANCELLED: "PARTIALLY_CANCELLED",
  FULLY_CANCELLED: "FULLY_CANCELLED",
} as const;
export type OrderFulfillment = (typeof ORDER_FULFILLMENT)[keyof typeof ORDER_FULFILLMENT];

/**
 * Resumen DERIVADO del cumplimiento de una orden a partir de sus líneas. PURO, no se persiste. Agrega las
 * cantidades: todo cancelado → FULLY_CANCELLED; todo llegado → FULLY_ARRIVED; todo resuelto con mezcla →
 * PARTIALLY_CANCELLED; nada empezado → NOT_STARTED; en cualquier otro caso → IN_PROGRESS.
 */
export function getOrderFulfillmentSummary(lines: readonly LineCounters[]): OrderFulfillment {
  let Q = 0, O = 0, A = 0, C = 0;
  for (const l of lines) { Q += l.quantity; O += l.orderedQuantity; A += l.arrivedQuantity; C += l.cancelledQuantity; }
  if (Q === 0) return ORDER_FULFILLMENT.NOT_STARTED;
  if (C === Q) return ORDER_FULFILLMENT.FULLY_CANCELLED;
  if (A === Q) return ORDER_FULFILLMENT.FULLY_ARRIVED;
  if (A + C === Q) return ORDER_FULFILLMENT.PARTIALLY_CANCELLED; // todo resuelto, con parte cancelada y parte llegada
  if (O === 0 && A === 0 && C === 0) return ORDER_FULFILLMENT.NOT_STARTED;
  return ORDER_FULFILLMENT.IN_PROGRESS;
}
