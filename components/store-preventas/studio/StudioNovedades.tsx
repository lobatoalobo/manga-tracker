"use client";

import { useState } from "react";
import { ArrowUp, ArrowDown, MoreVertical, Pencil, Pause, Play, Ban, Trash2, LibraryBig, Plus, GripVertical } from "lucide-react";
import { CoverPlaceholder } from "@/components/store-home/CoverPlaceholder";
import { formatArsCents, centsToPesos, offerStatusLabel } from "./format";
import { pesosToCents } from "@/lib/retail/format";
import type { StudioOffer } from "@/lib/retail/studio";

export type OfferOp = "pause" | "resume" | "cancel" | "remove";
export interface OfferPatch { listPriceCents?: number; preorderPriceCents?: number; isReprint?: boolean; publisherDiscountPct?: number | null }

interface Props {
  offers: StudioOffer[];
  busy: boolean;
  onReorder: (offerId: number, dir: "up" | "down") => void;
  onSetStatus: (offerId: number, op: OfferOp) => void;
  onUpdateOffer: (offerId: number, patch: OfferPatch) => void;
  onAddClick: () => void;
}

export function StudioNovedades({ offers, busy, onReorder, onSetStatus, onUpdateOffer, onAddClick }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <LibraryBig size={18} className="text-violet-600" aria-hidden /> Novedades <span className="text-sm font-normal text-slate-400">({offers.length} {offers.length === 1 ? "tomo" : "tomos"})</span>
        </h2>
      </div>

      {offers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/40 px-6 py-14 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-100 text-violet-500"><LibraryBig size={24} aria-hidden /></span>
          <p className="text-sm font-semibold text-slate-700">Aún no agregaste tomos</p>
          <p className="max-w-xs text-sm text-slate-400">Importá desde WhatsApp, buscá en el catálogo o agregá tomos manualmente.</p>
          <button type="button" onClick={onAddClick} className="mt-1 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700">
            <Plus size={16} aria-hidden /> Agregar tomos
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {offers.map((o, i) =>
            editingId === o.id ? (
              <EditRow key={o.id} offer={o} busy={busy} onCancel={() => setEditingId(null)} onSave={(patch) => { onUpdateOffer(o.id, patch); setEditingId(null); }} />
            ) : (
              <Row
                key={o.id}
                offer={o}
                first={i === 0}
                last={i === offers.length - 1}
                busy={busy}
                onEdit={() => setEditingId(o.id)}
                onReorder={onReorder}
                onSetStatus={onSetStatus}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function Row({ offer, first, last, busy, onEdit, onReorder, onSetStatus }: {
  offer: StudioOffer; first: boolean; last: boolean; busy: boolean;
  onEdit: () => void; onReorder: Props["onReorder"]; onSetStatus: Props["onSetStatus"];
}) {
  const paused = offer.status === "HIDDEN";
  return (
    <li className={`flex items-center gap-3 py-3 ${paused ? "opacity-60" : ""}`}>
      <GripVertical size={16} className="hidden shrink-0 text-slate-300 sm:block" aria-hidden />
      <CoverPlaceholder w={38} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-slate-900">{offer.title}{offer.volumeNumber != null ? ` ${offer.volumeNumber}` : ""}</span>
          {offer.isReprint ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Reimpresión</span> : null}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${paused ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700"}`}>{offerStatusLabel(offer)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
          {offer.publisher ? <span>{offer.publisher}</span> : null}
          {offer.publisherDiscountPct != null ? <span>{offer.publisherDiscountPct}% desc.</span> : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {offer.listPriceCents !== offer.preorderPriceCents ? <div className="text-xs text-slate-400 line-through">{formatArsCents(offer.listPriceCents)}</div> : null}
        <div className="text-sm font-semibold text-slate-900">{formatArsCents(offer.preorderPriceCents)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" disabled={first || busy} onClick={() => onReorder(offer.id, "up")} aria-label="Adelantar" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 disabled:opacity-30"><ArrowUp size={16} aria-hidden /></button>
        <button type="button" disabled={last || busy} onClick={() => onReorder(offer.id, "down")} aria-label="Atrasar" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 disabled:opacity-30"><ArrowDown size={16} aria-hidden /></button>
        <details className="relative">
          <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 [&::-webkit-details-marker]:hidden"><MoreVertical size={16} aria-hidden /></summary>
          <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
            <MenuItem icon={Pencil} label="Editar precio" onClick={onEdit} />
            {paused
              ? <MenuItem icon={Play} label="Reanudar" onClick={() => onSetStatus(offer.id, "resume")} />
              : <MenuItem icon={Pause} label="Pausar" onClick={() => onSetStatus(offer.id, "pause")} />}
            <MenuItem icon={Ban} label="Dar de baja" onClick={() => onSetStatus(offer.id, "cancel")} />
            <MenuItem icon={Trash2} label="Sacar de la edición" danger onClick={() => onSetStatus(offer.id, "remove")} />
          </div>
        </details>
      </div>
    </li>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50 ${danger ? "text-rose-600" : "text-slate-700"}`}>
      <Icon size={15} aria-hidden /> {label}
    </button>
  );
}

function EditRow({ offer, busy, onCancel, onSave }: { offer: StudioOffer; busy: boolean; onCancel: () => void; onSave: (p: OfferPatch) => void }) {
  const [list, setList] = useState(centsToPesos(offer.listPriceCents));
  const [pre, setPre] = useState(centsToPesos(offer.preorderPriceCents));
  const [isReprint, setIsReprint] = useState(offer.isReprint);
  const [disc, setDisc] = useState(offer.publisherDiscountPct != null ? String(offer.publisherDiscountPct) : "");

  const listCents = pesosToCents(list);
  const preCents = pesosToCents(pre);
  const valid = listCents != null && preCents != null && preCents <= listCents;
  const cls = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-300";

  return (
    <li className="py-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-slate-500">Precio de lista<input value={list} onChange={(e) => setList(e.target.value)} className={cls} inputMode="numeric" /></label>
        <label className="text-xs text-slate-500">Precio de preventa<input value={pre} onChange={(e) => setPre(e.target.value)} className={cls} inputMode="numeric" /></label>
        <label className="text-xs text-slate-500">Descuento %<input value={disc} onChange={(e) => setDisc(e.target.value)} className={cls} inputMode="numeric" /></label>
        <label className="flex items-center gap-2 pt-5 text-sm text-slate-600"><input type="checkbox" checked={isReprint} onChange={(e) => setIsReprint(e.target.checked)} /> Reimpresión</label>
      </div>
      {!valid ? <p className="mt-2 text-xs text-rose-600">La preventa no puede superar el precio de lista.</p> : null}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" disabled={!valid || busy} onClick={() => onSave({ listPriceCents: listCents!, preorderPriceCents: preCents!, isReprint, publisherDiscountPct: disc.trim() ? Number(disc) : null })} className="rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50">Guardar</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-50">Cancelar</button>
      </div>
    </li>
  );
}
