/**
 * Dominio de Retail / Experiencia de checkout (Slice P0) — PURO (sin Prisma, sin sesión).
 *
 * `CheckoutMode` es el eje que ramifica la experiencia de pago del comprador: cómo COMPLETA el pago, no con qué
 * método ni por qué canal se comunica. Es la proyección MVP de un modelo futuro más rico (un conjunto de
 * `PaymentOption = método × estrategia de confirmación`). En P0 el ÚNICO valor existente es `CONVERSATIONAL`
 * (el comprador coordina el pago con la tienda; la tienda lo confirma con el flujo manual existente). P1
 * introducirá `SELF_SERVICE` de forma aditiva sobre la misma columna forward-ready.
 *
 * Ortogonalidad (decisiones de producto): el MÉTODO de pago (`PAYMENT_METHOD`) es un eje aparte; la COMUNICACIÓN
 * (WhatsApp/email) es metadata de contacto, NO un modo de pago. Este dominio no conoce ninguno de los dos.
 */
export const CHECKOUT_MODE = { CONVERSATIONAL: "CONVERSATIONAL" } as const;
export type CheckoutMode = (typeof CHECKOUT_MODE)[keyof typeof CHECKOUT_MODE];

/** Valor por defecto de una tienda (coincide con el default del esquema): experiencia conversacional. */
export const DEFAULT_CHECKOUT_MODE: CheckoutMode = CHECKOUT_MODE.CONVERSATIONAL;
