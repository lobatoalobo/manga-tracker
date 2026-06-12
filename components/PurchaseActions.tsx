"use client";

import { useTransition } from "react";
import { setPurchaseStatusAction, deletePurchaseAction } from "@/app/actions";
import {
  PURCHASE_STATUS_META,
  PURCHASE_STATUS_ORDER,
} from "@/lib/purchaseStatus";

export default function PurchaseActions({
  id,
  status,
}: {
  id: number;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <select
        value={status}
        disabled={isPending}
        onChange={(e) =>
          startTransition(() => setPurchaseStatusAction(id, e.target.value))
        }
        className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-50"
      >
        {PURCHASE_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {PURCHASE_STATUS_META[s].label}
          </option>
        ))}
      </select>
      <button
        onClick={() => startTransition(() => deletePurchaseAction(id))}
        disabled={isPending}
        className="rounded-lg border border-border px-2 py-1 text-xs text-muted transition hover:border-red-500 hover:text-red-400 disabled:opacity-50"
      >
        Borrar
      </button>
    </div>
  );
}
