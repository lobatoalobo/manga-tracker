import { fetchWithTimeout } from "@/lib/httpFetch";

/**
 * Traducción de sinopsis ES↔EN para completar la versión que falta (la nativa de
 * la fuente manda; la traducida se marca `...Auto`). Soporta varios motores; usa
 * el primero configurado:
 *   - OpenAI (OPENAI_API_KEY)   — gpt-4o-mini, baratísimo (~$0.30 todo el batch). Preferido.
 *   - DeepL  (DEEPL_API_KEY)    — calidad alta; free es one-time 1M chars.
 *   - Claude (ANTHROPIC_API_KEY)— baratísimo; limpia atribuciones.
 * NO-OP sin ninguna key (devuelve null). Ver docs/analisis-sistema-datos.md.
 */
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";

export function translatorConfigured(): boolean {
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.DEEPL_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
}

const LANG = { es: "español", en: "inglés" } as const;

/** Quita atribuciones tipo "(Source: VIZ Media)" o "Source: ..." al final. */
function stripSource(text: string): string {
  return text
    .replace(/\(?\s*source\s*:[^\n)]*\)?\s*$/i, "")
    .trim();
}

async function viaDeepL(text: string, from: "es" | "en", to: "es" | "en"): Promise<string | null> {
  const key = process.env.DEEPL_API_KEY!;
  // Las keys gratuitas terminan en ":fx" y usan el host api-free.
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  try {
    const body = new URLSearchParams({
      text,
      source_lang: from.toUpperCase(),
      target_lang: to.toUpperCase(),
    });
    const r = await fetchWithTimeout(
      `${host}/v2/translate`,
      {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
      30_000,
    );
    if (!r.ok) return null;
    const j = await r.json();
    const out = j?.translations?.[0]?.text;
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}

async function viaOpenAI(text: string, from: "es" | "en", to: "es" | "en"): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY!;
  const prompt =
    `Traducí esta sinopsis de manga del ${LANG[from]} al ${LANG[to]}. ` +
    `Devolvé SOLO la traducción, sin comillas, sin notas ni prefacios. ` +
    `Mantené los nombres propios.\n\n${text}`;
  try {
    const r = await fetchWithTimeout(
      OPENAI_API,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        }),
      },
      30_000,
    );
    if (!r.ok) return null;
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content;
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}

async function viaClaude(text: string, from: "es" | "en", to: "es" | "en"): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const prompt =
    `Traducí esta sinopsis de manga del ${LANG[from]} al ${LANG[to]}. ` +
    `Devolvé SOLO la traducción, sin comillas, sin notas ni prefacios. ` +
    `Mantené los nombres propios.\n\n${text}`;
  try {
    const r = await fetchWithTimeout(
      ANTHROPIC_API,
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
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

/**
 * Traduce una sinopsis de `from` a `to`. null si no hay key, texto vacío o falla.
 */
export async function translateSynopsis(
  text: string | null | undefined,
  from: "es" | "en",
  to: "es" | "en",
): Promise<string | null> {
  if (!text?.trim() || from === to) return null;
  const clean = stripSource(text.trim());
  if (process.env.OPENAI_API_KEY) return viaOpenAI(clean, from, to);
  if (process.env.DEEPL_API_KEY) return viaDeepL(clean, from, to);
  if (process.env.ANTHROPIC_API_KEY) return viaClaude(clean, from, to);
  return null;
}
