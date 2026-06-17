import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Serie · Nakama" };

/**
 * `/nacional/[editionId]` quedó RETIRADO: el detalle local vive ahora en
 * `/serie/[workId]`. Esta ruta solo redirige (compatibilidad de links viejos):
 * a `/manga` si la edición está mapeada a AniList, o a `/serie` por su work.
 */
export default async function NacionalRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const editionId = Number(id);
  const row = await prisma.publisherEdition.findUnique({
    where: { id: editionId },
    select: { anilistId: true, workId: true },
  });
  if (!row) notFound();
  if (row.anilistId) redirect(`/manga/${row.anilistId}`);
  if (row.workId) redirect(`/serie/${row.workId}`);
  notFound();
}
