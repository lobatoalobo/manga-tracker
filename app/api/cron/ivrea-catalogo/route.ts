import { crawlIvreaCatalog } from "@/lib/ivreaCatalog";
import { syncTrackedTotals } from "@/lib/syncTracked";
import {
  detectAndNotifyNewVolumes,
  detectAndNotifyWishlistAvailable,
} from "@/lib/catalogNotify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Cron (Vercel) del CATÁLOGO de Ivrea: crawlea ivrea.com.ar/catalogo/ y
 * actualiza tomos/estado/portada de las ediciones (PublisherEdition.volumes).
 * Ivrea NO bloquea el datacenter, así que corre en la nube → la frescura del
 * conteo de Ivrea ya NO depende de la PC local (solo Whakoom necesita correr
 * local). Después propaga totales y dispara "tomo nuevo" / "salió en AR".
 * Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const ivrea = await crawlIvreaCatalog();
  const synced = await syncTrackedTotals();
  const newVolumes = await detectAndNotifyNewVolumes();
  const wishlist = await detectAndNotifyWishlistAvailable();
  return Response.json({ ok: true, ivrea, synced, newVolumes, wishlist });
}
