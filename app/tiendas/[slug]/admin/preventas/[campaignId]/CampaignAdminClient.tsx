"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateCampaignAction, publishCampaignAction, closeCampaignAction, cancelCampaignAction, deleteDraftCampaignAction,
  searchVolumesAction, addOfferAction, hideOfferAction, showOfferAction, cancelOfferAction, removeOfferAction,
  type ActionResult,
} from "@/app/tiendas/[slug]/admin/preventas/actions";
import { formatArsCents, retailErrorLabel } from "@/lib/retail/format";
import type { OfferVolumeCandidate } from "@/lib/retail/volumeSearch";

export interface OfferView {
  id: number; volumeId: number; title: string; volumeNumber: number | null; publisher: string | null;
  listPriceCents: number; preorderPriceCents: number; discountPercent: number; status: string;
}
export interface CampaignView {
  id: number; title: string; description: string | null; weekLabel: string | null; status: string;
  opensAt: string | null; closesAt: string | null; publishedAt: string | null;
}

export default function CampaignAdminClient({ slug, campaign, offers }: { slug: string; campaign: CampaignView; offers: OfferView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isDraft = campaign.status === "DRAFT";
  const isPublished = campaign.status === "PUBLISHED";

  const run = (fn: () => Promise<ActionResult | { ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(retailErrorLabel(("error" in r && r.error) || ""));
      else router.refresh();
    });

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium">{campaign.status}</span>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {/* datos de la campaña */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Datos</h2>
        <form
          action={(fd) => run(() => updateCampaignAction(slug, campaign.id, fd))}
          className="space-y-3"
        >
          <input name="title" defaultValue={campaign.title} disabled={!isDraft} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60" placeholder="Título" />
          <input name="weekLabel" defaultValue={campaign.weekLabel ?? ""} disabled={!isDraft} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60" placeholder="Semana" />
          <textarea name="description" defaultValue={campaign.description ?? ""} rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Descripción (editable tras publicar)" />
          <div className="grid grid-cols-2 gap-3">
            <input name="opensAt" type="datetime-local" defaultValue={campaign.opensAt?.slice(0, 16) ?? ""} disabled={!isDraft} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60" />
            <input name="closesAt" type="datetime-local" defaultValue={campaign.closesAt?.slice(0, 16) ?? ""} disabled={!isDraft} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60" />
          </div>
          <button disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm">Guardar</button>
          {isPublished && <span className="ml-2 text-xs text-muted">Tras publicar solo se edita la descripción.</span>}
        </form>
      </section>

      {/* acciones de estado */}
      <section className="flex flex-wrap gap-2">
        {isDraft && <button disabled={pending} onClick={() => run(() => publishCampaignAction(slug, campaign.id))} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">Publicar</button>}
        {isPublished && <button disabled={pending} onClick={() => run(() => closeCampaignAction(slug, campaign.id))} className="rounded-lg border border-border px-4 py-2 text-sm">Cerrar</button>}
        {(isDraft || isPublished) && <button disabled={pending} onClick={() => run(() => cancelCampaignAction(slug, campaign.id))} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600">Cancelar</button>}
        {isDraft && <button disabled={pending} onClick={() => run(() => deleteDraftCampaignAction(slug, campaign.id))} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600">Eliminar borrador</button>}
        {isPublished && <a href={`/tiendas/${slug}/preventas/${campaign.id}`} className="rounded-lg border border-border px-4 py-2 text-sm">Ver pública ↗</a>}
      </section>

      {/* ofertas */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Ofertas ({offers.length})</h2>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {offers.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className={o.status === "CANCELLED" ? "text-muted line-through" : ""}>
                {o.title} {o.volumeNumber != null && `#${o.volumeNumber}`} {o.publisher && <span className="text-muted">· {o.publisher}</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-muted line-through">{formatArsCents(o.listPriceCents)}</span>
                <span className="font-medium">{formatArsCents(o.preorderPriceCents)}</span>
                <span className="text-xs text-green-600">-{o.discountPercent}%</span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs">{o.status}</span>
                {o.status === "ACTIVE" && <button disabled={pending} onClick={() => run(() => hideOfferAction(slug, campaign.id, o.id))} className="text-xs text-muted hover:underline">ocultar</button>}
                {o.status === "HIDDEN" && <button disabled={pending} onClick={() => run(() => showOfferAction(slug, campaign.id, o.id))} className="text-xs text-muted hover:underline">mostrar</button>}
                {o.status !== "CANCELLED" && <button disabled={pending} onClick={() => run(() => cancelOfferAction(slug, campaign.id, o.id))} className="text-xs text-red-600 hover:underline">cancelar</button>}
                {isDraft && <button disabled={pending} onClick={() => run(() => removeOfferAction(slug, campaign.id, o.id))} className="text-xs text-red-600 hover:underline">quitar</button>}
              </span>
            </li>
          ))}
          {offers.length === 0 && <li className="px-4 py-2.5 text-sm text-muted">Sin ofertas.</li>}
        </ul>
      </section>

      {/* picker de tomos (solo DRAFT) */}
      {isDraft && <OfferPicker slug={slug} campaignId={campaign.id} onAdded={() => router.refresh()} onError={setError} />}
    </div>
  );
}

function OfferPicker({ slug, campaignId, onAdded, onError }: { slug: string; campaignId: number; onAdded: () => void; onError: (e: string) => void }) {
  const [results, setResults] = useState<OfferVolumeCandidate[]>([]);
  const [pending, start] = useTransition();

  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">Agregar tomo</h2>
      <form action={(fd) => start(async () => setResults(await searchVolumesAction((fd.get("q") as string) ?? "")))} className="flex gap-2">
        <input name="q" placeholder="Buscar por título…" className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        <button disabled={pending} className="rounded-lg border border-border px-4 py-2 text-sm">Buscar</button>
      </form>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {results.map((v) => (
          <li key={v.volumeId}>
            <form
              action={(fd) =>
                start(async () => {
                  const r = await addOfferAction(slug, campaignId, fd);
                  if (r.ok) { setResults([]); onAdded(); } else onError(retailErrorLabel(r.error));
                })
              }
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
            >
              <input type="hidden" name="volumeId" value={v.volumeId} />
              <span>{v.title} #{v.volumeNumber} <span className="text-muted">· {v.publisher}</span></span>
              <span className="flex items-center gap-2">
                <input name="listPrice" type="number" step="0.01" placeholder="lista $" required className="w-24 rounded border border-border bg-surface px-2 py-1" />
                <input name="preorderPrice" type="number" step="0.01" placeholder="preventa $" required className="w-24 rounded border border-border bg-surface px-2 py-1" />
                <button disabled={pending} className="rounded bg-accent px-3 py-1 text-white">Agregar</button>
              </span>
            </form>
          </li>
        ))}
        {results.length === 0 && <li className="px-4 py-2.5 text-sm text-muted">Buscá un tomo para agregarlo.</li>}
      </ul>
    </section>
  );
}
