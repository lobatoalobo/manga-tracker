"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSeriesMutedAction } from "@/app/actions";

/** Silencia/activa las notis de tomos nuevos de ESTA serie (override del global). */
export default function SeriesMuteToggle({
  anilistId,
  muted,
}: {
  anilistId: number;
  muted: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle() {
    start(async () => {
      await setSeriesMutedAction(anilistId, !muted);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={
        muted
          ? "Notis de esta serie silenciadas — clic para activar"
          : "Recibís notis de tomos nuevos de esta serie — clic para silenciar"
      }
      className={`rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${
        muted
          ? "border-border text-muted hover:text-foreground"
          : "border-accent/50 text-accent hover:bg-accent/10"
      }`}
    >
      {muted ? "🔕 Silenciada" : "🔔 Notis"}
    </button>
  );
}
