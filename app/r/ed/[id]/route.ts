import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { searchMangaList } from "@/lib/anilist";
import { searchableTitle } from "@/lib/catalog";

/**
 * Resuelve un título del catálogo de una editorial (PublisherEdition) a su ficha
 * de AniList y redirige. Si ya está mapeado, va directo; si no, busca con el
 * título limpio (sin decoraciones de la editorial), guarda el anilistId para la
 * próxima, y redirige a la serie. Si no la encuentra, cae a la búsqueda.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const editionId = Number(id);

  const row = await prisma.publisherEdition
    .findUnique({
      where: { id: editionId },
      select: { anilistId: true, title: true },
    })
    .catch(() => null);

  if (!row) return NextResponse.redirect(new URL("/", request.url));

  if (row.anilistId) {
    return NextResponse.redirect(
      new URL(`/manga/${row.anilistId}`, request.url),
    );
  }

  const q = searchableTitle(row.title);
  const hit = (await searchMangaList(q, true).catch(() => []))[0];

  if (hit) {
    await prisma.publisherEdition
      .update({ where: { id: editionId }, data: { anilistId: hit.id } })
      .catch(() => {});
    return NextResponse.redirect(new URL(`/manga/${hit.id}`, request.url));
  }

  return NextResponse.redirect(
    new URL(`/?search=${encodeURIComponent(q)}`, request.url),
  );
}
