/**
 * Retail / Contacto (Slice P0) — PURO. Arma el deep link de WhatsApp para que el comprador consulte por su
 * pedido en la experiencia CONVERSATIONAL. WhatsApp es solo un canal de contacto (no un método de pago): el
 * comprador permanece en Nakama y este link abre una conversación con la tienda. Devuelve null si la tienda no
 * tiene un teléfono válido (el botón se oculta). Sin PII inventada.
 */
import { formatArsCents } from "@/lib/retail/format";

/** Normaliza a solo dígitos (lo que espera wa.me). null si no hay un teléfono plausible. */
function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

/**
 * Deep link `https://wa.me/<phone>?text=<mensaje>` con un mensaje prearmado (publicCode + total). El teléfono es
 * el de la TIENDA (`profile.whatsapp`); nunca se usa/inventa el del comprador. null → sin teléfono válido.
 */
export function whatsappOrderLink(
  profile: { whatsapp: string | null },
  order: { publicCode: string; totalCents: number },
): string | null {
  const phone = normalizePhone(profile.whatsapp);
  if (!phone) return null;
  const text = `Hola! Consulto por mi pedido ${order.publicCode} (total ${formatArsCents(order.totalCents)}).`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
