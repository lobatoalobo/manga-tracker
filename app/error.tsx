"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

/**
 * Error boundary de segmento: captura fallos de renderizado de las páginas (DB
 * caída, timeout de un fetch, etc.) SIN reemplazar el layout — la nav sigue
 * visible y el usuario puede reintentar o irse a otro lado. Los errores que NO
 * llega a cubrir el layout raíz los toma app/global-error.tsx.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-5 py-12 text-center">
      <p className="text-4xl">😵‍💫</p>
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="text-sm text-muted">
        Tuvimos un problema al cargar esto. Ya quedó registrado; probá de nuevo o
        volvé al inicio.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Reintentar
        </button>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
        >
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
