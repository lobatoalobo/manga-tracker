/**
 * Proxy de portadas de MangaDex (que bloquea el hotlinking por Referer). Pide la
 * imagen server-side (sin referer) y la sirve desde nuestro origen con cache
 * inmutable. Allowlist estricto a uploads.mangadex.org para no ser un open-proxy.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const u = new URL(request.url).searchParams.get("u");
  if (!u) return new Response("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.hostname !== "uploads.mangadex.org") {
    return new Response("forbidden host", { status: 403 });
  }

  const upstream = await fetch(target.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 60 * 60 * 24 * 30 },
  }).catch(() => null);
  if (!upstream || !upstream.ok) {
    return new Response("upstream error", { status: 502 });
  }
  const ct = upstream.headers.get("content-type") ?? "image/jpeg";
  if (!ct.startsWith("image/")) {
    return new Response("not an image", { status: 415 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
