import { auth } from "@/auth";
import { getCollectionItems } from "@/lib/collection";
import { toCsv } from "@/lib/csv";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("No autorizado", { status: 401 });

  const items = await getCollectionItems(session.user.id);

  const headers = [
    "anilistId",
    "romaji",
    "english",
    "native",
    "coverImage",
    "editionKey",
    "editionLabel",
    "publisher",
    "region",
    "totalVolumes",
    "readingStatus",
    "readingVolume",
    "owned",
  ];

  const rows = items.map((i) => [
    i.anilistId,
    i.title.romaji,
    i.title.english,
    i.title.native,
    i.coverImage,
    i.edition.key,
    i.edition.label,
    i.edition.publisher,
    i.edition.region,
    i.edition.totalVolumes,
    i.edition.readingStatus,
    i.edition.readingVolume,
    i.edition.ownedVolumes.join(" "),
  ]);

  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="nakama-coleccion.csv"',
    },
  });
}
