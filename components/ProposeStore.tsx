"use client";

import { useActionState, useState } from "react";
import { submitStoreAction } from "@/app/actions";
import StoreFields from "./StoreFields";

export default function ProposeStore() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(submitStoreAction, null);

  if (state?.ok) {
    return (
      <p className="mt-4 text-sm text-emerald-400">
        ¡Gracias! La tienda quedó pendiente de aprobación.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 text-sm text-accent underline-offset-2 hover:underline"
      >
        + ¿Conocés una tienda? Proponela
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mt-4 rounded-xl border border-border bg-surface p-4"
    >
      <h3 className="mb-3 text-sm font-medium">Proponer una tienda</h3>
      <StoreFields />
      {state?.error && (
        <p className="mt-2 text-sm text-red-400">{state.error}</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Enviar propuesta"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-1.5 text-sm text-muted transition hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
