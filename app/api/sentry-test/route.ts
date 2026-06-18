// TEMPORAL: endpoint de prueba para verificar que Sentry captura errores en
// runtime. Visitá /api/sentry-test una vez (debería dar 500) y revisá que el
// evento aparezca en Sentry. Borrar después de validar.
export const dynamic = "force-dynamic";

export function GET() {
  throw new Error("Sentry test: verificación de captura de errores (Nakama)");
}
