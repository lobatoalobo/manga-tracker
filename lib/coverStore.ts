import { AwsClient } from "aws4fetch";
import { createHash } from "crypto";
import { fetchWithTimeout } from "./httpFetch";

/**
 * Almacén de portadas en Cloudflare R2 (S3-compatible). Bajamos la imagen de su
 * fuente UNA vez y la servimos desde R2 (propia, persistente) — así no dependemos
 * del hotlink frágil ni del proxy, y no perdemos la portada si la fuente la borra.
 * Ver memoria covers-r2. Sin R2 configurado, `storeCover` devuelve null y el caller
 * usa su fallback (URL cruda / proxy).
 */
const ENDPOINT = process.env.R2_ENDPOINT; // https://<accountid>.r2.cloudflarestorage.com
const BUCKET = process.env.R2_BUCKET;
const PUBLIC = process.env.R2_PUBLIC_URL?.replace(/\/+$/, ""); // sin barra final
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

export function r2Configured(): boolean {
  return !!(ENDPOINT && BUCKET && PUBLIC && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

let client: AwsClient | null = null;
function getClient(): AwsClient {
  if (!client)
    client = new AwsClient({
      accessKeyId: ACCESS_KEY_ID!,
      secretAccessKey: SECRET_ACCESS_KEY!,
      service: "s3",
      region: "auto",
    });
  return client;
}

/** URL real de la fuente: si viene el proxy /api/cover, sacamos el param `u`. */
function realSource(url: string): string | null {
  if (PUBLIC && url.startsWith(PUBLIC)) return null; // ya está en R2
  if (url.startsWith("/api/cover")) {
    try {
      return new URL("https://x" + url).searchParams.get("u");
    } catch {
      return null;
    }
  }
  return /^https?:\/\//.test(url) ? url : null;
}

/**
 * Sube a R2 la portada de `url` (su fuente real) y devuelve la URL pública de R2.
 * Idempotente: si ya es una URL de R2, la devuelve tal cual. Si falla la bajada o
 * R2 no está configurado, devuelve la URL original (no rompe el flujo).
 */
export async function storeCover(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  if (!r2Configured() || !PUBLIC) return null; // sin R2 → el caller usa su fallback
  if (url.startsWith(PUBLIC)) return url; // ya en R2 (idempotente)

  const src = realSource(url);
  if (!src) return url;

  // NUNCA tira: cualquier error de red (incluido ECONNRESET al leer el body, o el
  // PUT) devuelve null y el caller sigue. Reintenta los transitorios. Robustez
  // crítica para los batches (ver memoria maintenance-tooling-robust).
  const img = await fetchImage(src);
  if (!img) return null;

  const ext = img.ct.includes("png") ? "png" : img.ct.includes("webp") ? "webp" : "jpg";
  const key = `covers/${createHash("sha256").update(src).digest("hex").slice(0, 24)}.${ext}`;

  try {
    const put = await getClient().fetch(`${ENDPOINT}/${BUCKET}/${key}`, {
      method: "PUT",
      body: img.body,
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": img.ct,
        // R2 exige Content-Length explícito en el PUT (411 si falta); el runtime
        // de Vercel no lo autosetea para un body ArrayBuffer como sí hace Node.
        "Content-Length": String(img.body.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
    if (!put.ok) return null;
  } catch {
    return null;
  }

  return `${PUBLIC}/${key}`;
}

/**
 * Sube bytes de una imagen (ej. un archivo que subió el admin) a R2 y devuelve la
 * URL pública. Key por hash del contenido (dedup). Reporta el motivo de falla
 * (no configurado / status del PUT / error de red) para poder diagnosticar desde
 * el admin — antes devolvía null a secas y "No se pudo subir" no decía nada.
 */
export async function storeImageBytes(
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!r2Configured() || !PUBLIC)
    return { ok: false, error: "R2 no configurado en este entorno (faltan env vars)." };
  if (!contentType.startsWith("image/"))
    return { ok: false, error: "El archivo no es una imagen." };
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const key = `covers/${createHash("sha256").update(new Uint8Array(bytes)).digest("hex").slice(0, 24)}.${ext}`;
  try {
    const put = await getClient().fetch(`${ENDPOINT}/${BUCKET}/${key}`, {
      method: "PUT",
      body: bytes,
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": contentType,
        // R2 exige Content-Length explícito (411 MissingContentLength si falta).
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
    if (!put.ok) {
      const body = await put.text().catch(() => "");
      return { ok: false, error: `R2 PUT ${put.status} ${body.slice(0, 120)}`.trim() };
    }
  } catch (e) {
    return { ok: false, error: `R2 PUT error: ${e instanceof Error ? e.message : "red"}` };
  }
  return { ok: true, url: `${PUBLIC}/${key}` };
}

/**
 * Baja los bytes de una imagen. Sin User-Agent (el CDN de MangaDex 400ea con UA
 * genérico). Reintenta errores transitorios (ECONNRESET / terminated) hasta 3
 * veces; ante 4xx/5xx o no-imagen devuelve null sin reintentar. Nunca tira.
 */
async function fetchImage(
  src: string,
): Promise<{ body: ArrayBuffer; ct: string } | null> {
  for (let i = 0; i < 3; i++) {
    try {
      // Timeout duro: una bajada que se cuelga colgaría el batch entero.
      const res = await fetchWithTimeout(src, {}, 20_000);
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "image/jpeg";
      if (!ct.startsWith("image/")) return null;
      const body = await res.arrayBuffer();
      return { body, ct };
    } catch {
      if (i === 2) return null;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}
