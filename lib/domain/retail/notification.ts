/**
 * Dominio de Retail / Avisos de llegada (Slice 5) — PURO (sin Prisma, `now` inyectado por el servicio).
 *
 * Separa **mercadería llegada** (operación física, Slice 4: `StoreOrderLine.arrivedQuantity`) de **cliente
 * informado** (comunicación). El aviso tiene su propio estado e historial; que una línea esté ARRIVED NO
 * implica que el cliente fue informado. El aviso se registra a nivel de ORDEN pero contiene ítems concretos
 * (línea + cantidad informada), para agrupar varias líneas sin perder trazabilidad. El envío de esta slice
 * es MANUAL (la tienda copia el texto y lo manda por fuera); Nakama no envía comunicaciones externas.
 */
import { RetailError, RETAIL_ERROR } from "@/lib/domain/retail/errors";

export const NOTIFICATION_TYPE = { ARRIVAL: "ARRIVAL" } as const; // WHATSAPP/EMAIL/SMS/PUSH: valores futuros, no usados
export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

export const NOTIFICATION_STATUS = { DRAFT: "DRAFT", SENT: "SENT", CANCELLED: "CANCELLED" } as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[keyof typeof NOTIFICATION_STATUS];

export const NOTIFICATION_CHANNEL = { MANUAL: "MANUAL" } as const; // WHATSAPP/EMAIL/... documentados a futuro, no persistidos
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

/** Longitud máxima defensiva del mensaje (evita textos gigantes; el envío es por fuera). */
export const MAX_MESSAGE_LENGTH = 2000;

const NOTIFICATION_TRANSITIONS: Record<NotificationStatus, readonly NotificationStatus[]> = {
  DRAFT: [NOTIFICATION_STATUS.SENT, NOTIFICATION_STATUS.CANCELLED],
  SENT: [], // terminal: no se reenvía ni reabre (una comunicación nueva = una notificación nueva)
  CANCELLED: [],
};

export function canTransitionNotification(from: NotificationStatus, to: NotificationStatus): boolean {
  return NOTIFICATION_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Solo un borrador (DRAFT) es editable (mensaje/ítems). */
export function isNotificationEditable(status: NotificationStatus): boolean {
  return status === NOTIFICATION_STATUS.DRAFT;
}
export function assertNotificationEditable(status: NotificationStatus): void {
  if (!isNotificationEditable(status)) throw new RetailError(RETAIL_ERROR.NOTIFICATION_NOT_EDITABLE, `la notificación está ${status}`);
}

/**
 * Sanea el mensaje: sin HTML (se quitan `<`/`>`), recortado y con longitud máxima. Devuelve texto plano.
 * No lanza por HTML (lo neutraliza); el vacío se valida aparte al enviar.
 */
export function sanitizeMessage(raw: string): string {
  return (raw ?? "").replace(/[<>]/g, "").trim().slice(0, MAX_MESSAGE_LENGTH);
}
export function assertNonEmptyMessage(message: string): string {
  const m = sanitizeMessage(message);
  if (!m) throw new RetailError(RETAIL_ERROR.EMPTY_NOTIFICATION, "el mensaje no puede estar vacío");
  return m;
}

// --- Cantidades informadas / pendientes -----------------------------------------------------------------

/** Unidades de una línea aún NO informadas = llegadas − ya informadas (solo cuentan avisos SENT). */
export function unnotifiedArrivalQuantity(arrivedQuantity: number, notifiedQuantity: number): number {
  return Math.max(0, arrivedQuantity - notifiedQuantity);
}

export interface SelectionItem {
  readonly orderLineId: number;
  readonly quantity: number;
  /** Unidades llegadas y todavía no informadas de esa línea (arrived − notified SENT). */
  readonly pendingUnnotified: number;
}

/**
 * Valida la selección de un aviso (§8): lista no vacía, cantidades enteras ≥ 1, y que no superen las unidades
 * llegadas aún no informadas de cada línea. PURA. Consolida por línea (ítems repetidos suman) antes de validar.
 */
export function assertValidSelection(items: readonly SelectionItem[]): Map<number, number> {
  if (!items || items.length === 0) throw new RetailError(RETAIL_ERROR.EMPTY_NOTIFICATION, "el aviso no tiene líneas");
  const byLine = new Map<number, number>();
  const pendingByLine = new Map<number, number>();
  for (const it of items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1) throw new RetailError(RETAIL_ERROR.INVALID_NOTIFICATION_QUANTITY, "la cantidad debe ser un entero ≥ 1");
    byLine.set(it.orderLineId, (byLine.get(it.orderLineId) ?? 0) + it.quantity);
    pendingByLine.set(it.orderLineId, it.pendingUnnotified);
  }
  for (const [lineId, qty] of byLine) {
    const pending = pendingByLine.get(lineId) ?? 0;
    if (pending <= 0) throw new RetailError(RETAIL_ERROR.ARRIVAL_ALREADY_NOTIFIED, "esa línea no tiene unidades por informar");
    if (qty > pending) throw new RetailError(RETAIL_ERROR.ARRIVAL_NOTIFICATION_EXCEEDS_PENDING, `no podés informar más de ${pending} unidades`);
  }
  return byLine;
}

// --- Mensaje sugerido (§10) -------------------------------------------------------------------------------

export interface MessageItem {
  readonly title: string;
  readonly volumeNumber: number | null;
  readonly quantity: number;
}
export interface MessageInput {
  readonly customerName: string | null;
  readonly storeName: string;
  readonly publicCode: string;
  readonly items: readonly MessageItem[];
}

/**
 * Arma el texto sugerido del aviso de llegada (§10). Solo confirma que la mercadería LLEGÓ a la tienda: NO
 * menciona monto, alias, pago, "listo para retirar", horarios, dirección ni vencimientos (slices futuras).
 */
export function buildArrivalMessage(input: MessageInput): string {
  const hi = input.customerName ? `¡Hola, ${input.customerName}!` : "¡Hola!";
  const lines = input.items.map((i) => `• ${i.title}${i.volumeNumber != null ? ` ${i.volumeNumber}` : ""} × ${i.quantity}`).join("\n");
  return sanitizeMessage(
    `${hi} Llegaron productos de tu preventa en ${input.storeName}:\n\n${lines}\n\n` +
      `Tu pedido es ${input.publicCode}.\n\n` +
      `Por el momento este aviso solo confirma que los productos llegaron a la tienda.`,
  );
}

// --- Idempotencia del envío (§13) -------------------------------------------------------------------------

export interface ExistingSendView {
  readonly notificationId: number;
  readonly sendOperationKey: string | null;
}

/**
 * Reconcilia un reintento de "marcar enviado" que reusa una `sendOperationKey` (PURA):
 *  - sin dueño previo de la clave → `false` (aplicar);
 *  - la MISMA notificación ya tiene esa clave → `true` (idempotente);
 *  - otra notificación tiene la clave → `NOTIFICATION_OPERATION_KEY_CONFLICT`.
 */
export function reconcileSendKey(existing: ExistingSendView | null, expectedNotificationId: number): boolean {
  if (!existing) return false;
  if (existing.notificationId === expectedNotificationId) return true;
  throw new RetailError(RETAIL_ERROR.NOTIFICATION_OPERATION_KEY_CONFLICT, "la clave de envío ya se usó para otro aviso");
}
