import fs from "fs";
import path from "path";

const filePath = path.join(
  process.cwd(),
  "data",
  "collection.json"
);

export function getCollection() {
  const file = fs.readFileSync(
    filePath,
    "utf8"
  );

  return JSON.parse(file);
}

export function addToCollection(
  manga: any
) {
  const collection =
    getCollection();

  const exists =
    collection.find(
      (m: any) =>
        m.id === manga.id
    );

  if (exists) return;

collection.push({
  id: manga.id,
  title: manga.title,
  coverImage: manga.coverImage,
  totalVolumes: manga.volumes ?? 0,
  ownedVolumes: [],
  wishlistVolumes: [],
});

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      collection,
      null,
      2
    )
  );
}

export function toggleVolume(
  mangaId: number,
  volume: number
) {
  const collection =
    getCollection();

  const manga =
    collection.find(
      (m: any) =>
        m.id === mangaId
    );

  if (!manga) return;

  const exists =
    manga.ownedVolumes.includes(
      volume
    );

  if (exists) {
    manga.ownedVolumes =
      manga.ownedVolumes.filter(
        (v: number) =>
          v !== volume
      );
  } else {
    manga.ownedVolumes.push(
      volume
    );

    manga.ownedVolumes.sort(
      (
        a: number,
        b: number
      ) => a - b
    );
  }

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      collection,
      null,
      2
    )
  );
}