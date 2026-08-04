"use client";

/**
 * EstudioClient — mesa de trabajo editorial de la edición (P-03, ADR-013). A la IZQUIERDA está la edición
 * (los tomos, en reposo silencioso: tapa → título → precio → editorial; los controles solo aparecen al poner
 * un tomo EN FOCO). A la DERECHA, la Portada como MAQUETA del producto (destacado grande + acompañan + "También
 * incluye" + "Desde $X"). Abajo, el cierre editorial + CTA. Dueño del estado OPTIMISTA: cada gesto se aplica
 * localmente, delega en las server actions y reconcilia con el `data` autoritativo (o `router.refresh()` donde
 * el efecto cruza filas/pantalla). Corre `composeEdition` (dominio puro) en el cliente para reflejar la maqueta
 * en vivo. Solo edita en DRAFT; publicada → solo lectura. Copy de librero: ninguna columna de la base asoma.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceShell } from "@/components/retail/ui/WorkspaceShell";
import { TomoLine } from "@/components/retail/ui/TomoLine";
import { Cover } from "@/components/retail/ui/Cover";
import { ActionBar } from "@/components/retail/ui/ActionBar";
import { BottomSheet } from "@/components/retail/ui/BottomSheet";
import { Button } from "@/components/retail/ui/Button";
import { Pill, type PillTono } from "@/components/retail/ui/Pill";
import { Money } from "@/components/retail/ui/Money";
import { Search } from "@/components/retail/ui/Search";
import { composeEdition, type OfferForComposition, type EditionComposition } from "@/lib/domain/retail/edition-composition";
import { derivedDiscountPercent } from "@/lib/domain/retail/offer";
import type { StudioOfferRow } from "@/lib/retail/studio";
import { pesosToCents, retailErrorLabel } from "@/lib/retail/format";
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

const centsToPesos = (c: number) => String(c / 100);
const addTo = (s: Set<number>, n: number) => { const x = new Set(s); x.add(n); return x; };
const delFrom = (s: Set<number>, n: number) => { const x = new Set(s); x.delete(n); return x; };
const setMap = (m: Map<number, string>, k: number, v: string) => { const x = new Map(m); x.set(k, v); return x; };
const delMap = (m: Map<number, string>, k: number) => { const x = new Map(m); x.delete(k); return x; };
const tomoLabel = (o: { displayTitle: string; displayVolume: number | null }) =>
  o.displayVolume != null ? `${o.displayTitle} ${o.displayVolume}` : o.displayTitle;

const label = { fontFamily: "var(--sans)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase" as const, color: "var(--ink-3)" };

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
  const avgDescuento = activeCount
    ? Math.round(activos.reduce((s, o) => s + derivedDiscountPercent(o.listPriceCents, o.preorderPriceCents), 0) / activeCount)
    : 0;
  const desdeCents = activeCount ? Math.min(...activos.map((o) => o.preorderPriceCents)) : null;
  const busy = (offerId: number) => rowPending.has(offerId) || screenPending || readOnly;

  // Runner de gesto POR FILA: snapshot de la fila (+ destacado), optimista, reconcilia o revierte.
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

  // --- Gestos (reconcile local) ---
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

  // --- Gestos que refrescan ---
  const pausar = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "HIDDEN" }), () => hideOfferAction(offerId),
    (d: { status: string; principalOfferId: number | null }) => { patch(offerId, { status: d.status }); setPrincipal(d.principalOfferId); }, true);
  const reanudar = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "ACTIVE" }), () => showOfferAction(offerId),
    (d: { status: string }) => patch(offerId, { status: d.status }));
  const darDeBaja = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "CANCELLED" }), () => cancelOfferAction(offerId),
    (d: { status: string; principalOfferId: number | null }) => { patch(offerId, { status: d.status }); setPrincipal(d.principalOfferId); }, true);
  const sacar = (offerId: number) => runRow(offerId, () => setOffers((prev) => prev.filter((o) => o.offerId !== offerId)), () => removeOfferAction(offerId), undefined, true);

  // --- Orden (pantalla) ---
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

  // --- Publicar (pantalla) ---
  const publish = () => {
    if (screenPending || readOnly) return;
    setScreenError(null);
    setScreenPending(true);
    publishAction(campaignId)
      .then((r) => { if (!r.ok) setScreenError(r.message); else router.refresh(); })
      .catch(() => setScreenError("Ocurrió un error inesperado."))
      .finally(() => setScreenPending(false));
  };

  // --- Agregar desde catálogo (linked) ---
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

  const toggleFocus = (offerId: number) => { setFocusedId((f) => (f === offerId ? null : offerId)); setEditing((e) => (e && e.offerId !== offerId ? null : e)); };

  // --- Tira de controles de un tomo en foco (solo DRAFT) ---
  const renderControles = (o: StudioOfferRow, i: number) => {
    const active = o.status === "ACTIVE";
    const isPrincipal = o.offerId === principalOfferId;
    const dis = busy(o.offerId);
    return (
      <div role="group" aria-label={`Acciones de ${tomoLabel(o)}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "4px 10px 8px", borderTop: "1px solid var(--hair)" }}>
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
            <Button variant="ghost" size="small" ariaLabel="Más acciones" disabled={dis} onClick={() => setMoreId(o.offerId)}>···</Button>
          </>
        ) : o.status === "HIDDEN" ? (
          <>
            <Button variant="ghost" size="small" disabled={dis} onClick={() => reanudar(o.offerId)}>Reanudar</Button>
            <Button variant="ghost" size="small" ariaLabel="Más acciones" disabled={dis} onClick={() => setMoreId(o.offerId)}>···</Button>
          </>
        ) : (
          <Button variant="warn" size="small" disabled={dis} onClick={() => sacar(o.offerId)}>Sacar de la edición</Button>
        )}
      </div>
    );
  };

  // --- Un tomo de la edición (reposo silencioso; controles solo en foco) ---
  const renderTomo = (o: StudioOfferRow, i: number) => {
    const active = o.status === "ACTIVE";
    const focused = focusedId === o.offerId;
    const pending = rowPending.has(o.offerId);
    const err = rowError.get(o.offerId);
    const dispo: { label: string; tono: PillTono } | null =
      o.status === "HIDDEN" ? { label: "Pausado", tono: "neutral" } : o.status === "CANCELLED" ? { label: "Retirado", tono: "warn" } : null;

    const contenido = (
      <TomoLine
        tomo={{ serie: o.displayTitle, volumen: o.displayVolume ?? undefined, autor: o.displayPublisher ?? undefined }}
        precioCents={o.preorderPriceCents}
        estadoVisual={active ? "normal" : "atenuada"}
        accion={dispo ? <Pill tono={dispo.tono}>{dispo.label}</Pill> : null}
      />
    );

    return (
      <li key={o.offerId} data-offer-id={o.offerId} style={{ listStyle: "none", marginBottom: 8 }}>
        <div data-focused={focused ? "" : undefined} style={{ borderRadius: 12, border: `1px solid ${focused ? "var(--mark)" : "var(--hair)"}`, background: "var(--card)", boxShadow: focused ? "0 2px 12px rgba(0,0,0,.06)" : undefined }}>
          {readOnly ? (
            <div>{contenido}</div>
          ) : (
            <button type="button" aria-expanded={focused} aria-label={tomoLabel(o)} onClick={() => toggleFocus(o.offerId)}
              style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "inherit" }}>
              {contenido}
            </button>
          )}
          {focused && !readOnly ? renderControles(o, i) : null}
          {editing?.offerId === o.offerId ? (
            <div role="group" aria-label="Ajustar precio" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px 8px", flexWrap: "wrap" }}
              onKeyDown={(e) => { if (e.key === "Enter") savePrice(); if (e.key === "Escape") setEditing(null); }}>
              <label style={{ fontFamily: "var(--sans)", fontSize: 12 }}>Lista <input aria-label="Precio de lista" value={editing.lista} onChange={(e) => setEditing({ ...editing, lista: e.target.value })} inputMode="decimal" style={{ width: 90 }} /></label>
              <label style={{ fontFamily: "var(--sans)", fontSize: 12 }}>Preventa <input aria-label="Precio de preventa" value={editing.preventa} onChange={(e) => setEditing({ ...editing, preventa: e.target.value })} inputMode="decimal" style={{ width: 90 }} /></label>
              <Button size="small" onClick={savePrice}>Guardar</Button>
              <Button variant="ghost" size="small" onClick={() => setEditing(null)}>Cancelar</Button>
            </div>
          ) : null}
          {err ? <p role="alert" style={{ margin: "0 10px 8px", color: "var(--warn)", fontFamily: "var(--sans)", fontSize: 12 }}>{err}</p> : null}
          {pending ? <p aria-live="polite" style={{ margin: "0 10px 8px", color: "var(--ink-3)", fontFamily: "var(--sans)", fontSize: 12 }}>Guardando…</p> : null}
        </div>
      </li>
    );
  };

  const bloqueoHint = screenError ?? (!readOnly && activeCount < 1 ? "Agregá un tomo para publicar la edición." : undefined);
  const moreOffer = moreId != null ? offers.find((o) => o.offerId === moreId) ?? null : null;

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
          <span style={{ fontFamily: "var(--sans)", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{activeCount} tomo{activeCount === 1 ? "" : "s"}</span>
          {activeCount > 0 ? <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>Ahorro promedio {avgDescuento}%</span> : null}
          {screenPending ? <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>Guardando…</span> : null}
        </span>}
        bloqueo={bloqueoHint}
        acciones={!readOnly ? <Button onClick={publish} loading={screenPending} disabled={activeCount < 1}>Publicar edición</Button> : null}
      />}
    >
      {readOnly ? <p role="status" style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-2)", marginBottom: 12 }}>Edición {STATUS_PILL[status]?.label.toLowerCase() ?? status} — solo lectura. Las operaciones posteriores se gestionan en el admin.</p> : null}

      {!readOnly ? (
        <button type="button" onClick={() => setAddOpen(true)}
          style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer", background: "var(--card)", border: "1px dashed var(--hair-2)", borderRadius: 12, padding: "12px 14px", marginBottom: 16, color: "inherit" }}>
          <span aria-hidden style={{ fontFamily: "var(--sans)", fontSize: 20, color: "var(--mark)", lineHeight: 1 }}>＋</span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: "var(--sans)", fontSize: 14, fontWeight: 600 }}>Agregar tomo</span>
            <span style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>Buscá en el catálogo y sumá a la edición</span>
          </span>
        </button>
      ) : null}

      <ul style={{ margin: 0, padding: 0 }}>
        {sorted.map(renderTomo)}
        {sorted.length === 0 ? <li style={{ listStyle: "none", fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>Todavía no hay tomos en la edición.</li> : null}
      </ul>

      {/* Sheet: agregar del catálogo */}
      <BottomSheet abierta={addOpen} onCerrar={() => setAddOpen(false)} titulo="Agregar tomo" descripcion="Buscá en el catálogo y definí los precios.">
        <Search valor={query} onChange={setQuery} onSubmit={runSearch} placeholder="Buscar en el catálogo…" ariaLabel="Buscar tomo del catálogo" />
        {addError ? <p role="alert" style={{ color: "var(--warn)", fontFamily: "var(--sans)", fontSize: 12, marginTop: 8 }}>{addError}</p> : null}
        <ul style={{ margin: "12px 0 0", padding: 0 }}>
          {results.map((v) => {
            const d = draftOf(v.volumeId);
            return (
              <li key={v.volumeId} style={{ listStyle: "none", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--hair)" }}>
                <span aria-hidden style={{ flex: "0 0 auto" }}><Cover serie={v.title} volumen={v.volumeNumber} size="sm" /></span>
                <span style={{ flex: "1 1 160px", fontFamily: "var(--sans)", fontSize: 13 }}>{v.title} · {v.volumeNumber} <span style={{ color: "var(--ink-3)" }}>{v.publisher}</span></span>
                <input aria-label={`Precio de lista de ${v.title}`} value={d.lista} onChange={(e) => setDraft(v.volumeId, { lista: e.target.value })} placeholder="lista" inputMode="decimal" style={{ width: 80 }} />
                <input aria-label={`Precio de preventa de ${v.title}`} value={d.preventa} onChange={(e) => setDraft(v.volumeId, { preventa: e.target.value })} placeholder="preventa" inputMode="decimal" style={{ width: 80 }} />
                <Button size="small" loading={addingId === v.volumeId} onClick={() => doAdd(v)}>Agregar</Button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>

      {/* Sheet: más acciones de un tomo */}
      <BottomSheet abierta={moreOffer != null} onCerrar={() => setMoreId(null)} titulo={moreOffer ? tomoLabel(moreOffer) : undefined}>
        {moreOffer ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={label}>Disponibilidad</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {moreOffer.status === "ACTIVE" ? <Button variant="ghost" size="small" onClick={() => { const id = moreOffer.offerId; setMoreId(null); pausar(id); }}>Pausar</Button> : null}
              {moreOffer.status !== "CANCELLED" ? <Button variant="warn" size="small" onClick={() => { const id = moreOffer.offerId; setMoreId(null); darDeBaja(id); }}>Dar de baja</Button> : null}
              <Button variant="warn" size="small" onClick={() => { const id = moreOffer.offerId; setMoreId(null); sacar(id); }}>Sacar de la edición</Button>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </WorkspaceShell>
  );
}

/** Maqueta del producto (aside): destacado grande + acompañan + "También incluye" + "Desde $X". Solo Cover/Money + local. */
function Maqueta({ comp, desdeCents, totalTomos }: { comp: EditionComposition; desdeCents: number | null; totalTomos: number }) {
  const vaciaPortada = !comp.principal && comp.secundarias.length === 0;
  const mensaje = totalTomos === 0 ? "Agregá tomos para armar la edición."
    : vaciaPortada ? "Agregá tomos a la portada."
      : !comp.principal ? "Elegí qué tomo destacar." : null;
  const mostrarDesde = desdeCents != null && (comp.principal != null || comp.secundarias.length > 0);

  return (
    <div style={{ position: "sticky", top: 0 }}>
      <h2 style={label}>Portada</h2>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, borderRadius: 14, border: "1px solid var(--hair)", background: "var(--paper-2)", padding: "20px 16px" }}>
        {comp.principal ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center", maxWidth: 180 }}>
            <Cover serie={comp.principal.displayTitle} volumen={comp.principal.displayVolume ?? undefined} size="xl" />
            <span style={{ fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)" }}>{tomoLabel(comp.principal)}</span>
            {comp.principal.displayPublisher ? <span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-2)" }}>{comp.principal.displayPublisher}</span> : null}
            <Money cents={comp.principal.preorderPriceCents} />
          </div>
        ) : null}

        {comp.secundarias.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
            {comp.secundarias.map((s) => (
              <li key={s.offerId} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, maxWidth: 90 }}>
                <Cover serie={s.displayTitle} volumen={s.displayVolume ?? undefined} size="sm" />
                <span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--ink-2)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{tomoLabel(s)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {comp.principal && comp.resto.length > 0 ? (
          <div style={{ width: "100%", borderTop: "1px solid var(--hair)", paddingTop: 12 }}>
            <p style={label}>También incluye</p>
            <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {comp.resto.map((r) => (
                <li key={r.offerId} style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-2)" }}>{tomoLabel(r)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {mostrarDesde ? (
          <div style={{ width: "100%", borderTop: "1px solid var(--hair)", paddingTop: 12, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-3)" }}>Desde</span>
            <Money cents={desdeCents!} variant="total" />
          </div>
        ) : null}

        {mensaje ? <p style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-3)", textAlign: "center", margin: 0 }}>{mensaje}</p> : null}
      </div>
    </div>
  );
}
