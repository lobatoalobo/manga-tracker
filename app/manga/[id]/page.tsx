import { getCollection } from "@/lib/collection";
import VolumeGrid from "@/components/VolumeGrid";
import { getMangaStats } from "@/lib/mangaStats";

export default async function Page({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params;

  const collection = getCollection();

  const manga = collection.find((m: any) => m.id === Number(id));

  if (!manga) return <h1>No encontrado</h1>;

  const { owned, total, percentage, missing } = getMangaStats(manga);

  return (
    <main
      style={{
        padding: 40,
      }}
    >
      <h1>{manga.title.romaji}</h1>

      <img
        src={manga.coverImage.extraLarge}
        width={200}
        alt={manga.title.romaji}
      />

      <p>
        <b>Progreso:</b> {owned} / {total}
      </p>

      <p>
        <b>Completado:</b> {percentage}%
      </p>

      <p>
        <b>Faltan:</b>{" "}
        {missing.length > 0 ? missing.join(", ") : "¡Colección completa!"}
      </p>

      <h2>Tomos</h2>

      <VolumeGrid
        mangaId={manga.id}
        totalVolumes={manga.totalVolumes || 0}
        ownedVolumes={manga.ownedVolumes}
        wishlistVolumes={manga.wishlistVolumes || []}
      />
    </main>
  );
}
