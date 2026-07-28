/**
 * Dominio de Retail / Reservas (Slice 3) — StoreOrder: máquina de estados, cantidades, consolidación de
 * líneas, totales y cancelabilidad. PURO (sin Prisma, sin reloj implícito: `now`/`campaignOpen` se inyectan).
 *
 * Una StoreOrder NO es una Purchase (compra personal histórica): pertenece al dominio Retail, no hereda su
 * semántica ni sus estados. Nace en RESERVED y solo puede ir a CANCELLED en esta slice (pago/llegada/retiro
 * son slices posteriores). Precios en CENTAVOS ARS (Int), copiados de la oferta; nunca del cliente.
 */
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

export const ORDER_STATUS = {
  RESERVED: "RESERVED",
  CANCELLED: "CANCELLED",
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/**
 * Transiciones de esta slice. RESERVED → CANCELLED (única). CANCELLED es TERMINAL: cancelar es DEFINITIVO,
 * no se restaura ni se reutiliza (§6/§13). Los estados operativos (PENDING_PAYMENT/PAID/READY/PICKED_UP) no
 * existen todavía: pertenecen a slices con la lógica que los produce.
 */
const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RESERVED: [ORDER_STATUS.CANCELLED],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Cantidad máxima defensiva por línea (evita abuso accidental; no es stock ni cupo). */
export const MAX_LINE_QUANTITY = 20;
/**
 * Techo de seguridad para totales (centavos). Muy por debajo del máximo de `int4` de Postgres (2.147e9),
 * así una suma nunca desborda silenciosamente la columna. Cualquier total mayor es un error de dominio.
 */
export const MAX_SAFE_TOTAL_CENTS = 2_000_000_000;

/** Cantidad válida de una línea: entero en [1, MAX_LINE_QUANTITY]. */
export function assertValidQuantity(q: number): void {
  if (!Number.isInteger(q) || q < 1) throw new RetailError(RETAIL_ERROR.INVALID_QUANTITY, "la cantidad debe ser un entero ≥ 1");
  if (q > MAX_LINE_QUANTITY) throw new RetailError(RETAIL_ERROR.TOO_MANY_ITEMS, `máximo ${MAX_LINE_QUANTITY} unidades por tomo`);
}

export interface RequestedLine {
  readonly offerId: number;
  readonly quantity: number;
}

/**
 * Consolida ofertas repetidas SUMANDO cantidades antes de validar el máximo (§15). Rechaza lista vacía
 * (EMPTY_ORDER) y cantidades inválidas por línea; el tope se valida sobre la cantidad YA consolidada.
 * Devuelve un Map estable offerId → cantidad total.
 */
export function consolidateRequestedLines(items: readonly RequestedLine[]): Map<number, number> {
  if (!items || items.length === 0) throw new RetailError(RETAIL_ERROR.EMPTY_ORDER, "la reserva no tiene líneas");
  const consolidated = new Map<number, number>();
  for (const it of items) {
    if (!Number.isInteger(it.offerId)) throw new RetailError(RETAIL_ERROR.OFFER_NOT_AVAILABLE, "oferta inválida");
    if (!Number.isInteger(it.quantity) || it.quantity < 1) throw new RetailError(RETAIL_ERROR.INVALID_QUANTITY, "la cantidad debe ser un entero ≥ 1");
    consolidated.set(it.offerId, (consolidated.get(it.offerId) ?? 0) + it.quantity);
  }
  if (consolidated.size === 0) throw new RetailError(RETAIL_ERROR.EMPTY_ORDER, "la reserva no tiene líneas");
  for (const q of consolidated.values()) assertValidQuantity(q); // el máximo se aplica tras consolidar
  return consolidated;
}

/** Total de una línea = precio de preventa × cantidad. Guarda contra desborde/valores no enteros. */
export function computeLineTotalCents(unitPreorderPriceCents: number, quantity: number): number {
  if (!Number.isInteger(unitPreorderPriceCents) || unitPreorderPriceCents < 0)
    throw new RetailError(RETAIL_ERROR.INVALID_PRICE, "precio de preventa inválido");
  const total = unitPreorderPriceCents * quantity;
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_SAFE_TOTAL_CENTS)
    throw new RetailError(RETAIL_ERROR.INVALID_PRICE, "total de línea fuera de rango");
  return total;
}

/** Total de la orden = suma de los totales de línea. Guarda contra desborde. */
export function computeOrderTotalCents(lineTotals: readonly number[]): number {
  let sum = 0;
  for (const t of lineTotals) {
    sum += t;
    if (!Number.isSafeInteger(sum) || sum > MAX_SAFE_TOTAL_CENTS)
      throw new RetailError(RETAIL_ERROR.INVALID_PRICE, "total de la orden fuera de rango");
  }
  return sum;
}

/**
 * Verifica un total ESPERADO opcional enviado por el cliente contra el total calculado en el servidor. El
 * servidor NUNCA usa el total del cliente para persistir; solo lo compara para detectar manipulación/desfase.
 */
export function assertExpectedTotal(expected: number | null | undefined, computed: number): void {
  if (expected != null && expected !== computed)
    throw new RetailError(RETAIL_ERROR.ORDER_TOTAL_MISMATCH, "el total no coincide con el calculado");
}

// --- Cancelabilidad (PURA; la política de quién puede cancelar vive en el servicio) -----------------------

/** El cliente cancela su propia orden solo si está RESERVED y la campaña sigue abierta (§17). */
export function canCustomerCancel(status: OrderStatus, campaignOpen: boolean): boolean {
  return status === ORDER_STATUS.RESERVED && campaignOpen;
}
export function assertCustomerCancellable(status: OrderStatus, campaignOpen: boolean): void {
  if (!canCustomerCancel(status, campaignOpen))
    throw new RetailError(RETAIL_ERROR.ORDER_NOT_CANCELLABLE, "no podés cancelar esta orden");
}

/** La tienda (OWNER/STAFF) cancela una orden RESERVED siempre (incluso con el perfil deshabilitado). */
export function canStoreCancel(status: OrderStatus): boolean {
  return status === ORDER_STATUS.RESERVED;
}
export function assertStoreCancellable(status: OrderStatus): void {
  if (!canStoreCancel(status)) throw new RetailError(RETAIL_ERROR.ORDER_NOT_CANCELLABLE, "la orden no está en un estado cancelable");
}
