"use client";

/**
 * EstudioClient — mesa de trabajo editorial de la edición (P-03, ADR-013). Izquierda = la edición (tomos en
 * reposo silencioso; los controles aparecen al poner un tomo EN FOCO). Derecha = la Portada como maqueta del
 * producto. Abajo, cierre editorial + CTA. Estado OPTIMISTA con rollback por fila; corre `composeEdition`
 * (dominio puro) en el cliente para reflejar la maqueta en vivo. Solo edita en DRAFT; publicada → solo lectura.
 *
 * Visual: el catálogo NO tiene tapas (0 imágenes), así que la tapa es un greybox tratado como PORTADA DE LIBRO
 * (color determinístico por serie + tipografía). Todo se compone con átomos del Kit (Money/Pill/Button/Search/
 * WorkspaceShell/ActionBar) + composición local; sin portales (el tema [data-retail] no cruza a document.body).
 */
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceShell } from "@/components/retail/ui/WorkspaceShell";
import { ActionBar } from "@/components/retail/ui/ActionBar";
import { Button } from "@/components/retail/ui/Button";
import { Pill, type PillTono } from "@/components/retail/ui/Pill";
import { Money } from "@/components/retail/ui/Money";
import { Search } from "@/components/retail/ui/Search";
import { composeEdition, type OfferForComposition, type EditionComposition, type EditionItem } from "@/lib/domain/retail/edition-composition";
import { derivedDiscountPercent } from "@/lib/domain/retail/offer";
import type { StudioOfferRow } from "@/lib/retail/studio";
import { pesosToCents, formatArsCents, retailErrorLabel } from "@/lib/retail/format";
import { RETAIL_ERROR } from "@/lib/domain/retail/errors";
import {
  addOfferAction, removeOfferAction, updateOfferPriceAction, reorderOffersAction,
  setOnCoverAction, setPrincipalAction, hideOfferAction, showOfferAction, cancelOfferAction, publishAction,
} from "./actions";
import { searchVolumesAction } from "@/app/tiendas/[slug]/admin/preventas/actions";
import type { OfferVolumeCandidate } from "@/lib/retail/volumeSearch";

const STATUS_PILL: Record<string, { label: string; tono: PillTono }> = {
  DRAFT: { label: "Borrador", tono: "neutral" },
  PUBLISHED: { label: "Publicada", tono: "go" },
  CLOSED: { label: "Cerrada", tono: "neutral" },
  CANCELLED: { label: "Cancelada", tono: "warn" },
};

// Paleta de "tapas de libro": tonos editoriales profundos, tinta clara. Determinística por serie.
const COVER_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#7c3a2d", "#f4e4d8"], ["#2f4a5c", "#e2edf3"], ["#3d5a40", "#e7f0e6"], ["#8a6d1f", "#f7efd6"],
  ["#5a3a5c", "#f0e6f2"], ["#2c5a55", "#dcefec"], ["#3a3f4a", "#e8eaef"], ["#8a3f3f", "#f6e4e4"], ["#6b4a2a", "#f3e7d5"],
];
function coverColors(serie: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < serie.length; i++) h = (h * 31 + serie.charCodeAt(i)) >>> 0;
  return COVER_PALETTE[h % COVER_PALETTE.length];
}

/** Tapa como PORTADA DE LIBRO (greybox deliberado): color por serie, lomo, título serif, número. Decorativa. */
function SerieCover({ serie, volumen, w }: { serie: string; volumen?: number | string; w: number }) {
  const [bg, ink] = coverColors(serie);
  const h = Math.round(w * 1.45);
  const spine = Math.max(3, Math.round(w * 0.07));
  const serieFont = Math.max(8, Math.round(w * 0.145));
  const volFont = Math.max(10, Math.round(w * 0.17));
  const pad = Math.round(w * 0.11);
  return (
    <div aria-hidden style={{ position: "relative", width: w, height: h, flex: "0 0 auto", borderRadius: 4, overflow: "hidden", background: bg, boxShadow: "0 2px 7px rgba(0,0,0,.4)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: spine, background: "linear-gradient(90deg, rgba(0,0,0,.32), rgba(0,0,0,.04))" }} />
      <div style={{ position: "absolute", left: spine, right: 0, top: 0, bottom: 0, padding: pad, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 4 }}>
        <div style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: serieFont, lineHeight: 1.12, color: ink, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>{serie}</div>
        {volumen !== undefined && volumen !== "" ? <div style={{ fontFamily: "var(--serif)", fontSize: volFont, fontWeight: 700, color: ink, alignSelf: "flex-end", opacity: 0.92 }}>{volumen}</div> : null}
      </div>
      <div style={{ position: "absolute", inset: 0, border: "1px solid rgba(255,255,255,.10)", borderRadius: 4, pointerEvents: "none" }} />
    </div>
  );
}

const centsToPesos = (c: number) => String(c / 100);
const addTo = (s: Set<number>, n: number) => { const x = new Set(s); x.add(n); return x; };
const delFrom = (s: Set<number>, n: number) => { const x = new Set(s); x.delete(n); return x; };
const setMap = (m: Map<number, string>, k: number, v: string) => { const x = new Map(m); x.set(k, v); return x; };
const delMap = (m: Map<number, string>, k: number) => { const x = new Map(m); x.delete(k); return x; };
const tomoLabel = (o: { displayTitle: string; displayVolume: number | null }) =>
  o.displayVolume != null ? `${o.displayTitle} ${o.displayVolume}` : o.displayTitle;

const eyebrow: CSSProperties = { fontFamily: "var(--sans)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-3)", margin: 0 };
const inputStyle: CSSProperties = { width: 88, fontFamily: "var(--mono)", fontSize: 13, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--hair-2)", background: "var(--paper)", color: "var(--ink)" };

export type EstudioClientProps = {
  campaignId: number;
  status: string;
  titulo: string;
  weekLabel: string;
  principalOfferId: number | null;
  rows: StudioOfferRow[];
};

export default function EstudioClient({ campaignId, status, titulo, weekLabel, principalOfferId: initialPrincipal, rows }: EstudioClientProps) {
  const router = useRouter();
  const readOnly = status !== "DRAFT";

  const [offers, setOffers] = useState<StudioOfferRow[]>(rows);
  const [principalOfferId, setPrincipal] = useState<number | null>(initialPrincipal);
  const [rowPending, setRowPending] = useState<Set<number>>(new Set());
  const [rowError, setRowError] = useState<Map<number, string>>(new Map());
  const [screenPending, setScreenPending] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ offerId: number; lista: string; preventa: string } | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [moreId, setMoreId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfferVolumeCandidate[]>([]);
  const [addDraft, setAddDraft] = useState<Record<number, { lista: string; preventa: string }>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);

  const sorted = useMemo(() => [...offers].sort((a, b) => a.sortOrder - b.sortOrder || a.offerId - b.offerId), [offers]);
  const comp: EditionComposition = useMemo(
    () => composeEdition({ offers: offers.map((o) => ({ ...o, status: o.status as OfferForComposition["status"] })), principalOfferId }),
    [offers, principalOfferId],
  );
  const activos = offers.filter((o) => o.status === "ACTIVE");
  const activeCount = activos.length;
  const avgDescuento = activeCount ? Math.round(activos.reduce((s, o) => s + derivedDiscountPercent(o.listPriceCents, o.preorderPriceCents), 0) / activeCount) : 0;
  const desdeCents = activeCount ? Math.min(...activos.map((o) => o.preorderPriceCents)) : null;
  const busy = (offerId: number) => rowPending.has(offerId) || screenPending || readOnly;

  async function runRow(offerId: number, optimistic: () => void, call: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>, onOk?: (data: never) => void, refresh = false) {
    if (rowPending.has(offerId)) return;
    const rowSnap = offers.find((o) => o.offerId === offerId);
    const principalSnap = principalOfferId;
    const restore = () => {
      setOffers((prev) => { const without = prev.filter((o) => o.offerId !== offerId); return rowSnap ? [...without, rowSnap] : without; });
      setPrincipal(principalSnap);
    };
    setRowError((m) => delMap(m, offerId));
    setRowPending((s) => addTo(s, offerId));
    optimistic();
    try {
      const r = await call();
      if (!r.ok) { restore(); setRowError((m) => setMap(m, offerId, r.message)); }
      else { onOk?.(r.data as never); if (refresh) router.refresh(); }
    } catch { restore(); setRowError((m) => setMap(m, offerId, "Ocurrió un error inesperado.")); }
    finally { setRowPending((s) => delFrom(s, offerId)); }
  }

  const patch = (offerId: number, p: Partial<StudioOfferRow>) => setOffers((prev) => prev.map((o) => (o.offerId === offerId ? { ...o, ...p } : o)));

  const setCover = (offerId: number, onCover: boolean) =>
    runRow(offerId, () => { patch(offerId, { onCover }); if (!onCover && principalOfferId === offerId) setPrincipal(null); },
      () => setOnCoverAction(offerId, onCover),
      (d: { onCover: boolean; principalOfferId: number | null }) => { patch(offerId, { onCover: d.onCover }); setPrincipal(d.principalOfferId); });

  const destacar = (offerId: number | null) => {
    const scope = offerId ?? principalOfferId ?? -1;
    runRow(scope, () => setPrincipal(offerId), () => setPrincipalAction(campaignId, offerId),
      (d: { principalOfferId: number | null }) => setPrincipal(d.principalOfferId));
  };

  const savePrice = () => {
    if (!editing) return;
    const offerId = editing.offerId;
    const listC = pesosToCents(editing.lista), preC = pesosToCents(editing.preventa);
    if (listC === null || preC === null) { setRowError((m) => setMap(m, offerId, retailErrorLabel(RETAIL_ERROR.INVALID_PRICE))); return; }
    setEditing(null);
    runRow(offerId, () => patch(offerId, { listPriceCents: listC, preorderPriceCents: preC }),
      () => updateOfferPriceAction(offerId, listC, preC),
      (d: { listPriceCents: number; preorderPriceCents: number }) => patch(offerId, { listPriceCents: d.listPriceCents, preorderPriceCents: d.preorderPriceCents }));
  };

  const pausar = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "HIDDEN" }), () => hideOfferAction(offerId),
    (d: { status: string; principalOfferId: number | null }) => { patch(offerId, { status: d.status }); setPrincipal(d.principalOfferId); }, true);
  const reanudar = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "ACTIVE" }), () => showOfferAction(offerId),
    (d: { status: string }) => patch(offerId, { status: d.status }));
  const darDeBaja = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "CANCELLED" }), () => cancelOfferAction(offerId),
    (d: { status: string; principalOfferId: number | null }) => { patch(offerId, { status: d.status }); setPrincipal(d.principalOfferId); }, true);
  const sacar = (offerId: number) => runRow(offerId, () => setOffers((prev) => prev.filter((o) => o.offerId !== offerId)), () => removeOfferAction(offerId), undefined, true);

  const mover = (offerId: number, dir: "adelantar" | "atrasar") => {
    if (screenPending || readOnly) return;
    const ids = sorted.map((o) => o.offerId);
    const idx = ids.indexOf(offerId);
    const j = dir === "adelantar" ? idx - 1 : idx + 1;
    if (j < 0 || j >= ids.length) return;
    const newIds = [...ids];
    [newIds[idx], newIds[j]] = [newIds[j], newIds[idx]];
    const snap = offers;
    setScreenError(null);
    setScreenPending(true);
    setOffers((prev) => prev.map((o) => ({ ...o, sortOrder: newIds.indexOf(o.offerId) })));
    reorderOffersAction(campaignId, newIds)
      .then((r) => { if (!r.ok) { setOffers(snap); setScreenError(r.message); } })
      .catch(() => { setOffers(snap); setScreenError("Ocurrió un error inesperado."); })
      .finally(() => setScreenPending(false));
  };

  const publish = () => {
    if (screenPending || readOnly) return;
    setScreenError(null);
    setScreenPending(true);
    publishAction(campaignId)
      .then((r) => { if (!r.ok) setScreenError(r.message); else router.refresh(); })
      .catch(() => setScreenError("Ocurrió un error inesperado."))
      .finally(() => setScreenPending(false));
  };

  const runSearch = () => { void searchVolumesAction(query).then(setResults); };
  const draftOf = (volumeId: number) => addDraft[volumeId] ?? { lista: "", preventa: "" };
  const setDraft = (volumeId: number, p: Partial<{ lista: string; preventa: string }>) =>
    setAddDraft((prev) => ({ ...prev, [volumeId]: { ...draftOf(volumeId), ...p } }));
  const doAdd = (v: OfferVolumeCandidate) => {
    const d = draftOf(v.volumeId);
    const listC = pesosToCents(d.lista), preC = pesosToCents(d.preventa);
    if (listC === null || preC === null) { setAddError("Ingresá precios válidos (lista y preventa)."); return; }
    setAddError(null);
    setAddingId(v.volumeId);
    addOfferAction(campaignId, { mode: "linked", volumeId: v.volumeId, listPriceCents: listC, preorderPriceCents: preC })
      .then((r) => { if (r.ok) { setOffers((prev) => [...prev, r.data]); setResults([]); setQuery(""); setAddDraft({}); } else setAddError(r.message); })
      .catch(() => setAddError("Ocurrió un error inesperado."))
      .finally(() => setAddingId(null));
  };

  const toggleFocus = (offerId: number) => {
    setFocusedId((f) => (f === offerId ? null : offerId));
    setMoreId(null);
    setEditing((e) => (e && e.offerId !== offerId ? null : e));
  };

  // Tira de controles del tomo en foco.
  const renderControles = (o: StudioOfferRow, i: number) => {
    const active = o.status === "ACTIVE";
    const isPrincipal = o.offerId === principalOfferId;
    const dis = busy(o.offerId);
    const stripStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "8px 14px 12px", borderTop: "1px solid var(--hair)" };
    return (
      <>
        <div role="group" aria-label={`Acciones de ${tomoLabel(o)}`} style={stripStyle}>
          {active ? (
            <>
              {o.onCover
                ? <Button variant="ghost" size="small" disabled={dis} onClick={() => setCover(o.offerId, false)}>Quitar de portada</Button>
                : <Button variant="ghost" size="small" disabled={dis} onClick={() => setCover(o.offerId, true)}>Agregar a portada</Button>}
              {o.onCover && (isPrincipal
                ? <Button variant="ghost" size="small" disabled={dis} onClick={() => destacar(null)}>Ya no destacar</Button>
                : <Button variant="ghost" size="small" disabled={dis} onClick={() => destacar(o.offerId)}>Destacar</Button>)}
              <Button variant="ghost" size="small" disabled={dis} onClick={() => setEditing({ offerId: o.offerId, lista: centsToPesos(o.listPriceCents), preventa: centsToPesos(o.preorderPriceCents) })}>Ajustar precio</Button>
              <Button variant="ghost" size="small" disabled={dis || i === 0} onClick={() => mover(o.offerId, "adelantar")}>Adelantar</Button>
              <Button variant="ghost" size="small" disabled={dis || i === sorted.length - 1} onClick={() => mover(o.offerId, "atrasar")}>Atrasar</Button>
              <Button variant="ghost" size="small" ariaLabel="Más acciones" disabled={dis} onClick={() => setMoreId((m) => (m === o.offerId ? null : o.offerId))}>Más acciones</Button>
            </>
          ) : o.status === "HIDDEN" ? (
            <>
              <Button variant="ghost" size="small" disabled={dis} onClick={() => reanudar(o.offerId)}>Reanudar</Button>
              <Button variant="ghost" size="small" ariaLabel="Más acciones" disabled={dis} onClick={() => setMoreId((m) => (m === o.offerId ? null : o.offerId))}>Más acciones</Button>
            </>
          ) : (
            <Button variant="warn" size="small" disabled={dis} onClick={() => sacar(o.offerId)}>Sacar de la edición</Button>
          )}
        </div>
        {moreId === o.offerId && o.status !== "CANCELLED" ? (
          <div role="group" aria-label="Más acciones" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 12px" }}>
            {active ? <Button variant="ghost" size="small" disabled={dis} onClick={() => pausar(o.offerId)}>Pausar</Button> : null}
            <Button variant="warn" size="small" disabled={dis} onClick={() => darDeBaja(o.offerId)}>Dar de baja</Button>
            <Button variant="warn" size="small" disabled={dis} onClick={() => sacar(o.offerId)}>Sacar de la edición</Button>
          </div>
        ) : null}
      </>
    );
  };

  // Un tomo de la edición (reposo silencioso; foco revela controles).
  const renderTomo = (o: StudioOfferRow, i: number) => {
    const active = o.status === "ACTIVE";
    const focused = focusedId === o.offerId;
    const pending = rowPending.has(o.offerId);
    const err = rowError.get(o.offerId);
    const disc = derivedDiscountPercent(o.listPriceCents, o.preorderPriceCents);
    const dispo: { label: string; tono: PillTono } | null =
      o.status === "HIDDEN" ? { label: "Pausado", tono: "neutral" } : o.status === "CANCELLED" ? { label: "Retirado", tono: "warn" } : null;

    const cuerpo = (
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, width: "100%" }}>
        <SerieCover serie={o.displayTitle} volumen={o.displayVolume ?? undefined} w={50} />
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {o.displayTitle}{o.displayVolume != null ? <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}> · {o.displayVolume}</span> : null}
          </div>
          {o.displayPublisher ? <div style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.displayPublisher}</div> : null}
          {dispo ? <span style={{ display: "inline-flex", marginTop: 6 }}><Pill tono={dispo.tono}>{dispo.label}</Pill></span> : null}
        </div>
        <div style={{ flex: "0 0 auto", textAlign: "right" }}>
          <Money cents={o.preorderPriceCents} variant="total" />
          <div style={{ fontFamily: "var(--sans)", fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>Lista {formatArsCents(o.listPriceCents)}{disc > 0 ? ` · −${disc}%` : ""}</div>
        </div>
      </div>
    );

    return (
      <li key={o.offerId} data-offer-id={o.offerId} style={{ listStyle: "none", marginBottom: 10 }}>
        <div data-focused={focused ? "" : undefined} style={{ borderRadius: 14, border: `1px solid ${focused ? "var(--mark)" : "var(--hair)"}`, background: "var(--card)", boxShadow: focused ? "0 6px 22px rgba(0,0,0,.28)" : "0 1px 2px rgba(0,0,0,.15)", overflow: "hidden", opacity: active ? 1 : 0.62, transition: "border-color .12s, box-shadow .12s" }}>
          {readOnly ? cuerpo : (
            <button type="button" aria-expanded={focused} aria-label={tomoLabel(o)} onClick={() => toggleFocus(o.offerId)}
              style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "inherit" }}>
              {cuerpo}
            </button>
          )}
          {focused && !readOnly ? renderControles(o, i) : null}
          {editing?.offerId === o.offerId ? (
            <div role="group" aria-label="Ajustar precio" style={{ display: "flex", gap: 10, alignItems: "center", padding: "0 14px 12px", flexWrap: "wrap" }}
              onKeyDown={(e) => { if (e.key === "Enter") savePrice(); if (e.key === "Escape") setEditing(null); }}>
              <label style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-2)" }}>Lista <input aria-label="Precio de lista" value={editing.lista} onChange={(e) => setEditing({ ...editing, lista: e.target.value })} inputMode="decimal" style={inputStyle} /></label>
              <label style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-2)" }}>Preventa <input aria-label="Precio de preventa" value={editing.preventa} onChange={(e) => setEditing({ ...editing, preventa: e.target.value })} inputMode="decimal" style={inputStyle} /></label>
              <Button size="small" onClick={savePrice}>Guardar</Button>
              <Button variant="ghost" size="small" onClick={() => setEditing(null)}>Cancelar</Button>
            </div>
          ) : null}
          {err ? <p role="alert" style={{ margin: "0 14px 12px", color: "var(--warn)", fontFamily: "var(--sans)", fontSize: 12 }}>{err}</p> : null}
          {pending ? <p aria-live="polite" style={{ margin: "0 14px 12px", color: "var(--ink-3)", fontFamily: "var(--sans)", fontSize: 12 }}>Guardando…</p> : null}
        </div>
      </li>
    );
  };

  const bloqueoHint = screenError ?? (!readOnly && activeCount < 1 ? "Agregá un tomo para publicar la edición." : undefined);

  return (
    <WorkspaceShell
      edicion={{ titulo, semana: weekLabel, estado: STATUS_PILL[status] ?? { label: status, tono: "neutral" } }}
      faseActual="creacion"
      fasesVisibles={["creacion"]}
      aside={<Maqueta comp={comp} desdeCents={desdeCents} totalTomos={offers.length} />}
      pie={<ActionBar
        loading={screenPending}
        sticky
        resumen={<span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink)" }}>{activeCount} tomo{activeCount === 1 ? "" : "s"}</span>
          {activeCount > 0 ? <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>Ahorro promedio {avgDescuento}%</span> : null}
          {screenPending ? <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>Guardando…</span> : null}
        </span>}
        bloqueo={bloqueoHint}
        acciones={!readOnly ? <Button onClick={publish} loading={screenPending} disabled={activeCount < 1}>Publicar edición</Button> : null}
      />}
    >
      <div style={{ maxWidth: 660 }}>
        {readOnly ? <p role="status" style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-2)", marginBottom: 14 }}>Edición {STATUS_PILL[status]?.label.toLowerCase() ?? status} — solo lectura. Las operaciones posteriores se gestionan en el admin.</p> : null}

        {!readOnly ? (
          <div style={{ marginBottom: 18 }}>
            <button type="button" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer", background: "var(--card)", border: "1px dashed var(--hair-2)", borderRadius: 14, padding: "14px 16px", color: "inherit" }}>
              <span aria-hidden style={{ fontFamily: "var(--sans)", fontSize: 22, color: "var(--mark)", lineHeight: 1 }}>＋</span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)" }}>Agregar tomo</span>
                <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>Buscá en el catálogo y sumá a la edición</span>
              </span>
            </button>
            {addOpen ? (
              <div style={{ marginTop: 10, border: "1px solid var(--hair)", borderRadius: 14, background: "var(--card)", padding: 14 }}>
                <Search valor={query} onChange={setQuery} onSubmit={runSearch} placeholder="Buscar en el catálogo…" ariaLabel="Buscar tomo del catálogo" />
                {addError ? <p role="alert" style={{ color: "var(--warn)", fontFamily: "var(--sans)", fontSize: 12, marginTop: 8 }}>{addError}</p> : null}
                <ul style={{ margin: "10px 0 0", padding: 0 }}>
                  {results.map((v) => {
                    const d = draftOf(v.volumeId);
                    return (
                      <li key={v.volumeId} style={{ listStyle: "none", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--hair)" }}>
                        <SerieCover serie={v.title} volumen={v.volumeNumber} w={38} />
                        <span style={{ flex: "1 1 150px", minWidth: 0, fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink)" }}>{v.title} <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>· {v.volumeNumber}</span><br /><span style={{ fontSize: 12, color: "var(--ink-3)" }}>{v.publisher}</span></span>
                        <input aria-label={`Precio de lista de ${v.title}`} value={d.lista} onChange={(e) => setDraft(v.volumeId, { lista: e.target.value })} placeholder="lista" inputMode="decimal" style={inputStyle} />
                        <input aria-label={`Precio de preventa de ${v.title}`} value={d.preventa} onChange={(e) => setDraft(v.volumeId, { preventa: e.target.value })} placeholder="preventa" inputMode="decimal" style={inputStyle} />
                        <Button size="small" loading={addingId === v.volumeId} onClick={() => doAdd(v)}>Agregar</Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <ul style={{ margin: 0, padding: 0 }}>
          {sorted.map(renderTomo)}
          {sorted.length === 0 ? <li style={{ listStyle: "none", fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>Todavía no hay tomos en la edición.</li> : null}
        </ul>
      </div>
    </WorkspaceShell>
  );
}

/** Maqueta del producto (aside): la edición como se va a ver. Tapa destacada grande + acompañan + "También incluye" + "Desde $X". */
function Maqueta({ comp, desdeCents, totalTomos }: { comp: EditionComposition; desdeCents: number | null; totalTomos: number }) {
  const vaciaPortada = !comp.principal && comp.secundarias.length === 0;
  const mensaje = totalTomos === 0 ? "Agregá tomos para armar la edición."
    : vaciaPortada ? "Agregá tomos a la portada."
      : !comp.principal ? "Elegí qué tomo destacar." : null;
  const mostrarDesde = desdeCents != null && (comp.principal != null || comp.secundarias.length > 0);
  const item = (it: EditionItem) => (it.displayVolume != null ? `${it.displayTitle} ${it.displayVolume}` : it.displayTitle);

  return (
    <div style={{ position: "sticky", top: 0 }}>
      <h2 style={eyebrow}>Portada</h2>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, borderRadius: 16, border: "1px solid var(--hair)", background: "var(--paper-2)", padding: "24px 18px" }}>
        {comp.principal ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", maxWidth: 200 }}>
            <SerieCover serie={comp.principal.displayTitle} volumen={comp.principal.displayVolume ?? undefined} w={132} />
            <span style={{ fontFamily: "var(--serif)", fontSize: 17, color: "var(--ink)", marginTop: 4 }}>{item(comp.principal)}</span>
            {comp.principal.displayPublisher ? <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>{comp.principal.displayPublisher}</span> : null}
            <Money cents={comp.principal.preorderPriceCents} variant="total" />
          </div>
        ) : null}

        {comp.secundarias.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
            {comp.secundarias.map((s) => (
              <li key={s.offerId} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, maxWidth: 84 }}>
                <SerieCover serie={s.displayTitle} volumen={s.displayVolume ?? undefined} w={56} />
                <span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--ink-3)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{item(s)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {comp.principal && comp.resto.length > 0 ? (
          <div style={{ width: "100%", borderTop: "1px solid var(--hair)", paddingTop: 14 }}>
            <p style={eyebrow}>También incluye</p>
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
              {comp.resto.map((r) => (
                <li key={r.offerId} style={{ fontFamily: "var(--serif)", fontSize: 13.5, color: "var(--ink-2)" }}>{item(r)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {mostrarDesde ? (
          <div style={{ width: "100%", borderTop: "1px solid var(--hair)", paddingTop: 14, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-3)", letterSpacing: ".04em" }}>Desde</span>
            <Money cents={desdeCents!} variant="total" />
          </div>
        ) : null}

        {mensaje ? <p style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-3)", textAlign: "center", margin: 0 }}>{mensaje}</p> : null}
      </div>
    </div>
  );
}
