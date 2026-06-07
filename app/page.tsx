import { searchManga } from "@/lib/anilist";
import SearchBar from "@/components/SearchBar";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const params = await searchParams;

  const query = params.search || "one piece";

  const manga = await searchManga(query);

  return (
    <main
      style={{
        padding: 40,
        fontFamily: "sans-serif",
      }}
    >
      <h1>📚 Mi Manga Tracker</h1>

      <SearchBar />

      <br />
      <br />

      <h2>{manga.title.romaji}</h2>

      <img
        src={manga.coverImage.extraLarge}
        alt={manga.title.romaji}
        width={250}
      />

      <p>
        <b>Status:</b> {manga.status}
      </p>

      <p>
        <b>Volumes:</b> {manga.volumes}
      </p>
    </main>
  );
}
