import { put } from "@vercel/blob";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Almacén propio de portadas (Vercel Blob). Descarga la imagen de la fuente
 * (Ivrea/MU/MD) server-side y la guarda en NUESTRO storage, así el runtime no
 * depende de hosts externos para las imágenes (independencia total). Idempotente:
 * pathname determinístico por fuente; si la portada ya es nuestra, no hace nada.
 *
 * Requiere BLOB_READ_WRITE_TOKEN. Si falta, devuelve null (el caller hace
 * fallback a la URL externa / proxy, sin romper).
 */

const BLOB_HOST = ".public.blob.vercel-storage.com";
const MAX_BYTES = 8 * 1024 * 1024; // portadas reales rondan ~100KB; tope de seguridad
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** ¿La portada ya está en nuestro storage? */
export function isStoredCover(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(BLOB_HOST);
  } catch {
    return false;
  }
}

/**
 * ¿La fuente está DEFINITIVAMENTE rota (4xx)? Solo entonces conviene nullear la
 * portada (un error de red / 5xx es transitorio y se reintenta). MD a veces
 * sirve covers viejas con 400.
 */
async function isDeadSource(url: string): Promise<boolean> {
  const src = realSource(url);
  try {
    const r = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0" } });
    return r.status >= 400 && r.status < 500;
  } catch {
    return false; // red/timeout → transitorio, no nullear
  }
}

/** Desenvuelve el proxy `/api/cover?u=<real>` para bajar la imagen original. */
function realSource(url: string): string {
  try {
    const u = new URL(url, "http://local");
    if (u.pathname === "/api/cover") {
      const inner = u.searchParams.get("u");
      if (inner) return inner;
    }
  } catch {
    /* noop */
  }
  return url;
}

/**
 * Sube la portada de `source` a Blob y devuelve la URL propia. Devuelve null si
 * no hay token, la fuente no es una imagen válida, o falla la descarga/subida
 * (el caller debe degradar a la URL externa).
 */
export async function storeCover(
  source: string | null | undefined,
): Promise<string | null> {
  if (!source) return null;
  if (isStoredCover(source)) return source; // ya es nuestra
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null; // storage no configurado

  const src = realSource(source);
  let target: URL;
  try {
    target = new URL(src);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return null;

  const res = await fetch(src, {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const ct = (res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const ext = EXT[ct];
  if (!ext) return null; // no es una imagen conocida

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_BYTES) return null;

  // Pathname determinístico por fuente → dedup + idempotencia (misma fuente,
  // mismo objeto). `allowOverwrite` por si re-subimos la misma.
  const hash = createHash("sha1").update(src).digest("hex").slice(0, 24);
  const pathname = `covers/${hash}.${ext}`;
  try {
    const { url } = await put(pathname, buf, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: ct,
    });
    return url;
  } catch {
    return null;
  }
}

/**
 * Migra a Blob las portadas que todavía apuntan a un host externo (Ivrea/MU/MD
 * o el proxy). Idempotente y reanudable: las ya migradas se excluyen, así correr
 * de nuevo procesa el resto. `limit` acota por corrida (para crons).
 */
export async function backfillCoversToBlob(
  limit?: number,
): Promise<{ migrated: number; failed: number; remaining: number }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return { migrated: 0, failed: 0, remaining: 0 };
  // Whakoom bloquea el datacenter (Cloudflare): desde la nube (Vercel) no se
  // pueden bajar sus portadas. Las saltamos en cloud para no trabar el cron; se
  // migran desde el refresh LOCAL (IP residencial, no bloqueada). Hotlinkeadas
  // funcionan igual mientras tanto.
  const exclude = [{ coverImage: { contains: BLOB_HOST } }];
  if (process.env.VERCEL) exclude.push({ coverImage: { contains: "whakoom" } });
  const pending = await prisma.work.findMany({
    where: {
      coverImage: { not: null },
      NOT: { OR: exclude },
    },
    select: { id: true, coverImage: true },
    orderBy: { id: "asc" },
  });
  const batch = limit ? pending.slice(0, limit) : pending;
  let migrated = 0;
  let failed = 0;
  for (const w of batch) {
    // Resiliente: un fallo puntual (corte transitorio de DB, imagen rota) no
    // corta toda la corrida; es reanudable, la próxima vuelta lo reintenta.
    try {
      const url = await storeCover(w.coverImage);
      if (url && url !== w.coverImage) {
        await prisma.work.update({ where: { id: w.id }, data: { coverImage: url } });
        migrated++;
      } else if (!url) {
        failed++;
        // Fuente rota definitiva (4xx) → nulleamos (degrada a placeholder) para
        // no reintentarla en cada corrida. Transitorios se reintentan.
        if (w.coverImage && (await isDeadSource(w.coverImage))) {
          await prisma.work.update({ where: { id: w.id }, data: { coverImage: null } });
        }
      }
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { migrated, failed, remaining: pending.length - batch.length };
}
