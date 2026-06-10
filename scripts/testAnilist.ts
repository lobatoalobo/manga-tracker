import { searchManga } from "../lib/anilist";
import { normalizeAnilist } from "../lib/normalizeAnilist";

async function main() {
  const manga =
    await searchManga(
      "Dandadan",
    );

  console.dir(
    normalizeAnilist(
      manga,
    ),
    {
      depth: null,
    },
  );
}

main();