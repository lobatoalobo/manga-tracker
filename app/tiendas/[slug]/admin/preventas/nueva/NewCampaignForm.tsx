"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction } from "@/app/tiendas/[slug]/admin/preventas/actions";
import { retailErrorLabel } from "@/lib/retail/format";

/** Form mínimo de creación de campaña (DRAFT). Al crear, navega al detalle. */
export default function NewCampaignForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      action={(fd) =>
        start(async () => {
          setError(null);
          const r = await createCampaignAction(slug, fd);
          if (r.ok) router.push(`/tiendas/${slug}/admin/preventas/${r.id}`);
          else setError(retailErrorLabel(r.error));
        })
      }
      className="mt-6 space-y-4"
    >
      <Field label="Título" name="title" required />
      <Field label="Semana (etiqueta)" name="weekLabel" placeholder="Semana 5 · julio 2026" />
      <label className="block text-sm">
        <span className="text-muted">Descripción</span>
        <textarea name="description" rows={3} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Abre (opcional)" name="opensAt" type="datetime-local" />
        <Field label="Cierra (opcional)" name="closesAt" type="datetime-local" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={pending} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Creando…" : "Crear borrador"}
      </button>
    </form>
  );
}

function Field({ label, name, type = "text", required, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <input name={name} type={type} required={required} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2" />
    </label>
  );
}
