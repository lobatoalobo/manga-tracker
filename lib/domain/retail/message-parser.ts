/**
 * Dominio de Retail — PARSER del mensaje de novedades (estilo WhatsApp de Crumb). PURO: sin Prisma, sin red,
 * sin reloj. Convierte texto libre en filas PROPUESTAS para revisión humana; NUNCA agrega solo. Es heurístico
 * y deliberadamente conservador: lo que no reconoce NO se descarta, se marca `needsReview` para que la tienda
 * lo corrija en la etapa de revisión.
 *
 * Detecta: editorial (encabezado), descuento de la editorial, título, volumen, precio, reimpresión y líneas no
 * reconocidas. La sección "REIMPRESIONES:" marca las líneas siguientes como reimpresión hasta el próximo
 * encabezado de editorial.
 */

export interface ParsedItem {
  raw: string;
  kind: "item" | "unrecognized";
  publisher: string | null;
  title: string | null;
  volumeNumber: number | null;
  priceCents: number | null;
  isReprint: boolean;
  /** true cuando la línea no se reconoció o le falta un dato necesario (precio en un título normal). */
  needsReview: boolean;
}

export interface ParsedPublisher {
  name: string;
  discountPct: number | null;
}

export interface ParseResult {
  items: ParsedItem[];
  publishers: ParsedPublisher[];
}

const DISCOUNT_RE = /^(.*?)\s+(\d{1,3})\s*%\s*(?:de\s*)?desc/i;
const REPRINT_RE = /^\s*reimpresi/i;
const PRICE_RE = /\$\s?([\d][\d.,]*)/;
const TRAILING_VOL_RE = /(?:vol\.?\s*)?(\d{1,4})\s*$/i;

/** "$12.000" / "$12000" → centavos (pesos enteros × 100). null si no hay dígitos válidos. */
function priceToCents(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const pesos = Number(digits);
  return Number.isFinite(pesos) && pesos > 0 ? pesos * 100 : null;
}

/** Encabezado de editorial "a secas": línea en MAYÚSCULAS, sin dígitos, de pocas palabras (p. ej. "PLANETA MANGA"). */
function isPlainPublisher(line: string): boolean {
  if (PRICE_RE.test(line) || /\d/.test(line)) return false;
  const letters = line.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, "").trim();
  if (!letters || letters !== letters.toUpperCase()) return false;
  return letters.split(/\s+/).length <= 4;
}

/** ¿La línea parece un ítem (tiene precio o un número de volumen al final)? */
function looksLikeItem(line: string): boolean {
  if (PRICE_RE.test(line)) return true;
  return TRAILING_VOL_RE.test(line.replace(PRICE_RE, "").trim());
}

function parseItem(line: string, publisher: string | null, isReprint: boolean): ParsedItem {
  const priceMatch = line.match(PRICE_RE);
  const priceCents = priceMatch ? priceToCents(priceMatch[1]) : null;

  let rest = line.replace(PRICE_RE, "").trim();
  let volumeNumber: number | null = null;
  const volMatch = rest.match(TRAILING_VOL_RE);
  if (volMatch && volMatch.index !== undefined) {
    volumeNumber = Number(volMatch[1]);
    rest = rest.slice(0, volMatch.index).trim();
  }
  const title = rest.replace(/\s{2,}/g, " ").trim() || null;
  const needsReview = title === null || (!isReprint && priceCents === null);
  return { raw: line, kind: "item", publisher, title, volumeNumber, priceCents, isReprint, needsReview };
}

function upsertPublisher(list: ParsedPublisher[], name: string, discountPct: number | null): void {
  const found = list.find((p) => p.name === name);
  if (!found) list.push({ name, discountPct });
  else if (discountPct !== null) found.discountPct = discountPct;
}

/** Analiza el mensaje completo. NO agrega nada: devuelve filas propuestas para revisión. */
export function parsePreorderMessage(text: string): ParseResult {
  const items: ParsedItem[] = [];
  const publishers: ParsedPublisher[] = [];
  let publisher: string | null = null;
  let reprintMode = false;

  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (REPRINT_RE.test(line)) {
      reprintMode = true;
      continue;
    }

    const disc = line.match(DISCOUNT_RE);
    if (disc) {
      publisher = disc[1].trim() || null;
      reprintMode = false;
      if (publisher) upsertPublisher(publishers, publisher, Number(disc[2]));
      continue;
    }

    if (isPlainPublisher(line)) {
      publisher = line.trim();
      reprintMode = false;
      upsertPublisher(publishers, publisher, null);
      continue;
    }

    if (looksLikeItem(line)) {
      items.push(parseItem(line, publisher, reprintMode));
      continue;
    }

    items.push({ raw: line, kind: "unrecognized", publisher, title: null, volumeNumber: null, priceCents: null, isReprint: reprintMode, needsReview: true });
  }

  return { items, publishers };
}
