/**
 * Decodifica entidades HTML que se cuelan al scrapear títulos/autores/sinopsis
 * (ej. `I&quot;s` → `I"s`, `Caf&eacute;` → `Café`). Algunas fuentes entregan el
 * texto ya escapado y queda guardado literal en la base. Aplicar SIEMPRE al
 * guardar (findOrCreateWork / upsertPublisherEdition) y en el fix de datos.
 * Maneja numéricas (decimal y hex) y un set de nombradas comunes; las nombradas
 * desconocidas se dejan tal cual (no rompe).
 */
const NAMED: Record<string, string> = {
  quot: '"',
  amp: "&",
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  iquest: "¿",
  iexcl: "¡",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
  Uuml: "Ü",
  ouml: "ö",
  auml: "ä",
};

export function decodeEntities(input: string): string {
  if (!input || input.indexOf("&") === -1) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
  });
}
