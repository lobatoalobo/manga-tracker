"use client";

import { useState, useTransition } from "react";
import { createReportAction } from "@/app/actions";

export default function ReportButton({
  mangaId,
  mangaTitle,
}: {
  mangaId: number;
  mangaTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await createReportAction({ mangaId, mangaTitle, message });
      if (res.ok) {
        setDone(true);
        setMessage("");
      }
    });
  }

  if (done) {
    return (
      <p className="mt-6 text-sm text-emerald-400">
        ¡Gracias! Tu reporte fue enviado para revisión.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-6 text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        ¿Datos incorrectos? Reportar una corrección
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-4">
      <label className="text-sm font-medium">
        Reportar corrección sobre <span className="text-accent">{mangaTitle}</span>
      </label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="Ej: La edición de Panini tiene 72 tomos, no 54."
        className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={submit}
          disabled={isPending || !message.trim()}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Enviando…" : "Enviar reporte"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-1.5 text-sm text-muted transition hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
