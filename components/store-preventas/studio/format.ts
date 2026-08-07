/**
 * Helpers de PRESENTACIÓN del estudio (cliente). Formateo de precios/fechas, conversión de filas de revisión a
 * ofertas manuales, parseo de TXT (reusa el parser de dominio) y CSV, y armado de la vista previa con el
 * composer de dominio. Sin lógica de negocio ni datos mock.
 */
import { formatArsCents, pesosToCents } from "@/lib/retail/format";
import { parsePreorderMessage, type ParseResult } from "@/lib/domain/retail/message-parser";
import { composePreorderMessage, type ComposeOffer } from "@/lib/domain/retail/message-compose";
import type { ManualOfferRow } from "@/app/tiendas/[slug]/preventas/actions";
import type { StudioOffer, StudioState } from "@/lib/retail/studio";

export { formatArsCents };
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Un valor en centavos → string editable en pesos ("1200000" → "12000"). */
export const centsToPesos = (cents: number): string => String(Math.round(cents / 100));

/** ISO → valor para <input type="datetime-local"> en hora local. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Fila editable de revisión (WhatsApp / archivo). Precios en PESOS (texto) hasta confirmar. */
export interface ReviewRow {
  include: boolean;
  title: string;
  volumeNumber: string; // texto para el input
  publisher: string;
  listPesos: string;
  preorderPesos: string;
  isReprint: boolean;
  discountPct: string;
  needsReview: boolean;
}

function rowFromParsed(
  title: string | null,
  volumeNumber: number | null,
  publisher: string | null,
  priceCents: number | null,
  isReprint: boolean,
  discountPct: number | null,
  needsReview: boolean,
): ReviewRow {
  const pesos = priceCents != null ? centsToPesos(priceCents) : "";
  return {
    include: !needsReview,
    title: title ?? "",
    volumeNumber: volumeNumber != null ? String(volumeNumber) : "",
    publisher: publisher ?? "",
    listPesos: pesos,
    preorderPesos: pesos,
    isReprint,
    discountPct: discountPct != null ? String(discountPct) : "",
    needsReview,
  };
}

/** Filas de revisión desde el parser de mensaje (WhatsApp / TXT). */
export function reviewRowsFromMessage(text: string): ReviewRow[] {
  const result: ParseResult = parsePreorderMessage(text);
  const discountBy = new Map(result.publishers.map((p) => [p.name, p.discountPct]));
  return result.items.map((it) =>
    rowFromParsed(it.title, it.volumeNumber, it.publisher, it.priceCents, it.isReprint, it.publisher ? discountBy.get(it.publisher) ?? null : null, it.needsReview),
  );
}

const stripDiacritics = (s: string): string => s.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const norm = (s: string): string => stripDiacritics(s);

interface ColIdx { title: number; vol: number; pub: number; list: number; pre: number; disc: number; re: number }

/** Mapea encabezados (ya normalizados) a índices de columna, tolerante a nombres. */
function mapColumns(headers: string[]): ColIdx {
  const col = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const list = col(["lista", "list"]);
  // Preventa: prioriza "preventa"/"preorder"; solo cae a un "precio" genérico que NO sea la columna de lista.
  let pre = col(["preventa", "preorder"]);
  if (pre < 0) pre = headers.findIndex((h, idx) => h.includes("precio") && idx !== list);
  return { title: col(["titulo", "title", "obra"]), vol: col(["volumen", "vol", "tomo"]), pub: col(["editorial", "publisher"]), list, pre, disc: col(["descuento", "disc"]), re: col(["reimp", "reprint"]) };
}

function buildReviewRow(cells: string[], idx: ColIdx): ReviewRow {
  const at = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
  const title = at(idx.title);
  const preorder = at(idx.pre);
  const list = at(idx.list) || preorder;
  const isReprint = /^(s[ií]|true|1|x)$/i.test(at(idx.re));
  const needsReview = !title || (!isReprint && !preorder);
  return { include: !needsReview, title, volumeNumber: at(idx.vol).replace(/[^\d]/g, ""), publisher: at(idx.pub), listPesos: list.replace(/[^\d]/g, ""), preorderPesos: preorder.replace(/[^\d]/g, ""), isReprint, discountPct: at(idx.disc).replace(/[^\d]/g, ""), needsReview };
}

function reviewRowsFromTable(headerCells: string[], dataRows: string[][]): ReviewRow[] {
  const idx = mapColumns(headerCells.map(norm));
  return dataRows.map((cells) => buildReviewRow(cells, idx));
}

/** CSV (coma o punto y coma; sin comillas complejas). Mapea columnas por encabezado tolerante. */
export function reviewRowsFromCsv(text: string): ReviewRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  return reviewRowsFromTable(lines[0].split(delim), lines.slice(1).map((l) => l.split(delim)));
}

/** Matriz de una hoja de cálculo (read-excel-file) → filas de revisión. Misma lógica que CSV. */
export function reviewRowsFromSheet(matrix: (string | number | boolean | Date | null)[][]): ReviewRow[] {
  const rows = matrix.filter((r) => r.some((c) => c != null && String(c).trim()));
  if (rows.length < 2) return [];
  const toStr = (r: (string | number | boolean | Date | null)[]) => r.map((c) => (c == null ? "" : String(c)));
  return reviewRowsFromTable(toStr(rows[0]), rows.slice(1).map(toStr));
}

/** ¿La fila de revisión es agregable (título + precios válidos)? */
export function reviewRowValid(r: ReviewRow): boolean {
  if (!r.title.trim()) return false;
  const pre = pesosToCents(r.preorderPesos || "0");
  const list = pesosToCents(r.listPesos || r.preorderPesos || "0");
  return pre != null && list != null && pre <= list;
}

/** Fila de revisión → oferta manual (pesos → centavos). Devuelve null si no es válida. */
export function reviewRowToManual(r: ReviewRow): ManualOfferRow | null {
  const preorder = pesosToCents(r.preorderPesos || "0");
  const list = pesosToCents(r.listPesos || r.preorderPesos || "0");
  if (!r.title.trim() || preorder == null || list == null || preorder > list) return null;
  const vol = r.volumeNumber.trim() ? Number(r.volumeNumber) : null;
  const disc = r.discountPct.trim() ? Number(r.discountPct) : null;
  return {
    title: r.title.trim(),
    volumeNumber: Number.isFinite(vol) ? vol : null,
    publisher: r.publisher.trim() || null,
    isbn: null,
    listPriceCents: list,
    preorderPriceCents: preorder,
    isReprint: r.isReprint,
    publisherDiscountPct: disc,
  };
}

/** Resumen real de las ofertas ACTIVAS. */
export function studioSummary(state: StudioState) {
  const active = state.offers.filter((o) => o.status === "ACTIVE");
  const publishers = new Set(active.map((o) => o.publisher).filter(Boolean) as string[]);
  const precioDesdeCents = active.length ? Math.min(...active.map((o) => o.preorderPriceCents)) : null;
  return { tomos: active.length, editoriales: publishers.size, precioDesdeCents };
}

/** Vista previa del mensaje desde las ofertas ACTIVAS reales. */
export function previewFromState(state: StudioState): string {
  const active = state.offers.filter((o) => o.status === "ACTIVE");
  const offers: ComposeOffer[] = active.map((o) => ({ title: o.title, volumeNumber: o.volumeNumber, publisher: o.publisher, preorderPriceCents: o.preorderPriceCents, isReprint: o.isReprint }));
  const discounts: Record<string, number> = {};
  for (const o of active) if (o.publisher && o.publisherDiscountPct != null) discounts[o.publisher] = o.publisherDiscountPct;
  return composePreorderMessage(offers, {
    opensAt: state.opensAt ? new Date(state.opensAt) : null,
    closesAt: state.closesAt ? new Date(state.closesAt) : null,
    discounts,
  });
}

/** Etiqueta de estado de una oferta en la lista. */
export function offerStatusLabel(o: StudioOffer): string {
  return o.status === "HIDDEN" ? "Pausado" : "Activo";
}

/** Ofertas visibles en la lista (activas + pausadas), en orden. PURA (cliente-safe). */
export function visibleOffers(state: StudioState): StudioOffer[] {
  return state.offers.filter((o) => o.status === "ACTIVE" || o.status === "HIDDEN");
}

const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** ISO → "vie 7/08 · 15:00"; "—" si vacío. */
export function fmtIsoDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${WD[d.getDay()]} ${d.getDate()}/${pad2(d.getMonth() + 1)} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Duración legible entre apertura y cierre (ISO). */
export function durationLabel(opensIso: string | null, closesIso: string | null): string {
  if (!opensIso || !closesIso) return "—";
  const a = new Date(opensIso).getTime(), b = new Date(closesIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return "—";
  const hours = Math.round((b - a) / 3_600_000);
  if (hours < 24) return `≈ ${hours} h`;
  const days = Math.round(hours / 24);
  return `≈ ${days} ${days === 1 ? "día" : "días"}`;
}
