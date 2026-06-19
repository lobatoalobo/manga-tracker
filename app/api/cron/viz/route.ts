import { refreshVizCatalog } from "@/lib/vizImport";
import { syncTrackedTotals } from "@/lib/syncTracked";
import { detectAndNotifyNewVolumes } from "@/lib/catalogNotify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Cron (Vercel) de mantenimiento del catálogo VIZ (inglés):
 *  1) re-resuelve contra MangaUpdates las obras con edición VIZ → actualiza el
 *     conteo de tomos (tomos nuevos). MU/MD no bloquean datacenter.
 *  2) propaga los nuevos totales a las colecciones (syncTrackedTotals) para que
 *     el usuario pueda marcar el tomo nuevo.
 *  3) corre el aviso de tomo nuevo (las VIZ con anilistId entran; el push por
 *     workId es una mejora aparte del plan de notis).
 * Semanal: los tomos en inglés no salen al día como Ivrea. Vercel Cron manda
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const refresh = await refreshVizCatalog();
  const synced = await syncTrackedTotals();
  const notify = await detectAndNotifyNewVolumes();
  return Response.json({ ok: true, refresh, synced, notify });
}
