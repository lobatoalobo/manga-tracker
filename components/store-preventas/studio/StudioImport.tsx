"use client";

import { useState } from "react";
import { MessageCircle, Plus, Upload, Search, ClipboardList, Check } from "lucide-react";
import { pesosToCents } from "@/lib/retail/format";
import { reviewRowsFromMessage, reviewRowsFromCsv, reviewRowsFromSheet, reviewRowToManual, reviewRowValid, type ReviewRow } from "./format";
import type { ManualOfferRow } from "@/app/tiendas/[slug]/preventas/actions";
import type { OfferVolumeCandidate } from "@/lib/retail/volumeSearch";

export type ImportKind = "whatsapp" | "manual" | "file";

interface Props {
  active: ImportKind | null;
  setActive: (k: ImportKind | null) => void;
  manualEnabled: boolean;
  busy: boolean;
  onAddManualBatch: (rows: ManualOfferRow[]) => void;
  onAddManual: (row: ManualOfferRow) => void;
  onAddCatalog: (input: { volumeId: number; listPriceCents: number; preorderPriceCents: number; isReprint: boolean; publisherDiscountPct: number | null; title: string }) => void;
  onSearchCatalog: (q: string) => Promise<OfferVolumeCandidate[]>;
}

const cardCls = "flex items-start gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm transition-colors";

export function StudioImport(props: Props) {
  const { active, setActive } = props;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ImportCard kind="whatsapp" active={active} setActive={setActive} icon={MessageCircle} title="Importar desde WhatsApp" sub="Pegá el mensaje con novedades, editoriales, títulos y precios." tone="text-emerald-600 bg-emerald-100" />
        <ImportCard kind="manual" active={active} setActive={setActive} icon={Plus} title="Agregar tomo manualmente" sub="Buscá en el catálogo o agregá tomos que aún no existen." tone="text-violet-600 bg-violet-100" />
        <ImportCard kind="file" active={active} setActive={setActive} icon={Upload} title="Importar desde archivo" sub="CSV o TXT con tus novedades." tone="text-sky-600 bg-sky-100" />
      </div>

      {active === "whatsapp" ? <WhatsAppPanel {...props} /> : null}
      {active === "manual" ? <ManualPanel {...props} /> : null}
      {active === "file" ? <FilePanel {...props} /> : null}
    </div>
  );
}

function ImportCard({ kind, active, setActive, icon: Icon, title, sub, tone }: { kind: ImportKind; active: ImportKind | null; setActive: (k: ImportKind | null) => void; icon: typeof Plus; title: string; sub: string; tone: string }) {
  const on = active === kind;
  return (
    <button type="button" onClick={() => setActive(on ? null : kind)} className={`${cardCls} ${on ? "border-violet-300 ring-2 ring-violet-100" : "border-slate-200/70 hover:border-slate-300"}`}>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon size={20} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-400">{sub}</span>
      </span>
    </button>
  );
}

function GatingNote() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
      El alta de novedades que aún no están en el catálogo está deshabilitada. Activá la opción <strong>Ofertas manuales</strong> (feature flag <code>retail-manual-offers</code>) para usar esta carga.
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100";

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">{children}</div>;
}

function WhatsAppPanel({ manualEnabled, busy, onAddManualBatch }: Props) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  return (
    <Panel>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setRows(null); }} rows={6} placeholder="Pegá acá el mensaje de WhatsApp con editoriales, títulos y precios…" className={inputCls} />
      <div className="mt-3">
        <button type="button" onClick={() => setRows(reviewRowsFromMessage(text))} disabled={!text.trim()} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50">
          <ClipboardList size={16} aria-hidden /> Analizar mensaje
        </button>
      </div>
      {rows ? (rows.length === 0 ? <EmptyReview /> : !manualEnabled ? <div className="mt-4"><GatingNote /></div> : <ReviewTable initial={rows} busy={busy} onAdd={onAddManualBatch} />) : null}
    </Panel>
  );
}

function FilePanel({ manualEnabled, busy, onAddManualBatch }: Props) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [name, setName] = useState("");

  const [err, setErr] = useState<string | null>(null);

  async function onFile(file: File) {
    setName(file.name);
    setErr(null);
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const readXlsxFile = (await import("read-excel-file/browser")).default;
        const matrix = (await readXlsxFile(file)) as unknown as (string | number | boolean | Date | null)[][];
        setRows(reviewRowsFromSheet(matrix));
      } else {
        const text = await file.text();
        setRows(/\.csv$/i.test(file.name) ? reviewRowsFromCsv(text) : reviewRowsFromMessage(text));
      }
    } catch {
      setErr("No pudimos leer el archivo. Revisá que sea un CSV, TXT o Excel válido.");
      setRows(null);
    }
  }

  return (
    <Panel>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/40 px-6 py-8 text-center">
        <Upload size={22} className="text-slate-400" aria-hidden />
        <span className="text-sm font-medium text-slate-600">{name || "Elegí un archivo CSV, TXT o Excel"}</span>
        <span className="text-xs text-slate-400">Columnas: editorial, título, volumen, precio lista, precio preventa, descuento, reimpresión.</span>
        <input type="file" accept=".csv,.txt,.xlsx,.xls,text/plain,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>
      {err ? <p className="mt-3 text-sm text-rose-600">{err}</p> : null}
      {rows ? (rows.length === 0 ? <EmptyReview /> : !manualEnabled ? <div className="mt-4"><GatingNote /></div> : <ReviewTable initial={rows} busy={busy} onAdd={onAddManualBatch} />) : null}
    </Panel>
  );
}

function ManualPanel({ manualEnabled, busy, onAddManual, onAddCatalog, onSearchCatalog }: Props) {
  const [tab, setTab] = useState<"catalogo" | "nueva">("catalogo");
  return (
    <Panel>
      <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
        <button type="button" onClick={() => setTab("catalogo")} className={`rounded-lg px-3 py-1.5 font-medium ${tab === "catalogo" ? "bg-white text-violet-600 shadow-sm" : "text-slate-500"}`}>Buscar en catálogo</button>
        <button type="button" onClick={() => setTab("nueva")} className={`rounded-lg px-3 py-1.5 font-medium ${tab === "nueva" ? "bg-white text-violet-600 shadow-sm" : "text-slate-500"}`}>No está en el catálogo</button>
      </div>
      {tab === "catalogo" ? <CatalogSearch busy={busy} onSearch={onSearchCatalog} onAdd={onAddCatalog} /> : manualEnabled ? <ManualForm busy={busy} onAdd={onAddManual} /> : <GatingNote />}
    </Panel>
  );
}

function CatalogSearch({ busy, onSearch, onAdd }: { busy: boolean; onSearch: Props["onSearchCatalog"]; onAdd: Props["onAddCatalog"] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OfferVolumeCandidate[] | null>(null);
  const [picked, setPicked] = useState<OfferVolumeCandidate | null>(null);
  const [list, setList] = useState("");
  const [pre, setPre] = useState("");
  const [searching, setSearching] = useState(false);

  async function run() {
    if (q.trim().length < 2) return;
    setSearching(true);
    try { setResults(await onSearch(q)); } finally { setSearching(false); }
  }

  if (picked) {
    const listCents = pesosToCents(list);
    const preCents = pesosToCents(pre);
    const valid = listCents != null && preCents != null && preCents <= listCents;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-700">{picked.title} {picked.volumeNumber} · {picked.publisher}</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">Precio de lista<input value={list} onChange={(e) => setList(e.target.value)} inputMode="numeric" className={inputCls} /></label>
          <label className="text-xs text-slate-500">Precio de preventa<input value={pre} onChange={(e) => setPre(e.target.value)} inputMode="numeric" className={inputCls} /></label>
        </div>
        {!valid && (list || pre) ? <p className="text-xs text-rose-600">La preventa no puede superar el precio de lista.</p> : null}
        <div className="flex gap-2">
          <button type="button" disabled={!valid || busy} onClick={() => { onAdd({ volumeId: picked.volumeId, listPriceCents: listCents!, preorderPriceCents: preCents!, isReprint: false, publisherDiscountPct: null, title: picked.title }); setPicked(null); setList(""); setPre(""); }} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"><Plus size={16} aria-hidden /> Agregar a la preventa</button>
          <button type="button" onClick={() => setPicked(null)} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50">Volver</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
        <Search size={18} className="text-slate-400" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar un tomo en el catálogo…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
        <button type="submit" className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white">Buscar</button>
      </form>
      {searching ? <p className="text-sm text-slate-400">Buscando…</p> : null}
      {results && results.length === 0 ? <p className="text-sm text-slate-400">No encontramos ese tomo en el catálogo. Probá con “No está en el catálogo”.</p> : null}
      {results && results.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {results.map((r) => (
            <li key={r.volumeId}><button type="button" onClick={() => setPicked(r)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50">
              <span className="truncate text-slate-700">{r.title} {r.volumeNumber}</span><span className="shrink-0 text-xs text-slate-400">{r.publisher}</span>
            </button></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ManualForm({ busy, onAdd }: { busy: boolean; onAdd: Props["onAddManual"] }) {
  const [f, setF] = useState({ title: "", volumeNumber: "", publisher: "", list: "", pre: "", isReprint: false, disc: "" });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const listCents = pesosToCents(f.list || f.pre);
  const preCents = pesosToCents(f.pre);
  const valid = f.title.trim() && preCents != null && listCents != null && preCents <= listCents;

  function submit() {
    if (!valid) return;
    onAdd({ title: f.title.trim(), volumeNumber: f.volumeNumber.trim() ? Number(f.volumeNumber) : null, publisher: f.publisher.trim() || null, isbn: null, listPriceCents: listCents!, preorderPriceCents: preCents!, isReprint: f.isReprint, publisherDiscountPct: f.disc.trim() ? Number(f.disc) : null });
    setF({ title: "", volumeNumber: "", publisher: "", list: "", pre: "", isReprint: false, disc: "" });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500 sm:col-span-2">Título<input value={f.title} onChange={(e) => set("title")(e.target.value)} className={inputCls} placeholder="One Piece" /></label>
        <label className="text-xs text-slate-500">Volumen<input value={f.volumeNumber} onChange={(e) => set("volumeNumber")(e.target.value)} inputMode="numeric" className={inputCls} placeholder="109" /></label>
        <label className="text-xs text-slate-500">Editorial<input value={f.publisher} onChange={(e) => set("publisher")(e.target.value)} className={inputCls} placeholder="Ivrea" /></label>
        <label className="text-xs text-slate-500">Precio de lista<input value={f.list} onChange={(e) => set("list")(e.target.value)} inputMode="numeric" className={inputCls} /></label>
        <label className="text-xs text-slate-500">Precio de preventa<input value={f.pre} onChange={(e) => set("pre")(e.target.value)} inputMode="numeric" className={inputCls} /></label>
        <label className="text-xs text-slate-500">Descuento %<input value={f.disc} onChange={(e) => set("disc")(e.target.value)} inputMode="numeric" className={inputCls} /></label>
        <label className="flex items-center gap-2 pt-5 text-sm text-slate-600"><input type="checkbox" checked={f.isReprint} onChange={(e) => set("isReprint")(e.target.checked)} /> Reimpresión</label>
      </div>
      <button type="button" disabled={!valid || busy} onClick={submit} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"><Plus size={16} aria-hidden /> Agregar a la preventa</button>
    </div>
  );
}

function EmptyReview() {
  return <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/40 px-4 py-6 text-center text-sm text-slate-400">No reconocimos novedades en el contenido. Revisá el formato o cargá manualmente.</p>;
}

function ReviewTable({ initial, busy, onAdd }: { initial: ReviewRow[]; busy: boolean; onAdd: (rows: ManualOfferRow[]) => void }) {
  const [rows, setRows] = useState<ReviewRow[]>(initial);
  const patch = (i: number, p: Partial<ReviewRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const selected = rows.filter((r) => r.include && reviewRowValid(r));
  const cls = "w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-violet-300";

  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium text-slate-600">Revisá antes de agregar ({rows.length} {rows.length === 1 ? "línea" : "líneas"})</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className={`grid grid-cols-12 items-center gap-2 rounded-xl border px-2 py-2 ${r.needsReview ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}`}>
            <input type="checkbox" checked={r.include} onChange={(e) => patch(i, { include: e.target.checked })} className="col-span-1" />
            <input value={r.title} onChange={(e) => patch(i, { title: e.target.value, needsReview: false })} placeholder="Título" className={`${cls} col-span-4`} />
            <input value={r.volumeNumber} onChange={(e) => patch(i, { volumeNumber: e.target.value })} placeholder="Vol" className={`${cls} col-span-1`} inputMode="numeric" />
            <input value={r.publisher} onChange={(e) => patch(i, { publisher: e.target.value })} placeholder="Editorial" className={`${cls} col-span-3`} />
            <input value={r.preorderPesos} onChange={(e) => patch(i, { preorderPesos: e.target.value, listPesos: r.listPesos || e.target.value })} placeholder="$" className={`${cls} col-span-2`} inputMode="numeric" />
            <label className="col-span-1 flex items-center justify-center" title="Reimpresión"><input type="checkbox" checked={r.isReprint} onChange={(e) => patch(i, { isReprint: e.target.checked })} /></label>
            {r.needsReview ? <span className="col-span-12 text-[11px] font-medium text-amber-700">Necesita revisión</span> : null}
          </div>
        ))}
      </div>
      <button type="button" disabled={selected.length === 0 || busy} onClick={() => onAdd(selected.map(reviewRowToManual).filter((x): x is ManualOfferRow => x !== null))} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50">
        <Check size={16} aria-hidden /> Agregar seleccionados ({selected.length})
      </button>
    </div>
  );
}
