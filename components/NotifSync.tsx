"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Mantiene la campanita/listas al día sin refresh manual: refresca los server
 * components cuando llega un push (mensaje del service worker) y cuando volvés a
 * la app (visibilitychange).
 */
export default function NotifSync() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();

    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "push") refresh();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };

    navigator.serviceWorker?.addEventListener("message", onMsg);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMsg);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router]);

  return null;
}
