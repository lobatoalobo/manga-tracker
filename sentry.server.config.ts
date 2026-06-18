import * as Sentry from "@sentry/nextjs";

// Monitoreo de errores del servidor (Node runtime). No-op si no hay DSN
// (desarrollo / preview sin configurar), así nunca rompe el build ni manda
// ruido. El DSN y el sample rate se setean por env en Vercel.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    enableLogs: false,
  });
}
