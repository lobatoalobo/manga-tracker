import { AwsClient } from "aws4fetch";
import { createHash } from "crypto";

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

  // OJO: sin User-Agent (el CDN de MangaDex 400ea con UA genérico).
  const res = await fetch(src).catch(() => null);
  if (!res || !res.ok) return null;
  const ct = res.headers.get("content-type") || "image/jpeg";
  if (!ct.startsWith("image/")) return null;
  const body = new Uint8Array(await res.arrayBuffer());

  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const key = `covers/${createHash("sha256").update(src).digest("hex").slice(0, 24)}.${ext}`;

  const put = await getClient()
    .fetch(`${ENDPOINT}/${BUCKET}/${key}`, {
      method: "PUT",
      body,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
    .catch(() => null);
  if (!put || !put.ok) return null;

  return `${PUBLIC}/${key}`;
}
