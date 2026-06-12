import type { PurchaseStatus } from "@/lib/purchases";

// Metadata de los estados de compra (client-safe: sin "use server").
export const PURCHASE_STATUS_META: Record<
  PurchaseStatus,
  { label: string; dot: string; chip: string }
> = {
  PENDING: {
    label: "Pendiente",
    dot: "bg-amber-400",
    chip: "bg-amber-500/15 text-amber-300",
  },
  SHIPPED: {
    label: "Pagado",
    dot: "bg-sky-400",
    chip: "bg-sky-500/15 text-sky-300",
  },
  RECEIVED: {
    label: "Recibido",
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-300",
  },
  CANCELLED: {
    label: "Cancelado",
    dot: "bg-red-400",
    chip: "bg-red-500/15 text-red-300",
  },
};

export const PURCHASE_STATUS_ORDER: PurchaseStatus[] = [
  "PENDING",
  "SHIPPED",
  "RECEIVED",
  "CANCELLED",
];
