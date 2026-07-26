/**
 * Infra de Retail — generación del `publicCode` de una StoreOrder (§5).
 *
 * Requisitos: legible, NO secuencial / no enumerable, único, usable por cliente y tienda, y que NO
 * autorice por sí solo (la autorización siempre verifica `order.userId` o la membresía de tienda).
 *
 * Forma: `PREFIJO-CUERPO`. El prefijo se DERIVA de manera estable del slug comercial de la tienda (no se
 * hardcodea "Crumb" ni ningún nombre); si el slug no aporta 3 alfanuméricos se rellena con un prefijo
 * neutral. El cuerpo son 6 caracteres aleatorios de un alfabeto sin caracteres ambiguos (sin 0/O/1/I/L),
 * ~1e9 combinaciones → no enumerable en la práctica. La unicidad la garantiza la constraint + reintentos.
 */
import { randomInt } from "node:crypto";

/** Alfabeto legible (Crockford-ish): sin 0, O, 1, I, L para evitar confusiones al dictarlo/transcribirlo. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BODY_LENGTH = 6;

/** Prefijo estable de 3 caracteres derivado del slug comercial (neutral si el slug no alcanza). */
export function derivePrefix(slug: string): string {
  const alnum = (slug ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const p = alnum.slice(0, 3);
  return p.length === 3 ? p : (p + "PRV").slice(0, 3); // relleno neutral (PReVenta), nunca un nombre real
}

function randomBody(len = BODY_LENGTH): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Genera un `publicCode` para una orden de la tienda `slug`. Ej.: `CRU-7K4P2M`. */
export function generatePublicCode(slug: string): string {
  return `${derivePrefix(slug)}-${randomBody()}`;
}
