import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { inCatalogWhere } from "@/lib/catalog";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mangas-nakamas.vercel.app";

export const revalidate = 86400; // se regenera 1 vez por día

/**
 * Sitemap: rutas públicas estáticas + una entrada por cada obra del catálogo
 * (/serie/[id]) para que Google descubra e indexe las fichas. `updatedAt` ayuda
 * al recrawl. Las colecciones compartidas (/u) no se listan: son privadas por
 * defecto y el slug no es enumerable.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/catalogo`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/autores`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/tiendas`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/independientes`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/privacidad`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terminos`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const works = await prisma.work
    .findMany({ where: inCatalogWhere(), select: { id: true, updatedAt: true } })
    .catch(() => []);
  const series: MetadataRoute.Sitemap = works.map((w) => ({
    url: `${SITE_URL}/serie/${w.id}`,
    lastModified: w.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...statics, ...series];
}
