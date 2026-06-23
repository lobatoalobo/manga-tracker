import { fetchWithTimeout } from "@/lib/httpFetch";

/**
 * Traducción de sinopsis ES↔EN con Claude. Para completar la versión que falta
 * a partir de la que tenemos (la nativa de la fuente manda; la traducida se marca
 * `...Auto`). NO-OP sin `ANTHROPIC_API_KEY` (devuelve null, no rompe). Ver
 * docs/analisis-sistema-datos.md.
 */
const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // rápido y barato para traducir

export function translatorConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const LANG = { es: "español", en: "inglés" } as const;

/**
 * Traduce una sinopsis de manga de `from` a `to`. Devuelve solo la traducción
 * (sin comillas ni notas), limpiando atribuciones tipo "Source: VIZ Media".
 * null si no hay key, texto vacío, o falla la llamada.
 */
export async function translateSynopsis(
  text: string | null | undefined,
  from: "es" | "en",
  to: "es" | "en",
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text?.trim() || from === to) return null;
  const prompt =
    `Traducí esta sinopsis de manga del ${LANG[from]} al ${LANG[to]}. ` +
    `Devolvé SOLO la traducción, sin comillas, sin notas ni prefacios. ` +
    `Mantené los nombres propios. Si el texto termina con una atribución tipo ` +
    `"Source: ..." o "(Source: ...)", quitala.\n\n${text.trim()}`;
  try {
    const r = await fetchWithTimeout(
      API,
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        }),
      },
      30_000,
    );
    if (!r.ok) return null;
    const j = await r.json();
    const out = j?.content?.[0]?.text;
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}
