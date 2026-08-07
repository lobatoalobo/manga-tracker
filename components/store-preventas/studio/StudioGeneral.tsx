"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { isoToLocalInput } from "./format";

export interface GeneralValues {
  title: string;
  opensAt: string | null; // ISO
  closesAt: string | null;
  description: string;
}

const inputCls = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100";

/** Drawer SaaS para editar los datos generales del borrador. Se remonta por `key` al abrir (semilla desde estado). */
export function StudioGeneral({ initial, busy, onClose, onSave }: { initial: GeneralValues; busy: boolean; onClose: () => void; onSave: (g: { title: string; opensAt: string | null; closesAt: string | null; description: string }) => void }) {
  const [title, setTitle] = useState(initial.title);
  const [opensAt, setOpensAt] = useState(isoToLocalInput(initial.opensAt));
  const [closesAt, setClosesAt] = useState(isoToLocalInput(initial.closesAt));
  const [grace, setGrace] = useState("hasta_cierre");
  const [description, setDescription] = useState(initial.description);

  const dateError = Boolean(opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime());

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-[#f6f7fb] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Datos de la preventa</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} aria-hidden /></button>
        </div>
        <div className="flex-1 space-y-4 p-5">
          <label className="block text-sm"><span className="font-medium text-slate-700">Nombre de la preventa</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Novedades 7 de Agosto" className={inputCls} /></label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm"><span className="font-medium text-slate-700">Apertura</span><input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className={inputCls} /></label>
            <label className="block text-sm"><span className="font-medium text-slate-700">Cierre</span><input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={inputCls} /></label>
          </div>
          {dateError ? <p className="text-sm text-rose-600">El cierre tiene que ser posterior a la apertura.</p> : null}
          <label className="block text-sm"><span className="font-medium text-slate-700">Período de gracia para cambios</span>
            <select value={grace} onChange={(e) => setGrace(e.target.value)} className={inputCls}>
              <option value="hasta_cierre">Hasta el cierre</option>
              <option value="12h">12 h después del cierre</option>
              <option value="24h">24 h después del cierre</option>
              <option value="48h">48 h después del cierre</option>
            </select>
            <span className="mt-1 block text-xs text-slate-400">Todavía no se guarda — se suma en una próxima actualización.</span>
          </label>
          <label className="block text-sm"><span className="font-medium text-slate-700">Mensaje interno (opcional)</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Notas para tu equipo (no se muestran al cliente)." className={inputCls} /></label>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <button type="button" disabled={dateError || busy} onClick={() => onSave({ title, opensAt: opensAt || null, closesAt: closesAt || null, description })} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50">{busy ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100">Cancelar</button>
        </div>
      </aside>
    </div>
  );
}
