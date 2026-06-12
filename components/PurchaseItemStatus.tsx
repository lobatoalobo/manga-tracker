"use client";

import { useTransition } from "react";
import { setPurchaseItemStatusAction } from "@/app/actions";
import {
  PURCHASE_STATUS_META,
  PURCHASE_STATUS_ORDER,
} from "@/lib/purchaseStatus";

/** Dropdown de estado para un tomo dentro de una compra. */
export default function PurchaseItemStatus({
  itemId,
  status,
}: {
  itemId: number;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) =>
        startTransition(() =>
          setPurchaseItemStatusAction(itemId, e.target.value),
        )
      }
      className="shrink-0 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-50"
    >
      {PURCHASE_STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {PURCHASE_STATUS_META[s].label}
        </option>
      ))}
    </select>
  );
}
