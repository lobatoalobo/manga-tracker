import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mangas-nakamas.vercel.app";

/**
 * robots.txt: indexar lo público (catálogo, fichas, autores, tiendas, colecciones
 * compartidas) y bloquear lo privado/transaccional (cuenta, admin, API).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin/",
        "/collection",
        "/ajustes",
        "/compras",
        "/perfil",
        "/amigos",
        "/notificaciones",
        "/deseados",
        "/faltantes",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
