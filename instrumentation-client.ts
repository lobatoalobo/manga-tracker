import * as Sentry from "@sentry/nextjs";

// Monitoreo de errores del cliente (browser). No-op sin DSN público.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    enableLogs: false,
  });
}

// Vincula los errores con la navegación del App Router (mejores breadcrumbs).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
