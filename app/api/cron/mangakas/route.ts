import { buildMangakaIndex } from "@/lib/mangakas";

// El build escanea varias páginas de AniList con throttle; dejamos margen.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Cron semanal (Vercel) que extiende/refresca el índice de mangakas. Vercel
 * Cron incluye `Authorization: Bearer <CRON_SECRET>` cuando la env está seteada.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await buildMangakaIndex();
  return Response.json({ ok: true, ...result });
}
