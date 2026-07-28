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
  FORBIDDEN_ROLE: "Tu rol no permite esta acción.",
  NOT_A_MEMBER: "No sos miembro de esta tienda.",
  STORE_DISABLED: "La tienda está deshabilitada.",
  PROFILE_NOT_FOUND: "La tienda no existe.",
  UNAUTHENTICATED: "Iniciá sesión.",
};

export function retailErrorLabel(code: string): string {
  return RETAIL_ERROR_LABEL[code] ?? code;
}
