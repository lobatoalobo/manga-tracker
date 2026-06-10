"use client";

import { useActionState, useRef, useState } from "react";
import { addPurchaseAction } from "@/app/actions";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

export default function PurchaseForm() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addPurchaseAction, null);

  // Limpiar el form al guardar OK.
  if (state?.ok && formRef.current) formRef.current.reset();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        + Registrar compra
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <div className="space-y-2">
        <input name="title" required placeholder="Título *" className={input} />
        <div className="grid grid-cols-2 gap-2">
          <input
            name="volume"
            type="number"
            min={0}
            placeholder="Tomo"
            className={input}
          />
          <input name="edition" placeholder="Edición (Ivrea, etc.)" className={input} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            name="price"
            type="number"
            step="0.01"
            min={0}
            required
            placeholder="Precio (ARS) *"
            className={input}
          />
          <input name="store" placeholder="Tienda" className={input} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input name="purchasedAt" type="date" className={input} />
          <select name="status" className={input} defaultValue="ORDERED">
            <option value="ORDERED">Pedido</option>
            <option value="RECEIVED">Recibido</option>
          </select>
        </div>
      </div>

      {state?.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-1.5 text-sm text-muted transition hover:text-foreground"
        >
          Cerrar
        </button>
      </div>
    </form>
  );
}
