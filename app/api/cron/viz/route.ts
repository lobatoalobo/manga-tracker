import { refreshVizCatalog, discoverVizFromGoogleBooks } from "@/lib/vizImport";
import { backfillCoversToBlob } from "@/lib/coverStore";
import { syncTrackedTotals } from "@/lib/syncTracked";
import { detectAndNotifyNewVolumes } from "@/lib/catalogNotify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Cuánto procesar por corrida (acotado al maxDuration). El refresh rota por
// updatedAt, así que en sucesivas semanas cubre todo el catálogo aunque crezca.
const REFRESH_BATCH = 80;
const DISCOVER_BATCH = 25;
const COVER_BATCH = 60; // migra portadas externas a Blob (storage propio)

/**
 * Cron (Vercel) de mantenimiento del catálogo VIZ (inglés), auto-mantenido:
 *  1) DESCUBRE series nuevas con Google Books (las verifica contra MU);
 *  2) REFRESCA un lote rotado de las que ya tenemos → conteo de tomos nuevos;
 *  3) propaga totales a las colecciones (para marcar el tomo nuevo);
 *  4) corre el aviso de tomo nuevo.
 * Todo en cloud (MU/MD/GB no bloquean datacenter). Semanal: los tomos en inglés
 * no salen al día. Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const discover = await discoverVizFromGoogleBooks({ limit: DISCOVER_BATCH });
  const refresh = await refreshVizCatalog(REFRESH_BATCH);
  const covers = await backfillCoversToBlob(COVER_BATCH);
  const synced = await syncTrackedTotals();
  const notify = await detectAndNotifyNewVolumes();
  return Response.json({ ok: true, discover, refresh, covers, synced, notify });
}
