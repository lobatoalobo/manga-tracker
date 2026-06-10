import { getMangaDetails } from "../lib/getMangaDetails";
import { addToCollection } from "../lib/collection";
import { prisma } from "../lib/prisma";

// Mangas iniciales (AniList ids).
const SEED_IDS = [30013]; // One Piece

async function main() {
  // Seedeamos bajo el primer usuario registrado (logueate una vez en la app).
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log(
      "No hay usuarios todavía. Logueate una vez en la app y volvé a correr el seed.",
    );
    return;
  }

  for (const id of SEED_IDS) {
    const { anilist, editions, muVolumes } = await getMangaDetails(id);
    const localEdition = editions.find((e) => e.region === "AR") ?? null;
    const japanVolumes =
      editions.find((e) => e.region === "JP")?.volumes ?? null;

    await addToCollection(user.id, {
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
      `✓ Seedeado para ${user.email}: ${anilist.title.romaji} (${localEdition?.publisher ?? "sin editorial"}: ${localEdition?.volumes ?? "?"} tomos)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
