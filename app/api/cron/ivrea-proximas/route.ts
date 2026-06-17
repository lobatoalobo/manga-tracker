import { reconcileIvreaProximas } from "@/lib/ivreaProximas";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Cron mensual (Vercel) que reconcilia el chip "🔜 Próximo a salir" con la
 * página de próximas salidas de Ivrea. Ivrea no bloquea datacenter, así que
 * corre bien desde Vercel. Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await reconcileIvreaProximas();
  return Response.json({ ok: true, ...result });
}
