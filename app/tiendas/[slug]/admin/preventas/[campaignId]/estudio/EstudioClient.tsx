"use client";

/**
 * EstudioClient — pantalla del editor de la edición (P-03, ADR-013). Dueño del estado OPTIMISTA: aplica cada
 * gesto localmente, delega en las server actions y reconcilia con el `data` autoritativo (o `router.refresh()`
 * donde el efecto cruza filas/pantalla). Corre `composeEdition` (dominio puro) en el cliente para reflejar la
 * portada en vivo sin reimplementar reglas. Solo edita en DRAFT; publicada → solo lectura.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceShell } from "@/components/retail/ui/WorkspaceShell";
import { TomoLine } from "@/components/retail/ui/TomoLine";
import { Portada, type PortadaItem } from "@/components/retail/ui/Portada";
import { ActionBar } from "@/components/retail/ui/ActionBar";
import { Button } from "@/components/retail/ui/Button";
import { Pill, type PillTono } from "@/components/retail/ui/Pill";
import { Money } from "@/components/retail/ui/Money";
import { Search } from "@/components/retail/ui/Search";
import { composeEdition, type OfferForComposition, type EditionItem } from "@/lib/domain/retail/edition-composition";
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
const toItem = (it: EditionItem): PortadaItem => ({ tomo: { serie: it.displayTitle, volumen: it.displayVolume ?? undefined } });

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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfferVolumeCandidate[]>([]);
  const [addDraft, setAddDraft] = useState<Record<number, { lista: string; preventa: string }>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);

  const sorted = useMemo(() => [...offers].sort((a, b) => a.sortOrder - b.sortOrder || a.offerId - b.offerId), [offers]);
  const comp = useMemo(
    () => composeEdition({ offers: offers.map((o) => ({ ...o, status: o.status as OfferForComposition["status"] })), principalOfferId }),
    [offers, principalOfferId],
  );
  const activeCount = offers.filter((o) => o.status === "ACTIVE").length;
  const busy = (offerId: number) => rowPending.has(offerId) || screenPending || readOnly;

  // Runner de gesto POR FILA: snapshot de la fila (+ principal), optimista, reconcilia o revierte.
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

  const choosePrincipal = (offerId: number | null) => {
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
  const hide = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "HIDDEN" }), () => hideOfferAction(offerId),
    (d: { status: string; principalOfferId: number | null }) => { patch(offerId, { status: d.status }); setPrincipal(d.principalOfferId); }, true);
  const show = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "ACTIVE" }), () => showOfferAction(offerId),
    (d: { status: string }) => patch(offerId, { status: d.status }));
  const cancel = (offerId: number) => runRow(offerId, () => patch(offerId, { status: "CANCELLED" }), () => cancelOfferAction(offerId),
    (d: { status: string; principalOfferId: number | null }) => { patch(offerId, { status: d.status }); setPrincipal(d.principalOfferId); }, true);
  const remove = (offerId: number) => runRow(offerId, () => setOffers((prev) => prev.filter((o) => o.offerId !== offerId)), () => removeOfferAction(offerId), undefined, true);

  // --- Reorden (pantalla) ---
  const move = (offerId: number, dir: "up" | "down") => {
    if (screenPending || readOnly) return;
    const ids = sorted.map((o) => o.offerId);
    const idx = ids.indexOf(offerId);
    const j = dir === "up" ? idx - 1 : idx + 1;
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

  // --- Render de una fila ---
  const renderRow = (o: StudioOfferRow, i: number) => {
    const isPrincipal = o.offerId === principalOfferId;
    const active = o.status === "ACTIVE";
    const pending = rowPending.has(o.offerId);
    const err = rowError.get(o.offerId);
    const disabled = busy(o.offerId);
    const estadoPill: { label: string; tono: PillTono } | null =
      isPrincipal ? { label: "Principal", tono: "mark" }
        : !active ? { label: o.status === "HIDDEN" ? "Oculta" : "Cancelada", tono: o.status === "HIDDEN" ? "neutral" : "warn" }
          : o.onCover ? { label: "En portada", tono: "go" } : null;

    return (
      <li key={o.offerId} data-offer-id={o.offerId} style={{ listStyle: "none", borderBottom: "1px solid var(--hair)", padding: "6px 0" }}>
        <TomoLine
          tomo={{ serie: o.displayTitle, volumen: o.displayVolume ?? undefined, autor: o.displayPublisher ?? undefined }}
          precioCents={o.preorderPriceCents}
          aux={<>Lista <Money cents={o.listPriceCents} /> · −{derivedDiscountPercent(o.listPriceCents, o.preorderPriceCents)}%</>}
          estadoVisual={active ? "normal" : "atenuada"}
          accion={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              {estadoPill ? <Pill tono={estadoPill.tono}>{estadoPill.label}</Pill> : null}
              {!readOnly && (
                <>
                  <Button variant="ghost" size="small" ariaLabel="Subir" disabled={disabled || i === 0} onClick={() => move(o.offerId, "up")}>Subir</Button>
                  <Button variant="ghost" size="small" ariaLabel="Bajar" disabled={disabled || i === sorted.length - 1} onClick={() => move(o.offerId, "down")}>Bajar</Button>
                  {active && (o.onCover
                    ? <Button variant="ghost" size="small" disabled={disabled} onClick={() => setCover(o.offerId, false)}>Bajar de portada</Button>
                    : <Button variant="ghost" size="small" disabled={disabled} onClick={() => setCover(o.offerId, true)}>Llevar a portada</Button>)}
                  {active && o.onCover && (isPrincipal
                    ? <Button variant="ghost" size="small" disabled={disabled} onClick={() => choosePrincipal(null)}>Quitar principal</Button>
                    : <Button variant="ghost" size="small" disabled={disabled} onClick={() => choosePrincipal(o.offerId)}>Hacer principal</Button>)}
                  <Button variant="ghost" size="small" disabled={disabled} onClick={() => setEditing({ offerId: o.offerId, lista: centsToPesos(o.listPriceCents), preventa: centsToPesos(o.preorderPriceCents) })}>Editar precio</Button>
                  {active
                    ? <Button variant="ghost" size="small" disabled={disabled} onClick={() => hide(o.offerId)}>Ocultar</Button>
                    : o.status === "HIDDEN" ? <Button variant="ghost" size="small" disabled={disabled} onClick={() => show(o.offerId)}>Mostrar</Button> : null}
                  {o.status !== "CANCELLED" ? <Button variant="warn" size="small" disabled={disabled} onClick={() => cancel(o.offerId)}>Cancelar</Button> : null}
                  <Button variant="warn" size="small" disabled={disabled} onClick={() => remove(o.offerId)}>Quitar</Button>
                </>
              )}
            </span>
          }
        />
        {editing?.offerId === o.offerId ? (
          <div role="group" aria-label="Editar precio" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", flexWrap: "wrap" }}
            onKeyDown={(e) => { if (e.key === "Enter") savePrice(); if (e.key === "Escape") setEditing(null); }}>
            <label style={{ fontFamily: "var(--sans)", fontSize: 12 }}>Lista <input aria-label="Precio de lista" value={editing.lista} onChange={(e) => setEditing({ ...editing, lista: e.target.value })} inputMode="decimal" style={{ width: 90 }} /></label>
            <label style={{ fontFamily: "var(--sans)", fontSize: 12 }}>Preventa <input aria-label="Precio de preventa" value={editing.preventa} onChange={(e) => setEditing({ ...editing, preventa: e.target.value })} inputMode="decimal" style={{ width: 90 }} /></label>
            <Button size="small" onClick={savePrice}>Guardar</Button>
            <Button variant="ghost" size="small" onClick={() => setEditing(null)}>Cancelar</Button>
          </div>
        ) : null}
        {err ? <p role="alert" style={{ margin: "2px 10px", color: "var(--warn)", fontFamily: "var(--sans)", fontSize: 12 }}>{err}</p> : null}
        {pending ? <p aria-live="polite" style={{ margin: "2px 10px", color: "var(--ink-3)", fontFamily: "var(--sans)", fontSize: 12 }}>Guardando…</p> : null}
      </li>
    );
  };

  const portadaResumen = comp.principal ? `principal + ${comp.secundarias.length} en portada` : comp.secundarias.length > 0 ? `${comp.secundarias.length} en portada` : "portada vacía";
  const bloqueoHint = screenError ?? (!readOnly && activeCount < 1 ? "Agregá al menos un tomo para publicar." : undefined);

  return (
    <WorkspaceShell
      edicion={{ titulo, semana: weekLabel, estado: STATUS_PILL[status] ?? { label: status, tono: "neutral" } }}
      faseActual="creacion"
      fasesVisibles={["creacion"]}
      aside={
        <div>
          <h2 style={{ fontFamily: "var(--sans)", fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)" }}>Portada</h2>
          <Portada tamano="mini" principal={comp.principal ? toItem(comp.principal) : null} secundarias={comp.secundarias.map(toItem)} vacio={<span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-3)" }}>Portada vacía — llevá tomos a la portada.</span>} />
        </div>
      }
      pie={<ActionBar
        loading={screenPending}
        sticky
        resumen={<>{activeCount} tomo{activeCount === 1 ? "" : "s"} · {portadaResumen}{screenPending ? " · Guardando…" : ""}</>}
        bloqueo={bloqueoHint}
        acciones={!readOnly ? <Button onClick={publish} loading={screenPending} disabled={activeCount < 1}>Publicar edición</Button> : null}
      />}
    >
      {readOnly ? <p role="status" style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-2)", marginBottom: 12 }}>Edición {STATUS_PILL[status]?.label.toLowerCase() ?? status} — solo lectura. Las operaciones posteriores se gestionan en el admin.</p> : null}

      <ul style={{ margin: 0, padding: 0 }}>
        {sorted.map(renderRow)}
        {sorted.length === 0 ? <li style={{ listStyle: "none", fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>Todavía no hay tomos en la edición.</li> : null}
      </ul>

      {!readOnly ? (
        <section aria-label="Agregar tomo del catálogo" style={{ marginTop: 20, borderTop: "1px solid var(--hair)", paddingTop: 16 }}>
          <h2 style={{ fontFamily: "var(--sans)", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Agregar tomo</h2>
          <Search valor={query} onChange={setQuery} onSubmit={runSearch} placeholder="Buscar en el catálogo…" ariaLabel="Buscar tomo del catálogo" />
          {addError ? <p role="alert" style={{ color: "var(--warn)", fontFamily: "var(--sans)", fontSize: 12, marginTop: 6 }}>{addError}</p> : null}
          <ul style={{ margin: "8px 0 0", padding: 0 }}>
            {results.map((v) => {
              const d = draftOf(v.volumeId);
              return (
                <li key={v.volumeId} style={{ listStyle: "none", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0", borderBottom: "1px solid var(--hair)" }}>
                  <span style={{ flex: "1 1 200px", fontFamily: "var(--sans)", fontSize: 13 }}>{v.title} · {v.volumeNumber} <span style={{ color: "var(--ink-3)" }}>{v.publisher}</span></span>
                  <input aria-label={`Precio de lista de ${v.title}`} value={d.lista} onChange={(e) => setDraft(v.volumeId, { lista: e.target.value })} placeholder="lista" inputMode="decimal" style={{ width: 80 }} />
                  <input aria-label={`Precio de preventa de ${v.title}`} value={d.preventa} onChange={(e) => setDraft(v.volumeId, { preventa: e.target.value })} placeholder="preventa" inputMode="decimal" style={{ width: 80 }} />
                  <Button size="small" loading={addingId === v.volumeId} disabled={screenPending} onClick={() => doAdd(v)}>Agregar</Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
