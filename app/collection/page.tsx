import { getCollection } from "@/lib/collection";
import Link from "next/link";
import MangaCard from "@/components/MangaCard";

export default function Collection() {
  const collection = getCollection();

  return (
    <main
      style={{
        padding: 40,
      }}
    >
      <h1>Mi colección</h1>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
        }}
      >
        {collection.map((manga: any) => (
          <MangaCard key={manga.id} manga={manga} />
        ))}
      </div>
    </main>
  );
}
