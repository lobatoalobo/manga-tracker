import { getMangaDetails } from "../lib/getMangaDetails";
import { addToCollection } from "../lib/collection";

// Mangas iniciales (AniList ids) para arrancar con algo en la colección.
const SEED_IDS = [30013]; // One Piece

async function main() {
  for (const id of SEED_IDS) {
    const { anilist, editions, muVolumes } = await getMangaDetails(id);

    const localEdition = editions.find((e) => e.region === "AR") ?? null;
    const japanVolumes =
      editions.find((e) => e.region === "JP")?.volumes ?? null;

    await addToCollection({
      id: anilist.id,
      title: anilist.title,
      coverImage: anilist.coverImage,
      volumes: anilist.volumes ?? null,
      muVolumes,
      japanVolumes,
      edition: localEdition
        ? {
            publisher: localEdition.publisher,
            slug: localEdition.slug,
            status: localEdition.status,
            volumes: localEdition.volumes,
            nextVolume: localEdition.nextVolume,
          }
        : null,
    });

    console.log(
      `✓ Seedeado: ${anilist.title.romaji} (${localEdition?.publisher ?? "sin editorial"}: ${localEdition?.volumes ?? "?"} tomos)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
