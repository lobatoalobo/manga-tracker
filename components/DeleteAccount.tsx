"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/app/actions";

/**
 * Zona de peligro de /ajustes: borrar la cuenta. Pide confirmar tipeando
 * "BORRAR" para evitar borrados accidentales (acción irreversible).
 */
export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const confirmed = text.trim().toUpperCase() === "BORRAR";

  return (
    <div className="mt-10 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <h2 className="text-sm font-semibold text-red-400">Borrar cuenta</h2>
      <p className="mt-1 text-xs text-muted">
        Se elimina tu cuenta y todos tus datos: colección, compras, deseados,
        notas, amistades y actividad. Esta acción no se puede deshacer. Si querés
        guardar una copia, exportá tu colección antes desde{" "}
        <span className="text-foreground">Mi colección → Exportar CSV</span>.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10"
        >
          Quiero borrar mi cuenta
        </button>
      ) : (
        <div className="mt-3">
          <label className="block text-xs text-muted">
            Escribí <span className="font-semibold text-foreground">BORRAR</span>{" "}
            para confirmar
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-red-500"
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              disabled={!confirmed || pending}
              onClick={() => start(() => deleteAccountAction())}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "Borrando…" : "Borrar definitivamente"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setText("");
              }}
              disabled={pending}
              className="text-sm text-muted transition hover:text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
