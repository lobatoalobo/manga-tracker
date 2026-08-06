/**
 * Dominio de Retail — COMPOSICIÓN del mensaje de novedades para el cliente (estilo Crumb). PURO: sin Prisma,
 * `now`/fechas inyectadas. Agrupa las ofertas por editorial, separa las reimpresiones y arma el texto listo
 * para copiar/enviar. Es la contraparte del parser: parser (texto → ofertas) / composer (ofertas → texto).
 *
 * NOTA de modelo: `isReprint` y el descuento por editorial NO viven hoy en `PreorderOffer` (ver reporte de
 * incompatibilidad); el composer los ACEPTA como entrada para estar listo cuando se sumen por migración aditiva.
 */

export interface ComposeOffer {
  title: string;
  volumeNumber: number | null;
  publisher: string | null;
  preorderPriceCents: number;
  isReprint?: boolean;
}

export interface ComposeMeta {
  opensAt?: Date | null;
  closesAt?: Date | null;
  /** Descuento por editorial (nombre → porcentaje), si se conoce. */
  discounts?: Record<string, number>;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const fechaLarga = (d: Date) => `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
const pesos = (cents: number) => `$${Math.round(cents / 100)}`;
const vol = (n: number | null) => (n !== null ? ` ${n}` : "");

const itemLine = (o: ComposeOffer) => `${o.title}${vol(o.volumeNumber)} ${pesos(o.preorderPriceCents)}`;
const reprintLine = (o: ComposeOffer) => `${o.title}${vol(o.volumeNumber)}`;

/**
 * Arma el mensaje. Los bloques (saludo, aviso de cierre, cada editorial, reimpresiones, cierre) se separan con
 * una línea en blanco; dentro de cada bloque, una línea por ítem. El orden de las editoriales respeta el de
 * aparición de las ofertas.
 */
export function composePreorderMessage(offers: ComposeOffer[], meta: ComposeMeta = {}): string {
  const blocks: string[] = [];

  blocks.push(meta.opensAt ? `Hola, les traemos las novedades del ${fechaLarga(meta.opensAt)}.` : "Hola, les traemos las novedades.");
  if (meta.closesAt) {
    blocks.push(`IMPORTANTE: HAGAN SUS PEDIDOS hasta el ${DIAS[meta.closesAt.getDay()].toUpperCase()} A LAS ${meta.closesAt.getHours()} HS.`);
  }

  const regular = offers.filter((o) => !o.isReprint);
  const reprints = offers.filter((o) => o.isReprint);

  // Agrupa por editorial preservando el orden de primera aparición.
  const groups = new Map<string, ComposeOffer[]>();
  for (const o of regular) {
    const key = o.publisher ?? "Otros";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }
  for (const [pub, list] of groups) {
    const disc = meta.discounts?.[pub];
    const header = `${pub.toUpperCase()}${disc ? ` ${disc}% DE DESC. CRUMB` : ""}`;
    blocks.push([header, ...list.map(itemLine)].join("\n"));
  }

  if (reprints.length) blocks.push(["REIMPRESIONES:", ...reprints.map(reprintLine)].join("\n"));

  blocks.push("¡Gracias!");
  return blocks.join("\n\n");
}
