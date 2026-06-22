/**
 * `fetch` con timeout duro vía AbortController. Sin esto, un servidor que acepta
 * la conexión pero nunca responde (o un body que no termina de llegar) cuelga el
 * proceso para siempre — fue lo que dejó un batch de portadas trabado ~2h en
 * silencio. Ver memoria maintenance-tooling-robust. Tira AbortError al vencer el
 * timeout; el caller decide si reintenta o devuelve null.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
