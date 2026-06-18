import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry: el plugin de build sube source maps solo si hay credenciales
// (SENTRY_AUTH_TOKEN/ORG/PROJECT en Vercel); sin ellas no hace nada y el build
// sigue igual. La captura de errores en runtime la activan los archivos de
// instrumentation cuando hay DSN.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
