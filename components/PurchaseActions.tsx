"use client";

import { useTransition } from "react";
import { deletePurchaseAction } from "@/app/actions";

export default function PurchaseActions({ id }: { id: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => deletePurchaseAction(id))}
      disabled={isPending}
      className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
    >
      Borrar compra
    </button>
  );
}
