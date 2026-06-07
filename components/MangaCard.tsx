import Link from "next/link";
import { getMangaStats } from "@/lib/mangaStats";

export default function MangaCard({
  manga,
}: {
  manga: any;
}) {
  const stats =
    getMangaStats(manga);

  return (
    <Link
      href={`/manga/${manga.id}`}
      style={{
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 10,
          padding: 15,
          width: 220,
        }}
      >
        <img
          src={
            manga.coverImage
              .extraLarge
          }
          width={190}
          alt={
            manga.title
              .romaji
          }
          style={{
            borderRadius: 6,
          }}
        />

        <h3>
          {
            manga.title
              .romaji
          }
        </h3>

        <p>
          {stats.owned} /{" "}
          {stats.total}
        </p>

        <progress
          value={
            stats.percentage
          }
          max={100}
          style={{
            width: "100%",
          }}
        />

        <p>
          {
            stats.percentage
          }
          %
        </p>
      </div>
    </Link>
  );
}