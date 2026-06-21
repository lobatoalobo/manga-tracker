import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * Ruta heredada de la era AniList (/manga/<anilistId>). AniList quedó demovido;
 * esta ruta solo REDIRIGE a la ficha local (/serie/<workId>) para no romper
 * links viejos ni ítems de colección con anilistId positivo. La ficha real es
 * /serie/[id] (basada en Work).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mangaId = Number(id);
  const ed = await prisma.publisherEdition.findFirst({
    where: { anilistId: mangaId, workId: { not: null } },
    select: { workId: true },
  });
  if (ed?.workId) redirect(`/serie/${ed.workId}`);
  notFound();
}
