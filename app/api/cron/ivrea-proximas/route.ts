import { reconcileIvreaProximas } from "@/lib/ivreaProximas";
import { notifyIvreaReleases } from "@/lib/localNotify";
import { syncTrackedTotals } from "@/lib/syncTracked";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Cron DIARIO (Vercel) del sistema de próximos de Ivrea:
 *  1) refresca el snapshot /proximas/ + /news/ (próximos tomos, reediciones,
 *     próximas series) y el chip "🔜 Próximo a salir";
 *  2) dispara las notis cuya fecha es HOY (próximo tomo / reedición).
 * Diario para no atrasar el aviso "el día que sale". Ivrea no bloquea datacenter.
 * Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const reconcile = await reconcileIvreaProximas();
  const synced = await syncTrackedTotals();
  const notify = await notifyIvreaReleases();
  return Response.json({ ok: true, reconcile, synced, notify });
}
