/**
 * Dominio de Retail / Pagos manuales (Slice 6) — PURO (sin Prisma, sin sesión; `now` lo inyecta el servicio).
 *
 * El pago es un EJE ORTOGONAL a `order.status` (RESERVED/CANCELLED) y al cumplimiento por línea (Slice 4): el
 * dinero vive en un ledger append-only de `StorePayment`, y `StoreOrder.paidCents`/`paymentStatus` son una
 * PROYECCIÓN derivada de los pagos CONFIRMED. La fuente de verdad es el ledger. La comparación es SIEMPRE
 * contra `StoreOrder.totalCents`, congelado al reservar. Esta slice solo REGISTRA pagos CONFIRMED; VOID,
 * REFUND y ADJUSTMENT quedan diferidos al futuro subdominio de correcciones. Ver
 * docs/retail-slice-6-manual-payments.md.
 */
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";
import { ORDER_STATUS } from "@/lib/domain/retail/order";

/**
 * Estado de un movimiento del ledger. En esta slice SOLO se produce CONFIRMED; VOIDED queda reservado y
 * documentado para la futura slice de correcciones (no hay operación que lo alcance). La derivación de
 * `paidCents` cuenta únicamente movimientos CONFIRMED.
 */
export const PAYMENT_MOVEMENT_STATUS = { CONFIRMED: "CONFIRMED", VOIDED: "VOIDED" } as const;
export type PaymentMovementStatus = (typeof PAYMENT_MOVEMENT_STATUS)[keyof typeof PAYMENT_MOVEMENT_STATUS];

/** Estado de pago DERIVADO de la orden (proyección; comparado contra `totalCents` congelado). */
export const PAYMENT_STATUS = { UNPAID: "UNPAID", PARTIALLY_PAID: "PARTIALLY_PAID", PAID: "PAID", OVERPAID: "OVERPAID" } as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

/** Métodos de pago iniciales (enum cerrado). El detalle libre (banco, nº de operación) va en la nota interna. */
export const PAYMENT_METHOD = { TRANSFER: "TRANSFER", CASH: "CASH", MERCADOPAGO: "MERCADOPAGO", OTHER: "OTHER" } as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/** Techo defensivo para montos (centavos ARS), alineado con el de totales de orden — evita desborde de int4. */
export const MAX_SAFE_TOTAL_CENTS = 2_000_000_000;

/** Longitud máxima defensiva de la nota interna. */
export const MAX_PAYMENT_NOTE_LENGTH = 500;

// --- Validaciones -----------------------------------------------------------------------------------------

/** Monto válido de un pago: entero en [1, MAX_SAFE_TOTAL_CENTS]. Sin floats, sin cero, sin negativos. */
export function assertValidAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < 1)
    throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT, "el monto debe ser un entero ≥ 1");
  if (amountCents > MAX_SAFE_TOTAL_CENTS)
    throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT, "el monto es demasiado grande");
}

/** Método de pago válido (enum cerrado). */
export function assertValidMethod(method: string): asserts method is PaymentMethod {
  if (!Object.values(PAYMENT_METHOD).includes(method as PaymentMethod))
    throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_METHOD, "método de pago inválido");
}

/** Solo se registran pagos sobre órdenes NO canceladas (no se paga una orden cancelada). */
export function assertRegisterable(orderStatus: string): void {
  if (orderStatus === ORDER_STATUS.CANCELLED) throw new RetailError(RETAIL_ERROR.ORDER_CANCELLED, "la orden está cancelada");
}

/**
 * Simetría con `assertRegisterable`: una orden con pagos registrados (paidCents > 0) NO puede cancelarse
 * mientras no exista el subdominio de devoluciones (§9). Bloquea el flujo hasta tener la operación correcta.
 */
export function assertCancellableWithoutPayments(paidCents: number): void {
  if (paidCents > 0) throw new RetailError(RETAIL_ERROR.ORDER_HAS_PAYMENTS, "la orden tiene pagos registrados");
}

/**
 * Sanea la nota interna: sin HTML (se quitan `<`/`>`), recortada y con longitud máxima. Devuelve texto plano
 * o `null` si queda vacía. La nota es INTERNA (nunca se expone al cliente ni a logs).
 */
export function sanitizePaymentNote(raw: string | null | undefined): string | null {
  const n = (raw ?? "").replace(/[<>]/g, "").trim().slice(0, MAX_PAYMENT_NOTE_LENGTH);
  return n || null;
}

// --- Cálculo / derivación (PURO) --------------------------------------------------------------------------

/** Suma de los montos de pagos CONFIRMED (la verdad del ledger). Guarda contra desborde. */
export function computePaidCents(confirmedAmounts: readonly number[]): number {
  let sum = 0;
  for (const a of confirmedAmounts) {
    sum += a;
    if (!Number.isSafeInteger(sum) || sum > MAX_SAFE_TOTAL_CENTS)
      throw new RetailError(RETAIL_ERROR.INVALID_PAYMENT_AMOUNT, "total pagado fuera de rango");
  }
  return sum;
}

/** Restante = max(0, total − pagado). NO se persiste. El sobrepago no lo vuelve negativo (lo refleja OVERPAID). */
export function computeRemainingCents(totalCents: number, paidCents: number): number {
  return Math.max(0, totalCents - paidCents);
}

/**
 * Deriva el estado de pago de la orden desde (pagado, total). La comprobación de igualdad al total PRECEDE a
 * la de cero: así el borde `total === 0` con `pagado === 0` resuelve como PAID (nada que cobrar), no UNPAID.
 * El sobrepago (`pagado > total`) → OVERPAID: informativo, no se bloquea; su resolución es diferida.
 */
export function derivePaymentStatus(totalCents: number, paidCents: number): PaymentStatus {
  if (paidCents > totalCents) return PAYMENT_STATUS.OVERPAID;
  if (paidCents === totalCents) return PAYMENT_STATUS.PAID; // cubre total===0 && pagado===0 → PAID
  if (paidCents === 0) return PAYMENT_STATUS.UNPAID;
  return PAYMENT_STATUS.PARTIALLY_PAID;
}

// --- Idempotencia del registro (§6) -----------------------------------------------------------------------

/** Vista mínima de un pago existente que ya tomó una `recordOperationKey` (con la nota ya saneada). */
export interface ExistingPaymentView {
  readonly id: number;
  readonly orderId: number;
  readonly amountCents: number;
  readonly method: string;
  /** Instante de `paidAt` normalizado (getTime()), para comparar sin ambigüedad de objeto Date. */
  readonly paidAtMs: number;
  readonly note: string | null;
}

/** Payload lógico reconciliado de un intento de registro (con la nota ya saneada). */
export interface PaymentPayload {
  readonly orderId: number;
  readonly amountCents: number;
  readonly method: string;
  readonly paidAtMs: number;
  readonly note: string | null;
}

/**
 * Reconcilia un reintento que reusa `recordOperationKey` (PURA):
 *  - sin dueño previo de la clave → `false` (registrar el pago);
 *  - dueño con EL MISMO payload lógico → `true` (idempotente: devolver el pago existente);
 *  - dueño con payload distinto → `PAYMENT_OPERATION_KEY_CONFLICT`.
 *
 * El payload reconciliado incluye `orderId`, `amountCents`, `method`, `paidAt` (instante normalizado) y la
 * nota SANEADA. Decisión explícita (§6): la nota forma parte del registro histórico, así que un cambio de
 * nota con la misma clave es conflicto (no un registro silencioso distinto).
 */
export function reconcilePaymentKey(existing: ExistingPaymentView | null, payload: PaymentPayload): boolean {
  if (!existing) return false;
  if (
    existing.orderId === payload.orderId &&
    existing.amountCents === payload.amountCents &&
    existing.method === payload.method &&
    existing.paidAtMs === payload.paidAtMs &&
    (existing.note ?? null) === (payload.note ?? null)
  )
    return true;
  throw new RetailError(RETAIL_ERROR.PAYMENT_OPERATION_KEY_CONFLICT, "la clave de registro ya se usó con otro pago");
}
