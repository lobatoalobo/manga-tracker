"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Menu, CalendarDays, ClipboardList, Search, Check, ChevronRight } from "lucide-react";
import { StoreShell, useOpenMenu } from "@/components/store-home/StoreShell";
import { TopbarActions } from "@/components/store-home/TopbarActions";
import { retailErrorLabel } from "@/lib/retail/format";
import { createStoreCampaignAction } from "@/app/tiendas/[slug]/preventas/actions";

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "vie 7/08 · 15:00" desde un valor datetime-local; "—" si vacío/ inválido. */
function fmtDateTime(v: string): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}/${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function durationLabel(opensAt: string, closesAt: string): string {
  if (!opensAt || !closesAt) return "—";
  const a = new Date(opensAt).getTime(), b = new Date(closesAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return "—";
  const hours = Math.round((b - a) / 3_600_000);
  if (hours < 24) return `≈ ${hours} h`;
  const days = Math.round(hours / 24);
  return `≈ ${days} ${days === 1 ? "día" : "días"}`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

const inputCls =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100";

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`truncate text-right ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}

/** Pantalla SaaS de creación de preventa. Reutiliza el servicio real de creación; deja la preventa en borrador. */
export function NuevaPreventaScreen({ slug }: { slug: string }) {
  const onMenu = useOpenMenu();
  const [title, setTitle] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [grace, setGrace] = useState("hasta_cierre");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [pending, start] = useTransition();

  const dateError = useMemo(
    () => Boolean(opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime()),
    [opensAt, closesAt],
  );
  const canSubmit = title.trim().length > 0 && !dateError && !pending;

  function submit() {
    if (!canSubmit) return;
    start(async () => {
      setError(null);
      const r = await createStoreCampaignAction(slug, {
        title: title.trim(),
        description: description.trim(),
        opensAt: opensAt || null,
        closesAt: closesAt || null,
      });
      if (r.ok) setCreated(r.id);
      else setError(retailErrorLabel(r.error));
    });
  }

  return (
    <StoreShell active="preventas">
      {/* Encabezado */}
      <header className="space-y-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onMenu} aria-label="Abrir menú" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden">
            <Menu size={20} aria-hidden />
          </button>
          <div className="min-w-0 flex-1" />
          <TopbarActions />
        </div>
        <div>
          <nav className="flex items-center gap-1 text-sm text-slate-400">
            <Link href={`/tiendas/${slug}/preventas`} className="transition-colors hover:text-violet-600">Preventas</Link>
            <ChevronRight size={14} aria-hidden />
            <span className="text-slate-600">Nueva preventa</span>
          </nav>
          <div className="mt-2 flex items-center gap-3">
            <CalendarDays size={26} strokeWidth={2.2} className="shrink-0 text-violet-600" aria-hidden />
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Nueva preventa</h1>
              <p className="text-sm text-slate-500">Configurá la edición y prepará las novedades antes de publicarlas.</p>
            </div>
          </div>
        </div>
      </header>

      {created !== null ? (
        <CreatedPanel slug={slug} id={created} name={title.trim() || "Sin nombre"} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Columna principal */}
          <div className="space-y-6 lg:col-span-2">
            <Card title="Información de la preventa">
              <div className="space-y-4">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Nombre de la preventa</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Novedades 7 de Agosto" className={inputCls} />
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Apertura</span>
                    <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className={inputCls} />
                    <span className="mt-1 block text-xs text-slate-400">Cuándo abrís a los clientes.</span>
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Cierre</span>
                    <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={inputCls} />
                    <span className="mt-1 block text-xs text-slate-400">Suele ser pocos días después (viernes a lunes).</span>
                  </label>
                </div>
                {dateError ? <p className="text-sm text-rose-600">El cierre tiene que ser posterior a la apertura.</p> : null}
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Período de gracia para cambios</span>
                  <select value={grace} onChange={(e) => setGrace(e.target.value)} className={inputCls}>
                    <option value="hasta_cierre">Hasta el cierre</option>
                    <option value="12h">12 h después del cierre</option>
                    <option value="24h">24 h después del cierre</option>
                    <option value="48h">48 h después del cierre</option>
                  </select>
                  <span className="mt-1 block text-xs text-slate-400">Todavía no se guarda — se suma en una próxima actualización.</span>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">Mensaje interno (opcional)</span>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Notas para tu equipo (no se muestran al cliente)." className={inputCls} />
                </label>
              </div>
            </Card>

            <Card title="Cargar novedades">
              <p className="mb-3 text-sm text-slate-500">Pegá el mensaje de novedades o buscá tomos en el catálogo. Las novedades se cargan una vez creado el borrador.</p>
              <textarea
                rows={5}
                placeholder="Pegá acá el mensaje de WhatsApp con editoriales, títulos y precios…"
                className={inputCls}
                onChange={() => setAnalyzed(false)}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setAnalyzed(true)} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700">
                  <ClipboardList size={16} aria-hidden /> Analizar mensaje
                </button>
                <span className="text-xs text-slate-400">o</span>
                <button type="button" onClick={() => setAnalyzed(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
                  <Search size={16} aria-hidden /> Buscar en el catálogo
                </button>
              </div>
              {analyzed ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
                  El analizador de mensajes y el buscador de catálogo llegan en la próxima actualización.
                  Por ahora, creá el borrador y cargá las novedades desde el estudio.
                </div>
              ) : null}
            </Card>
          </div>

          {/* Resumen (sticky) */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-6">
              <Card title="Resumen">
                <div className="divide-y divide-slate-100">
                  <SummaryRow label="Nombre" value={title.trim() || "Sin nombre"} strong />
                  <SummaryRow label="Apertura" value={fmtDateTime(opensAt)} />
                  <SummaryRow label="Cierre" value={fmtDateTime(closesAt)} />
                  <SummaryRow label="Duración" value={durationLabel(opensAt, closesAt)} />
                  <SummaryRow label="Títulos" value="0 agregados" />
                  <SummaryRow label="Comunicación" value="WhatsApp" />
                  <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="text-slate-400">Estado</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Borrador</span>
                  </div>
                </div>

                {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {pending ? "Creando…" : "Crear borrador"}
                </button>
                <Link href={`/tiendas/${slug}/preventas`} className="mt-2 block w-full rounded-xl px-4 py-2.5 text-center text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50">
                  Cancelar
                </Link>
                {!title.trim() ? <p className="mt-2 text-center text-xs text-slate-400">Poné un nombre para crear el borrador.</p> : null}
              </Card>
            </div>
          </div>
        </div>
      )}
    </StoreShell>
  );
}

/** Estado SaaS de "preventa creada" (borrador). Puente temporal al estudio anterior, con advertencia clara. */
function CreatedPanel({ slug, id, name }: { slug: string; id: number; name: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-6 py-12 text-center shadow-sm">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-600">
          <Check size={28} strokeWidth={2.4} aria-hidden />
        </span>
        <h2 className="text-xl font-semibold text-slate-900">Preventa creada</h2>
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">{name}</span> quedó en borrador. Cargá las novedades y publicá cuando esté lista.
        </p>
        <div className="mt-2 flex flex-col items-center gap-2">
          <Link href={`/tiendas/${slug}/admin/preventas/${id}/estudio`} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-700">
            Cargar novedades <ChevronRight size={16} aria-hidden />
          </Link>
          <span className="text-xs text-slate-400">Se abre en el estudio anterior (temporal) hasta migrarlo al nuevo diseño.</span>
        </div>
        <Link href={`/tiendas/${slug}/preventas`} className="mt-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700">
          Volver a Preventas
        </Link>
      </div>
    </div>
  );
}
