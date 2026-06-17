"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteNotificationAction,
  deleteAllNotificationsAction,
} from "@/app/actions";

/** Botón ✕ para borrar una notificación. */
export function DeleteNotifButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Borrar notificación"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await deleteNotificationAction(id);
          router.refresh();
        })
      }
      className="shrink-0 rounded-lg px-2 py-1 text-sm text-muted transition hover:bg-surface-2 hover:text-red-400 disabled:opacity-50"
    >
      ✕
    </button>
  );
}

/** Botón "Borrar todas". */
export function ClearAllNotifsButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("¿Borrar todas las notificaciones?")) return;
        start(async () => {
          await deleteAllNotificationsAction();
          router.refresh();
        });
      }}
      className="text-sm text-muted transition hover:text-red-400 disabled:opacity-50"
    >
      Borrar todas
    </button>
  );
}
