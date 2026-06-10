import { getMangaDetails } from "../lib/getMangaDetails";
import { addEdition } from "../lib/collection";
import { prisma } from "../lib/prisma";

// Mangas iniciales (AniList ids).
const SEED_IDS = [30013]; // One Piece

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log(
      "No hay usuarios todavía. Logueate una vez en la app y volvé a correr el seed.",
    );
    return;
  }

  for (const id of SEED_IDS) {
    const { anilist, editions, muVolumes } = await getMangaDetails(id);
    const ed = editions.find((e) => e.region === "AR") ?? editions[0];
    if (!ed) continue;

    await addEdition(user.id, {
      anilistId: anilist.id,
      title: anilist.title,
      coverImage: anilist.coverImage,
      volumes: anilist.volumes ?? null,
      muVolumes,
      edition: {
        key: ed.id,
        label: ed.source,
        publisher: ed.publisher,
        slug: ed.slug,
        region: ed.region,
        totalVolumes: ed.volumes,
      },
    });

    console.log(`✓ Seedeado para ${user.email}: ${anilist.title.romaji} (${ed.source}: ${ed.volumes} tomos)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
