/**
 * Dominio de Retail / Preparación y retiro (Slice 7) — PURO (sin Prisma, `now` inyectado por el servicio).
 *
 * Es la CONTINUACIÓN outbound del mismo ciclo físico por LÍNEA que abrió la Slice 4: la unidad progresa
 * `arrived → prepared → picked_up`. Dos contadores nuevos sobre `StoreOrderLine` (`preparedQuantity`,
 * `pickedUpQuantity`) son la fuente de verdad; los estados se DERIVAN de los contadores (no se persisten). El
 * eje es ortogonal al pago (Slice 6): acá no se lee ni escribe dinero.
 *
 * Invariante central (garantizado por las validaciones de este módulo + los locks del servicio):
 *   0 ≤ pickedUpQuantity ≤ preparedQuantity ≤ arrivedQuantity ≤ quantity − cancelledQuantity
 *
 * `deriveHandoffLine` NO expone un enum único de línea (induciría textos engañosos con parciales): expone
 * cantidades + flags. El estado por ORDEN sí es un enum (`ORDER_HANDOFF`) porque a ese nivel una etiqueta
 * gruesa es apropiada y `COMPLETED` tiene una definición estricta.
 */
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

/** Estado DERIVADO de retiro a nivel ORDEN (no se persiste). Separado del resumen inbound de fulfillment. */
export const ORDER_HANDOFF = {
  NOT_STARTED: "NOT_STARTED", // nada llegó / nada preparado / nada retirado
  IN_PROGRESS: "IN_PROGRESS", // hay actividad pero nada listo para retirar ahora
  READY_FOR_PICKUP: "READY_FOR_PICKUP", // hay unidades preparadas esperando retiro
  COMPLETED: "COMPLETED", // todo lo que iba a llegar se resolvió y todo lo llegado se retiró
} as const;
export type OrderHandoff = (typeof ORDER_HANDOFF)[keyof typeof ORDER_HANDOFF];

/**
 * Contadores relevantes para el handoff. `quantity` (comercial) y `cancelledQuantity`/`arrivedQuantity`
 * (Slice 4) son INMUTABLES desde acá: este módulo solo modifica `prepared`/`pickedUp`.
 */
export interface HandoffCounters {
  readonly quantity: number;
  readonly arrivedQuantity: number;
  readonly cancelledQuantity: number;
  readonly preparedQuantity: number;
  readonly pickedUpQuantity: number;
}

// --- Cantidades derivadas (PURAS) -------------------------------------------------------------------------

/** Unidades LLEGADAS aún sin preparar. */
export function preparableQuantity(c: HandoffCounters): number {
  return c.arrivedQuantity - c.preparedQuantity;
}
/** Unidades PREPARADAS aún sin retirar. */
export function pickupableQuantity(c: HandoffCounters): number {
  return c.preparedQuantity - c.pickedUpQuantity;
}
/** Unidades que todavía no llegaron ni se cancelaron (pendientes de llegada). */
export function pendingArrivalQuantity(c: HandoffCounters): number {
  return c.quantity - c.arrivedQuantity - c.cancelledQuantity;
}

function assertPositiveInt(qty: number): void {
  if (!Number.isInteger(qty) || qty < 1)
    throw new RetailError(RETAIL_ERROR.INVALID_HANDOFF_QUANTITY, "la cantidad debe ser un entero ≥ 1");
}

// --- Transiciones (PURAS): suman un delta y preservan el invariante ---------------------------------------

/** Prepara `qty` unidades (delta). No excede lo llegado sin preparar. */
export function applyPrepared(c: HandoffCounters, qty: number): HandoffCounters {
  assertPositiveInt(qty);
  const room = preparableQuantity(c);
  if (room <= 0) throw new RetailError(RETAIL_ERROR.NOTHING_TO_PREPARE, "no hay unidades llegadas sin preparar");
  if (qty > room) throw new RetailError(RETAIL_ERROR.PREPARATION_EXCEEDS_ARRIVED, `no podés preparar más de ${room} unidades`);
  return { ...c, preparedQuantity: c.preparedQuantity + qty };
}

/** Retira `qty` unidades (delta). No excede lo preparado sin retirar. */
export function applyPickedUp(c: HandoffCounters, qty: number): HandoffCounters {
  assertPositiveInt(qty);
  const room = pickupableQuantity(c);
  if (room <= 0) throw new RetailError(RETAIL_ERROR.NOTHING_TO_PICKUP, "no hay unidades preparadas sin retirar");
  if (qty > room) throw new RetailError(RETAIL_ERROR.PICKUP_EXCEEDS_PREPARED, `no podés retirar más de ${room} unidades`);
  return { ...c, pickedUpQuantity: c.pickedUpQuantity + qty };
}

// --- Estado derivado por LÍNEA: cantidades + flags (sin enum engañoso) ------------------------------------

export interface HandoffLineView {
  readonly preparableQuantity: number;
  readonly pickupableQuantity: number;
  readonly pendingArrivalQuantity: number;
  readonly hasUnprepared: boolean;
  readonly hasReadyToPickup: boolean;
  readonly hasPickedUp: boolean;
  /** La línea terminó: todo lo que iba a llegar se resolvió y todo lo llegado se retiró. */
  readonly lineComplete: boolean;
}

/** `lineComplete` ⇔ (arrived + cancelled == quantity) ∧ (pickedUp == arrived). PURO. */
export function isLineComplete(c: HandoffCounters): boolean {
  return c.arrivedQuantity + c.cancelledQuantity === c.quantity && c.pickedUpQuantity === c.arrivedQuantity;
}

export function deriveHandoffLine(c: HandoffCounters): HandoffLineView {
  return {
    preparableQuantity: preparableQuantity(c),
    pickupableQuantity: pickupableQuantity(c),
    pendingArrivalQuantity: pendingArrivalQuantity(c),
    hasUnprepared: preparableQuantity(c) > 0,
    hasReadyToPickup: pickupableQuantity(c) > 0,
    hasPickedUp: c.pickedUpQuantity > 0,
    lineComplete: isLineComplete(c),
  };
}

// --- Estado derivado por ORDEN --------------------------------------------------------------------------

/**
 * Resumen DERIVADO de retiro de una orden. PURO, no se persiste. Agrega los contadores de sus líneas.
 * Precedencia estricta (evita "entregado" prematuro):
 *   1. nada llegó/preparó/retiró          → NOT_STARTED
 *   2. todo resuelto y todo lo llegado retirado (A+C==Q ∧ U==A, Q>0) → COMPLETED
 *   3. hay preparado sin retirar (P−U>0)  → READY_FOR_PICKUP
 *   4. en cualquier otro caso             → IN_PROGRESS
 */
export function getOrderHandoffSummary(lines: readonly HandoffCounters[]): OrderHandoff {
  let Q = 0, A = 0, C = 0, P = 0, U = 0;
  for (const l of lines) { Q += l.quantity; A += l.arrivedQuantity; C += l.cancelledQuantity; P += l.preparedQuantity; U += l.pickedUpQuantity; }
  if (A === 0 && P === 0 && U === 0) return ORDER_HANDOFF.NOT_STARTED;
  if (Q > 0 && A + C === Q && U === A) return ORDER_HANDOFF.COMPLETED;
  if (P - U > 0) return ORDER_HANDOFF.READY_FOR_PICKUP;
  return ORDER_HANDOFF.IN_PROGRESS;
}
