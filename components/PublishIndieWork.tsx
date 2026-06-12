"use client";

import { useActionState, useState } from "react";
import { submitIndieWorkAction } from "@/app/actions";
import IndieWorkFields from "./IndieWorkFields";

export default function PublishIndieWork() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(submitIndieWorkAction, null);

  if (state?.ok) {
    return (
      <p className="mt-4 text-sm text-emerald-400">
        ¡Gracias! Tu obra quedó pendiente de aprobación.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        ✏️ Publicá tu obra
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mt-4 rounded-xl border border-border bg-surface p-4"
    >
      <h3 className="mb-1 text-sm font-medium">Publicá tu manga / cómic</h3>
      <p className="mb-3 text-xs text-muted">
        La revisamos antes de publicarla. Subí la portada como link (Instagram,
        Drive, etc.).
      </p>
      <IndieWorkFields />
      {state?.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Enviar"}
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
