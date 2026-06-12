import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveEditionSeries } from "@/lib/resolveSeries";

/**
 * Resuelve un título del catálogo de una editorial a su ficha de AniList y
 * redirige. La resolución está verificada por autor (lib/resolveSeries) para no
 * caer en homónimos. Guarda el anilistId para la próxima. Si no hay match
 * confiable, cae a la búsqueda con el título limpio.
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
      select: { anilistId: true, publisher: true, slug: true, title: true },
    })
    .catch(() => null);

  if (!row) return NextResponse.redirect(new URL("/", request.url));

  if (row.anilistId) {
    return NextResponse.redirect(
      new URL(`/manga/${row.anilistId}`, request.url),
    );
  }

  const resolved = await resolveEditionSeries(row);
  if (resolved) {
    await prisma.publisherEdition
      .update({ where: { id: editionId }, data: { anilistId: resolved } })
      .catch(() => {});
    return NextResponse.redirect(new URL(`/manga/${resolved}`, request.url));
  }

  // No está en AniList: mostramos la página solo-nacional (con info de la editorial).
  return NextResponse.redirect(new URL(`/nacional/${editionId}`, request.url));
}
