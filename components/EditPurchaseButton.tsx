"use client";

import { useState } from "react";
import PurchaseForm, { type InitialPurchase } from "@/components/PurchaseForm";
import PurchaseActions from "@/components/PurchaseActions";

/**
 * Acciones de una compra: "Editar" (despliega el form precargado, a todo el
 * ancho) y "Borrar". Al editar reemplaza la fila de botones por el form.
 */
export default function EditPurchaseButton({
  purchase,
}: {
  purchase: InitialPurchase;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="mt-4">
        <PurchaseForm initial={purchase} onClose={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        onClick={() => setEditing(true)}
        className="rounded-lg border border-border px-3 py-1 text-xs transition hover:border-accent"
      >
        Editar
      </button>
      <PurchaseActions id={purchase.id} />
    </div>
  );
}
