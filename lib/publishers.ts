/**
 * Editoriales sin sitio propio usable: su link canónico ES Whakoom (no hay tienda
 * online donde apuntar). Para estas, una URL de Whakoom NO es un error: no se
 * marca con ⚠ ni entra al filtro "Link Whakoom". Utopía es el caso típico.
 *
 * Módulo sin dependencias de servidor para poder importarlo también desde
 * componentes cliente (MappingRow).
 */
export const WHAKOOM_NATIVE: readonly string[] = ["Utopía Editorial"];

export const isWhakoomNative = (publisher: string): boolean =>
  WHAKOOM_NATIVE.includes(publisher);
