"use client";

import { useTransition } from "react";
import { setPurchaseStatusAction, deletePurchaseAction } from "@/app/actions";

export default function PurchaseActions({
  id,
  status,
}: {
  id: number;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();
  const received = status === "RECEIVED";

  return (
    <div className="flex shrink-0 gap-2">
      <button
        onClick={() =>
          startTransition(() =>
            setPurchaseStatusAction(id, received ? "ORDERED" : "RECEIVED"),
          )
        }
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-1 text-xs transition hover:border-accent disabled:opacity-50"
      >
        {received ? "Marcar pedido" : "Marcar recibido"}
      </button>
      <button
        onClick={() => startTransition(() => deletePurchaseAction(id))}
        disabled={isPending}
        className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
      >
        Borrar
      </button>
    </div>
  );
}
