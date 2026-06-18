import * as Sentry from "@sentry/nextjs";

// Inicializa Sentry según el runtime en el que arranca la instancia del server.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura los errores de render / route handlers / server actions del App Router.
export const onRequestError = Sentry.captureRequestError;
