/**
 * Gate de la preview del UI Kit de Retail (Fase 0 · C1). PURO y testeable.
 *
 * La preview (`/kit`) solo responde cuando `RETAIL_PREVIEW_ENABLED === "true"`.
 * Se usa una variable EXPLÍCITA (no `NODE_ENV`) a propósito: así se puede revisar
 * el Kit en un deployment aislado con build de producción, sin exponerlo por
 * accidente en la aplicación real. Cualquier otro valor (ausente, "1", "TRUE", "")
 * deja la ruta oculta → el layout responde `notFound()`.
 */
export function retailPreviewEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.RETAIL_PREVIEW_ENABLED === "true";
}
