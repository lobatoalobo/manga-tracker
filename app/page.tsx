import { getOnePiece } from "@/lib/anilist";

export default async function Home() {
  const manga = await getOnePiece();

  return (
    <main
      style={{
        padding: 40,
        fontFamily: "sans-serif",
      }}
    >
      <h1>{manga.title.romaji}</h1>

      <img
        src={manga.coverImage.extraLarge}
        width={250}
      />

      <p>
        <b>Estado:</b> {manga.status}
      </p>

      <p>
        <b>Volúmenes:</b> {manga.volumes}
      </p>
    </main>
  );
}