"use client";

import { useState, useTransition } from "react";
import { deletePurchaseAction } from "@/app/actions";

export default function PurchaseActions({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-muted">
          También se quitarán estos tomos de tu colección.
        </span>
        <button
          onClick={() => startTransition(() => deletePurchaseAction(id))}
          disabled={isPending}
          className="rounded-lg border border-red-500/60 px-3 py-1 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
        >
          {isPending ? "Borrando…" : "Borrar igual"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition hover:text-foreground disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition hover:border-red-500 hover:text-red-400"
    >
      Borrar compra
    </button>
  );
}
