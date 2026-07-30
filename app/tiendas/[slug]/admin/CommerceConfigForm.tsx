"use client";

/**
 * Form de configuración comercial (Slice P0, OWNER). Edita contacto/pago del perfil vía `updateCommerceDataAction`.
 * `useTransition` evita doble submit; el resultado `{ ok, error }` se muestra inline. Sin selector de checkoutMode
 * (valor único CONVERSATIONAL en P0).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCommerceDataAction } from "./configActions";

type Initial = {
  whatsapp: string | null;
  paymentAlias: string | null;
  paymentInstructions: string | null;
  pickupInstructions: string | null;
  publicDescription: string | null;
};

const norm = (v: string | null) => v ?? "";

export default function CommerceConfigForm({ slug, initial }: { slug: string; initial: Initial }) {
  const router = useRouter();
  const [form, setForm] = useState({
    whatsapp: norm(initial.whatsapp),
    paymentAlias: norm(initial.paymentAlias),
    paymentInstructions: norm(initial.paymentInstructions),
    pickupInstructions: norm(initial.pickupInstructions),
    publicDescription: norm(initial.publicDescription),
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const save = () => {
    if (pending) return;
    setMsg(null);
    startTransition(async () => {
      const res = await updateCommerceDataAction(slug, {
        whatsapp: form.whatsapp,
        paymentAlias: form.paymentAlias,
        paymentInstructions: form.paymentInstructions,
        pickupInstructions: form.pickupInstructions,
        publicDescription: form.publicDescription,
      });
      if (res.ok) {
        setMsg({ ok: true, text: "Datos guardados." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: `No se pudo guardar (${res.error}).` });
      }
    });
  };

  return (
    <div className="space-y-3">
      <Text label="WhatsApp" value={form.whatsapp} onChange={set("whatsapp")} placeholder="+54 9 11 5555 5555" hint="Se usa para el botón de contacto del comprador." />
      <Text label="Alias de pago" value={form.paymentAlias} onChange={set("paymentAlias")} placeholder="mi.alias.mp" />
      <Area label="Instrucciones de pago" value={form.paymentInstructions} onChange={set("paymentInstructions")} placeholder="Titular, CBU/CVU, banco, y cómo confirmar el pago." />
      <Area label="Instrucciones de retiro" value={form.pickupInstructions} onChange={set("pickupInstructions")} />
      <Area label="Descripción pública" value={form.publicDescription} onChange={set("publicDescription")} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}

function Text({
  label, value, onChange, placeholder, hint,
}: { label: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement>; placeholder?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Area({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: React.ChangeEventHandler<HTMLTextAreaElement>; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
    </label>
  );
}
