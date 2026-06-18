"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Captura los errores que escapan del layout raíz (donde un error.tsx normal no
 * llega) y los manda a Sentry. Reemplaza el documento completo, por eso lleva
 * sus propias etiquetas <html>/<body>.
 */
export default function GlobalError({
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
    <html lang="es">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          background: "#0d0d12",
          color: "#e5e5e5",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
          Algo salió mal
        </h1>
        <p style={{ color: "#9ca3af", fontSize: "0.9rem", maxWidth: "28rem" }}>
          Tuvimos un problema inesperado. Ya quedó registrado; probá recargar la
          página.
        </p>
        <button
          onClick={() => reset()}
          style={{
            borderRadius: "0.5rem",
            background: "#6d28d9",
            color: "white",
            padding: "0.5rem 1.25rem",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
