import { sweepPickupProjections } from "@/lib/collection-context/sweep";

// El barrido abre su propia conexión dedicada y procesa por lotes con presupuesto de tiempo; margen holgado.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Cron (Vercel) del barrido durable de colección automática (Slice 8). Recupera los `PICKED_UP` pendientes que
 * el intento inmediato no proyectó. Fail-closed con `Bearer ${CRON_SECRET}` (como el resto de los crons del repo).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Presupuesto < maxDuration: reserva margen antes del corte del runtime.
  const summary = await sweepPickupProjections({ timeBudgetMs: 50_000 });
  return Response.json({ ok: true, ...summary });
}
