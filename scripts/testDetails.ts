import { getMangaDetails } from "../lib/getMangaDetails";

async function main() {
  // Dandadan (AniList id)
  const details = await getMangaDetails(132029);

  console.dir(details, {
    depth: null,
  });
}

main();