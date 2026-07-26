/** Formato de precios de Retail (centavos ARS → "$X"). PURO. */
export function formatArsCents(cents: number): string {
  const pesos = cents / 100;
  return "$" + pesos.toLocaleString("es-AR", { minimumFractionDigits: pesos % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

/** Mensajes en español para los códigos de error de dominio (para la UI). */
export const RETAIL_ERROR_LABEL: Record<string, string> = {
  CAMPAIGN_NOT_FOUND: "La campaña no existe.",
  CAMPAIGN_NOT_EDITABLE: "La campaña no se puede editar en su estado actual.",
  INVALID_CAMPAIGN_TRANSITION: "Transición de estado no permitida.",
  CAMPAIGN_NOT_OPEN: "La campaña no está abierta.",
  CAMPAIGN_HAS_NO_OFFERS: "La campaña no tiene ofertas activas.",
  OFFER_ALREADY_EXISTS: "Ese tomo ya está en la campaña.",
  OFFER_NOT_FOUND: "La oferta no existe.",
  OFFER_NOT_EDITABLE: "La oferta no se puede modificar así.",
  INVALID_PRICE: "Precios inválidos (preventa ≤ lista, ≥ 0).",
  INVALID_DATES: "Las fechas no son coherentes.",
  INVALID_TITLE: "El título no puede estar vacío.",
  VOLUME_NOT_FOUND: "El tomo no existe en el catálogo.",
  STORE_COMMERCE_DISABLED: "La tienda comercial no está habilitada.",
  // Reservas (Slice 3)
  ORDER_NOT_FOUND: "La orden no existe.",
  ORDER_ACCESS_DENIED: "No tenés acceso a esta orden.",
  ORDER_ALREADY_EXISTS: "Ya tenés una orden para esta campaña.",
  ORDER_NOT_CANCELLABLE: "La orden no se puede cancelar.",
  EMPTY_ORDER: "Elegí al menos un tomo.",
  INVALID_QUANTITY: "Cantidad inválida.",
  TOO_MANY_ITEMS: "Superaste el máximo de unidades por tomo.",
  OFFER_NOT_AVAILABLE: "Una de las ofertas ya no está disponible.",
  OFFER_CAMPAIGN_MISMATCH: "Una oferta no pertenece a esta campaña.",
  ORDER_TOTAL_MISMATCH: "El total cambió; revisá tu selección.",
  // Cumplimiento (Slice 4)
  ORDER_LINE_NOT_FOUND: "La línea no existe.",
  ORDER_LINE_OPERATION_NOT_ALLOWED: "Operación no permitida sobre esta línea.",
  INVALID_FULFILLMENT_QUANTITY: "Cantidad inválida para esta operación.",
  NOTHING_PENDING: "No quedan unidades pendientes.",
  ORDER_CANCELLED: "La orden está cancelada.",
  ORDER_FULFILLMENT_STARTED: "La operación de proveedor ya comenzó; cancelá las líneas pendientes.",
  CAMPAIGN_HAS_ACTIVE_ORDERS: "La campaña tiene órdenes activas.",
  OPERATION_KEY_CONFLICT: "Esa operación cambió; reintentá.",
  FORBIDDEN_ROLE: "Tu rol no permite esta acción.",
  NOT_A_MEMBER: "No sos miembro de esta tienda.",
  STORE_DISABLED: "La tienda está deshabilitada.",
  PROFILE_NOT_FOUND: "La tienda no existe.",
  UNAUTHENTICATED: "Iniciá sesión.",
};

export function retailErrorLabel(code: string): string {
  return RETAIL_ERROR_LABEL[code] ?? code;
}

/** Etiquetas de estado de una orden (para la UI de cliente y tienda). */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  RESERVED: "Reservada",
  CANCELLED: "Cancelada",
};
export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] ?? status;
}

/**
 * Etiquetas del estado OPERATIVO de una línea (Slice 4). Deliberadamente NO dice "listo para retirar" cuando
 * llega: el retiro/pago son slices futuras; "Llegó a la tienda" describe solo la recepción física.
 */
export const FULFILLMENT_STATUS_LABEL: Record<string, string> = {
  RESERVED: "Reservado",
  ORDERED: "Pedido al proveedor",
  ARRIVED: "Llegó a la tienda",
  CANCELLED: "Cancelado",
};
export function fulfillmentStatusLabel(status: string): string {
  return FULFILLMENT_STATUS_LABEL[status] ?? status;
}

/** Etiquetas del resumen de cumplimiento de una orden (derivado; §13). */
export const ORDER_FULFILLMENT_LABEL: Record<string, string> = {
  NOT_STARTED: "Sin gestionar",
  IN_PROGRESS: "En gestión",
  FULLY_ARRIVED: "Todo en la tienda",
  PARTIALLY_CANCELLED: "Parcialmente cancelada",
  FULLY_CANCELLED: "Cancelada",
};
export function orderFulfillmentLabel(summary: string): string {
  return ORDER_FULFILLMENT_LABEL[summary] ?? summary;
}

/** Tipos de evento operativo (para el historial). */
export const LINE_EVENT_TYPE_LABEL: Record<string, string> = {
  MARKED_ORDERED: "Pedido al proveedor",
  MARKED_ARRIVED: "Llegada registrada",
  CANCELLED: "Cancelación",
};
export function lineEventTypeLabel(type: string): string {
  return LINE_EVENT_TYPE_LABEL[type] ?? type;
}
