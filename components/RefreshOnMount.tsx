"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Dispara un router.refresh() al montar. Útil cuando la página hace un efecto en
 * el server (p. ej. marcar notificaciones como leídas) y hay que re-renderizar el
 * layout (la campanita) para reflejarlo sin refresh manual.
 */
export default function RefreshOnMount() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
