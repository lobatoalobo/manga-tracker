"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Menu, ChevronRight, MessageSquare, Rocket, CircleCheck, Copy, Pencil, Lightbulb, CheckCircle2 } from "lucide-react";
import { StoreShell, useOpenMenu } from "@/components/store-home/StoreShell";
import { TopbarActions } from "@/components/store-home/TopbarActions";
import { retailErrorLabel } from "@/lib/retail/format";
import type { StudioState } from "@/lib/retail/studio";
import {
  saveGeneralAction, addManualOfferAction, addManualOffersAction, addCatalogOfferAction,
  searchCatalogAction, updateStudioOfferAction, reorderStudioOfferAction, setStudioOfferStatusAction,
  publishStudioAction, type StudioResult, type ManualOfferRow,
} from "@/app/tiendas/[slug]/preventas/actions";
import { formatArsCents, fmtIsoDateTime, durationLabel, studioSummary, previewFromState, visibleOffers } from "./format";
import { StudioImport, type ImportKind } from "./StudioImport";
import { StudioNovedades, type OfferOp, type OfferPatch } from "./StudioNovedades";
import { StudioGeneral } from "./StudioGeneral";

export function StudioScreen({ slug, initialState, manualEnabled }: { slug: string; initialState: StudioState | null; manualEnabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [state, setState] = useState<StudioState | null>(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(false);
  const [activeImport, setActiveImport] = useState<ImportKind | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [pending, setPending] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const campaignId = state?.campaignId ?? null;

  function syncUrl(id: number) {
    if (params.get("draft") !== String(id)) router.replace(`${pathname}?draft=${id}`, { scroll: false });
  }

  async function run(fn: () => Promise<StudioResult>, after?: () => void) {
    setBusy(true); setError(null); setSaved(false);
    const r = await fn();
    setBusy(false);
    if (r.ok) { setState(r.state); setSaved(true); syncUrl(r.state.campaignId); after?.(); }
    else setError(retailErrorLabel(r.error));
  }

  const publishPending = (): string[] => {
    const p: string[] = [];
    if (!state || !state.title.trim() || state.title === "Preventa sin nombre") p.push("Poné un nombre a la preventa");
    if (!state?.closesAt) p.push("Definí la fecha de cierre");
    if ((state?.offers.filter((o) => o.status === "ACTIVE").length ?? 0) < 1) p.push("Agregá al menos un tomo activo");
    return p;
  };

  function publish() {
    const p = publishPending();
    if (p.length) { setPending(p); return; }
    setPending(null);
    run(() => publishStudioAction(slug, campaignId!));
  }

  // Publicada → pantalla de confirmación.
  if (state?.status === "PUBLISHED") return <PublishedScreen slug={slug} state={state} />;

  const offers = state ? visibleOffers(state) : [];
  const sum = state ? studioSummary(state) : { tomos: 0, editoriales: 0, precioDesdeCents: null };
  const hasActive = (state?.offers.filter((o) => o.status === "ACTIVE").length ?? 0) > 0;

  return (
    <StoreShell active="preventas">
      <Header slug={slug} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Columna principal */}
        <div className="space-y-6 lg:col-span-2">
          <StudioImport
            active={activeImport}
            setActive={setActiveImport}
            manualEnabled={manualEnabled}
            busy={busy}
            onAddManual={(row) => run(() => addManualOfferAction(slug, campaignId, row))}
            onAddManualBatch={(rows) => run(() => addManualOffersAction(slug, campaignId, rows), () => setActiveImport(null))}
            onAddCatalog={(input) => run(() => addCatalogOfferAction(slug, campaignId, input))}
            onSearchCatalog={(q) => searchCatalogAction(q)}
          />

          <StudioNovedades
            offers={offers}
            busy={busy}
            onReorder={(id, dir) => run(() => reorderStudioOfferAction(slug, campaignId!, id, dir))}
            onSetStatus={(id, op: OfferOp) => run(() => setStudioOfferStatusAction(slug, campaignId!, id, op))}
            onUpdateOffer={(id, patch: OfferPatch) => run(() => updateStudioOfferAction(slug, campaignId!, id, patch))}
            onAddClick={() => setActiveImport("whatsapp")}
          />

          <Preview state={state} show={showPreview} onGenerate={() => setShowPreview(true)} hasActive={hasActive} copied={copied} onCopy={async () => { if (state) { await navigator.clipboard?.writeText(previewFromState(state)); setCopied(true); } }} />
        </div>

        {/* Columna lateral */}
        <div className="space-y-6 lg:col-span-1">
          <div className="lg:sticky lg:top-6 lg:space-y-6">
            <Summary
              state={state}
              sum={sum}
              busy={busy}
              saved={saved}
              onEdit={() => setGeneralOpen(true)}
              onSave={() => state && run(() => saveGeneralAction(slug, campaignId, { title: state.title, opensAt: state.opensAt, closesAt: state.closesAt, description: state.description }))}
            />
            <Tips />
          </div>
        </div>
      </div>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p> : null}

      <Footer
        state={state}
        busy={busy}
        pending={pending}
        onCancel={`/tiendas/${slug}/preventas`}
        onPublish={publish}
      />

      {generalOpen ? (
        <StudioGeneral
          initial={{ title: state?.title === "Preventa sin nombre" ? "" : state?.title ?? "", opensAt: state?.opensAt ?? null, closesAt: state?.closesAt ?? null, description: state?.description ?? "" }}
          busy={busy}
          onClose={() => setGeneralOpen(false)}
          onSave={(g) => run(() => saveGeneralAction(slug, campaignId, g), () => setGeneralOpen(false))}
        />
      ) : null}
    </StoreShell>
  );
}

function Header({ slug }: { slug: string }) {
  const onMenu = useOpenMenu();
  return (
    <header className="space-y-4">
      <div className="flex items-center gap-4">
        <button type="button" onClick={onMenu} aria-label="Abrir menú" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden"><Menu size={20} aria-hidden /></button>
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
          <h1 className="text-2xl font-semibold text-slate-900">Nueva preventa</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Borrador</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Configurá la edición y prepará las novedades antes de publicarlas.</p>
      </div>
    </header>
  );
}

function Summary({ state, sum, busy, saved, onEdit, onSave }: { state: StudioState | null; sum: { tomos: number; editoriales: number; precioDesdeCents: number | null }; busy: boolean; saved: boolean; onEdit: () => void; onSave: () => void }) {
  const name = state?.title && state.title !== "Preventa sin nombre" ? state.title : "Sin nombre";
  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm"><span className="text-slate-400">{label}</span><span className={`truncate text-right ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{value}</span></div>
  );
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Resumen de la preventa</h2>
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-sm font-medium text-violet-600 transition-colors hover:text-violet-700"><Pencil size={14} aria-hidden /> Editar</button>
      </div>
      <div className="divide-y divide-slate-100">
        <Row label="Nombre" value={name} strong />
        <Row label="Apertura" value={fmtIsoDateTime(state?.opensAt ?? null)} />
        <Row label="Cierre" value={fmtIsoDateTime(state?.closesAt ?? null)} />
        <Row label="Período de gracia" value="Hasta el cierre" />
        <Row label="Duración" value={durationLabel(state?.opensAt ?? null, state?.closesAt ?? null)} />
        <Row label="Tomos" value={String(sum.tomos)} />
        <Row label="Editoriales" value={String(sum.editoriales)} />
        <Row label="Precio desde" value={sum.precioDesdeCents != null ? formatArsCents(sum.precioDesdeCents) : "—"} />
        <Row label="Comunicación" value="WhatsApp" />
        <div className="flex items-center justify-between gap-3 py-1.5 text-sm"><span className="text-slate-400">Estado</span><span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Borrador</span></div>
      </div>
      <button type="button" onClick={onSave} disabled={busy} className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-700 disabled:opacity-50">{busy ? "Guardando…" : "Guardar borrador"}</button>
      <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-slate-400">{saved ? <><CheckCircle2 size={13} className="text-emerald-500" aria-hidden /> Guardado</> : "Los cambios se guardan automáticamente."}</p>
    </section>
  );
}

function Tips() {
  const items = [
    "Pegá el mensaje de WhatsApp para cargar tus novedades más rápido.",
    "Podés editar precios y orden antes de publicar.",
    "Los tomos que agregues quedarán disponibles para recibir reservas.",
  ];
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><Lightbulb size={16} className="text-amber-500" aria-hidden /> Consejos</h2>
      <ul className="space-y-2 text-sm text-slate-500">{items.map((t, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300" aria-hidden />{t}</li>)}</ul>
    </section>
  );
}

function Preview({ state, show, onGenerate, hasActive, copied, onCopy }: { state: StudioState | null; show: boolean; onGenerate: () => void; hasActive: boolean; copied: boolean; onCopy: () => void }) {
  const msg = state && show ? previewFromState(state) : "";
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Vista previa del mensaje</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onGenerate} disabled={!hasActive} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40">Generar vista previa</button>
          {show ? <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50">{copied ? <CircleCheck size={14} className="text-emerald-500" aria-hidden /> : <Copy size={14} aria-hidden />} Copiar</button> : null}
        </div>
      </div>
      {show && msg ? (
        <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 font-sans text-sm text-slate-700">{msg}</pre>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/40 px-4 py-10 text-center">
          <MessageSquare size={22} className="text-slate-300" aria-hidden />
          <p className="text-sm font-medium text-slate-600">Tu mensaje se generará automáticamente</p>
          <p className="text-xs text-slate-400">Cuando agregues tomos, se mostrará acá la vista previa del mensaje.</p>
        </div>
      )}
    </section>
  );
}

function Footer({ state, busy, pending, onCancel, onPublish }: { state: StudioState | null; busy: boolean; pending: string[] | null; onCancel: string; onPublish: () => void }) {
  const name = state?.title && state.title !== "Preventa sin nombre" ? state.title : "Borrador sin nombre";
  return (
    <div className="sticky bottom-0 -mx-5 mt-2 border-t border-slate-200 bg-white/90 px-5 py-4 backdrop-blur lg:-mx-8 lg:px-8">
      {pending && pending.length ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <p className="font-medium">Antes de publicar:</p>
          <ul className="mt-1 list-disc pl-5">{pending.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-700">{name}</p>
          <p className="text-xs text-slate-400">No es visible para tus clientes.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={onCancel} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100">Cancelar</Link>
          <button type="button" onClick={onPublish} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-700 disabled:opacity-50"><Rocket size={16} aria-hidden /> Publicar preventa</button>
        </div>
      </div>
    </div>
  );
}

function PublishedScreen({ slug, state }: { slug: string; state: StudioState }) {
  return (
    <StoreShell active="preventas">
      <Header slug={slug} />
      <div className="mx-auto max-w-xl">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-6 py-12 text-center shadow-sm">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-600"><CircleCheck size={28} strokeWidth={2.4} aria-hidden /></span>
          <h2 className="text-xl font-semibold text-slate-900">Preventa publicada</h2>
          <p className="text-sm text-slate-500"><span className="font-medium text-slate-700">{state.title}</span> ya está abierta al cliente.</p>
          <div className="mt-2 flex flex-col items-center gap-2">
            <Link href={`/tiendas/${slug}/preventas`} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-700">Ver mis preventas</Link>
          </div>
        </div>
      </div>
    </StoreShell>
  );
}
